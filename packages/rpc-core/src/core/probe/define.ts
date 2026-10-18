import { RpcCoreErrorCode } from '../error-code.js'
import { RpcCoreErrorText } from '../error-text.js'
import { identifyRpcBoundaryFailure, tagRpcError } from '../errors.js'
import { RpcProbeStageName, type IRpcProbeStageName } from './constants.js'
import { readProbeState, registerProbeState, type IRpcProbeState } from './internal.js'
import type { IRpcProbe, IRpcProbeDefinition } from './types.js'

/** D7 reserves exactly these own fields; unrelated host members, including emit, remain untouched. */
const ProbeHostField = {
  stageMask: 'stageMask',
  captureMask: 'captureMask',
  methods: 'methods',
  sampleThreshold: 'sampleThreshold',
  setStages: 'setStages'
} as const

/** Configuration rejection keeps the native TypeError family and canonical Core identity. */
function invalid(message: string): never {
  throw tagRpcError(new TypeError(message), RpcCoreErrorCode.invalidConfig)
}

/** Validates cold stage names and compiles their dispatch bits before any state is changed. */
function compileStages(stages: readonly IRpcProbeStageName[], allowEmpty: boolean): number {
  if (!Array.isArray(stages) || (!allowEmpty && stages.length === 0))
    invalid(RpcCoreErrorText.probeStagesInvalid)
  /** A validated temporary mask makes rejected stage updates atomic. */
  let mask = 0
  for (let i = 0; i < stages.length; i++) {
    /** Exact table lookup rejects inherited property names and unknown stage names. */
    const stage = RpcProbeStageName.indexOf(stages[i]!)
    if (stage < 0) invalid(RpcCoreErrorText.probeStagesInvalid)
    mask |= 1 << stage
  }
  return mask
}

/** Compiles one standalone frozen probe without emitting or installing observations. */
export function defineProbe(definition: IRpcProbeDefinition): IRpcProbe
/** Attaches compiled fields to the same host reference, freezes it and retains all existing members. */
export function defineProbe<THost extends object>(
  definition: IRpcProbeDefinition,
  host: THost
): THost & IRpcProbe
/**
 * Validates definition and host before attachment. D7 stores references in private state; emitters
 * install them once into their own fixed-shape records and never read the host on hot paths.
 */
export function defineProbe(definition: IRpcProbeDefinition, host?: object): IRpcProbe {
  if (typeof definition !== 'object' || definition === null)
    invalid(RpcCoreErrorText.probeDefinitionInvalid)
  /** Initial subscriptions must be nonempty; only later stage updates may pause the probe. */
  const stageMask = compileStages(definition.stages, false)
  /** Capture remains immutable even while setStages selects a different current subscription set. */
  const captureMask = definition.capture === undefined ? 0 : compileStages(definition.capture, true)
  if ((captureMask & stageMask) !== captureMask) invalid(RpcCoreErrorText.probeCaptureInvalid)
  if (typeof definition.emit !== 'function') invalid(RpcCoreErrorText.probeEmitInvalid)
  if (definition.redact !== undefined && typeof definition.redact !== 'function')
    invalid(RpcCoreErrorText.probeRedactInvalid)
  if (definition.describe !== undefined && typeof definition.describe !== 'function')
    invalid(RpcCoreErrorText.probeDescribeInvalid)
  if (definition.onError !== undefined && typeof definition.onError !== 'function')
    invalid(RpcCoreErrorText.probeOnErrorInvalid)
  if (
    definition.sample !== undefined &&
    (typeof definition.sample !== 'number' || !(definition.sample > 0 && definition.sample <= 1))
  )
    invalid(RpcCoreErrorText.probeSampleInvalid)
  if (
    definition.methods !== undefined &&
    (!Array.isArray(definition.methods) ||
      definition.methods.some((method) => typeof method !== 'string'))
  )
    invalid(RpcCoreErrorText.probeMethodsInvalid)
  /** D4 compiles the required membership Set representation; this is not a defensive payload copy. */
  const methods = definition.methods === undefined ? undefined : new Set(definition.methods)
  /** The full-sampling sentinel preserves the frozen v1 compiled-field contract. */
  const sampleThreshold =
    definition.sample === undefined || definition.sample === 1
      ? 0xffffffff
      : Math.floor(definition.sample * 0x100000000)
  /** An explicitly supplied undefined host is invalid rather than the single-argument form. */
  const hasHost = arguments.length > 1
  if (hasHost) {
    if (
      typeof host !== 'object' ||
      host === null ||
      !Object.isExtensible(host) ||
      Object.isFrozen(host) ||
      readProbeState(host as IRpcProbe) !== undefined
    )
      invalid(RpcCoreErrorText.probeHostInvalid)
    /** Validate every reserved own field before the first property is attached. */
    for (const field of Object.values(ProbeHostField)) {
      if (Object.hasOwn(host, field)) invalid(RpcCoreErrorText.probeHostInvalid)
    }
  }
  /** Definition callbacks are captured once so caller mutations cannot retarget future emitters. */
  const state: IRpcProbeState = {
    stageMask,
    captureMask,
    methods,
    sampleThreshold,
    emit: definition.emit,
    redact: definition.redact,
    describe: definition.describe,
    onError: definition.onError,
    listeners: new Set()
  }
  /** Stage updates change private active state; a host's non-writable data mask stays initial (D7). */
  const setStages = (stages: readonly IRpcProbeStageName[]): void => {
    /** Compile first so invalid input preserves the original mask and sends no notifications. */
    const nextMask = compileStages(stages, true)
    if (nextMask === state.stageMask) return
    state.stageMask = nextMask
    /** Each installed emitter rebuilds its existing dispatch table only on a changed mask. */
    /** Listener failures cannot prevent installed emitters from adopting the committed mask. */
    const failures: Error[] = []
    for (const listener of state.listeners) {
      try {
        listener()
      } catch (error) {
        failures.push(
          identifyRpcBoundaryFailure(
            error,
            RpcCoreErrorCode.callbackFailed,
            RpcCoreErrorText.callbackFailed
          )
        )
      }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
      throw tagRpcError(
        new AggregateError(failures, RpcCoreErrorText.callbackFailed),
        RpcCoreErrorCode.callbackFailed
      )
  }
  if (hasHost) {
    /** All validation completes before the first property is attached to the original host. */
    const target = host as object & IRpcProbe
    Object.defineProperty(target, ProbeHostField.stageMask, { value: stageMask, enumerable: true })
    Object.defineProperty(target, ProbeHostField.captureMask, {
      value: captureMask,
      enumerable: true
    })
    Object.defineProperty(target, ProbeHostField.methods, { value: methods, enumerable: true })
    Object.defineProperty(target, ProbeHostField.sampleThreshold, {
      value: sampleThreshold,
      enumerable: true
    })
    Object.defineProperty(target, ProbeHostField.setStages, { value: setStages, enumerable: true })
    registerProbeState(target, state)
    Object.freeze(target)
    return target
  }
  /** The frozen handle projects the one private mutable stage mask without exposing subscribers. */
  const probe: IRpcProbe = Object.freeze({
    /** Reads the current compiled subscription mask while the public handle remains frozen. */
    get stageMask(): number {
      return state.stageMask
    },
    captureMask,
    methods,
    sampleThreshold,
    emit: state.emit,
    setStages
  })
  registerProbeState(probe, state)
  return probe
}
