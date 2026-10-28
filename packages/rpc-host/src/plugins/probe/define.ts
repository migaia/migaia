/**
 * Compiles and validates cold probe filters, stage masks and callback references before
 * publication. Each compiled handle owns stage updates through the canonical private probe record;
 * installed emitters consume that record without acquiring execution or carrier authority.
 */
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { identifyRpcBoundaryFailure, tagRpcError } from '@migaia/rpc-contract/errors'
import { RpcProbeStageName, type IRpcProbeStageName } from './constants.ts'
import { readProbeState, registerProbeState, type IRpcProbeState } from './internal.ts'
import type { IRpcProbe, IRpcProbeDefinition } from './types.ts'

/** Reserves exactly these own fields; unrelated host members, including emit, remain untouched. */
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
    /** The fixed RpcProbeStageName tuple bounds this search and rejects unknown stage names. */
    const stage = RpcProbeStageName.indexOf(stages[i]!)
    if (stage < 0) invalid(RpcCoreErrorText.probeStagesInvalid)
    mask |= 1 << stage
  }
  return mask
}

/** Validate and snapshot cold probe inputs before the first host mutation. */
function prepareProbeDefinition(
  definition: IRpcProbeDefinition,
  host: object | undefined,
  hasHost: boolean
) {
  if (typeof definition !== 'object' || definition === null)
    invalid(RpcCoreErrorText.probeDefinitionInvalid)
  /** Initial subscriptions are compiled before any host field can be attached. */
  const stageMask = compileStages(definition.stages, false)
  /** Capture stays fixed while later stage changes may pause active subscription. */
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
  /** A membership Set is the existing emitter filter representation. */
  const methods = definition.methods === undefined ? undefined : new Set(definition.methods)
  /** Full sampling preserves the existing unsigned 32-bit sentinel. */
  const sampleThreshold =
    definition.sample === undefined || definition.sample === 1
      ? 0xffffffff
      : Math.floor(definition.sample * 0x100000000)
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
    // ProbeHostField is a fixed five-field own-property attachment contract.
    for (const field of Object.values(ProbeHostField)) {
      if (Object.hasOwn(host, field)) invalid(RpcCoreErrorText.probeHostInvalid)
    }
  }
  /**
   * Callback references are captured after validation so later definition mutation cannot retarget
   * emitters.
   */
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
  return { stageMask, captureMask, methods, sampleThreshold, state }
}

/** Own one probe's mutable subscription mask and its installed emitter listeners. */
class CompiledProbe {
  /** The original private record remains the canonical emitter state and callback snapshot. */
  #state: IRpcProbeState
  /** Original host identity or standalone frozen facade stays the only published probe value. */
  readonly value: IRpcProbe
  /** Complete validation before attaching any of the existing reserved fields. */
  constructor(definition: IRpcProbeDefinition, host: object | undefined, hasHost: boolean) {
    const { stageMask, captureMask, methods, sampleThreshold, state } = prepareProbeDefinition(
      definition,
      host,
      hasHost
    )
    this.#state = state
    if (hasHost) {
      /** All validation completes before the first property is attached to the original host. */
      const target = host as object & IRpcProbe
      /** One ordered table preserves all original field descriptors and attachment order. */
      for (const [field, value] of [
        [ProbeHostField.stageMask, stageMask],
        [ProbeHostField.captureMask, captureMask],
        [ProbeHostField.methods, methods],
        [ProbeHostField.sampleThreshold, sampleThreshold],
        [ProbeHostField.setStages, this.#setStages]
      ] as const)
        Object.defineProperty(target, field, { value, enumerable: true })
      registerProbeState(target, state)
      Object.freeze(target)
      this.value = target
      return
    }
    /**
     * The frozen handle reads only the one private state record and exposes no subscriber
     * collection.
     */
    const probe: IRpcProbe = Object.freeze({
      /** Reads the current compiled subscription mask while the public handle remains frozen. */
      get stageMask(): number {
        return state.stageMask
      },
      captureMask,
      methods,
      sampleThreshold,
      emit: state.emit,
      setStages: this.#setStages
    })
    registerProbeState(probe, state)
    this.value = probe
  }
  /** Commit a validated mask before notifying each original installed emitter. */
  #setStages = (stages: readonly IRpcProbeStageName[]): void => {
    /** Compile first so invalid input preserves the original mask and sends no notifications. */
    const nextMask = compileStages(stages, true)
    if (nextMask === this.#state.stageMask) return
    this.#state.stageMask = nextMask
    /** Each installed emitter rebuilds its existing dispatch table only on a changed mask. */
    /** Listener failures cannot prevent installed emitters from adopting the committed mask. */
    const failures: Error[] = []
    for (const listener of this.#state.listeners) {
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
}

/** Compiles one standalone frozen probe without emitting or installing observations. */
export function defineProbe(definition: IRpcProbeDefinition): IRpcProbe
/** Attaches compiled fields to the same host reference, freezes it and retains all existing members. */
export function defineProbe<THost extends object>(
  definition: IRpcProbeDefinition,
  host: THost
): THost & IRpcProbe
/**
 * Validates definition and host before attachment. The probe stores references in private state;
 * emitters install them once into their own fixed-shape records and never read the host on hot
 * paths.
 */
export function defineProbe(definition: IRpcProbeDefinition, host?: object): IRpcProbe {
  return new CompiledProbe(definition, host, arguments.length > 1).value
}
