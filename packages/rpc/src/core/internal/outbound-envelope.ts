import { normalizeRpcEnvelope, RpcEnvelopeKind, type IRpcEnvelope } from '../../contract/index.js'
import type { IRpcPortableValue } from '../../contract/types.js'
import type { IRpcContext } from '../typing.js'
import { readProviderRuntimeOperation } from './provider.js'
import type { IRpcRuntimeOptions } from '../../contract/runtime-api/types.js'
import type { IRpcRuntimeEnvelope } from '../../contract/runtime-api/types.js'
import { normalizeRuntimeEnvelope } from '../../contract/runtime-api/normalize.js'
import { RpcRuntimeProfile, RpcRuntimeKind } from '../../contract/runtime-api/constants.js'
import { normalizePortable } from '../../contract/normalize.js'
import { invalidRpcEnvelope } from '../../contract/v1/route.js'
import { RpcEnvelopeViolation } from '../../contract/wire-constants.js'

/**
 * Private options provenance is minted only by the compiled forwarding provider, never a public
 * flag.
 */
const forwardedPayload = Symbol('rpc-forwarded-payload')
/** Route metadata travels only with the package-minted admitted payload options. */
const forwardedRoute = Symbol('rpc-forwarded-route')

/** Carry the already admitted input through the existing Peer, generation and core send owners. */
export function createForwardOptions(
  context: IRpcContext,
  route?: readonly string[]
): IRpcRuntimeOptions &
  Readonly<{
    signal: IRpcContext['signal']
    timeoutMs?: number
    [forwardedPayload]: unknown
    [forwardedRoute]?: readonly string[]
  }> {
  /** Opt-in relays preserve the final provider's selected semantics; ordinary metadata stays absent. */
  const runtime = readProviderRuntimeOperation(context)
  return {
    ...(runtime && 'options' in runtime ? runtime.options : {}),
    signal: context.signal,
    ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs }),
    [forwardedPayload]: context.data,
    ...(route === undefined ? {} : { [forwardedRoute]: route })
  }
}

/** New-profile headers reuse the exact same canonical private route provenance as ordinary forwards. */
export function readForwardRoute(options: unknown): readonly string[] | undefined {
  return typeof options === 'object' && options !== null
    ? Reflect.get(options, forwardedRoute)
    : undefined
}

/** A read-only forwarded query carries only the canonical signed route, with no business payload. */
export function createForwardQueryOptions(route: readonly string[] | undefined): object {
  return route === undefined ? {} : { [forwardedRoute]: route }
}

/**
 * Identity, rather than a public boolean, identifies the precise input admitted at the previous
 * hop.
 */
export function isForwardedPayload(options: unknown, payload: unknown): boolean {
  return (
    isForwardedOperation(options) && Reflect.get(options as object, forwardedPayload) === payload
  )
}

/** The original retry owner recognizes package-minted forwarding provenance without a public flag. */
export function isForwardedOperation(options: unknown): boolean {
  return typeof options === 'object' && options !== null && Object.hasOwn(options, forwardedPayload)
}

/** Copy only internal provenance through a canonical owner that reconstructs its send options. */
export function retainForwardOptions<T extends object>(source: unknown, target: T): T {
  if (typeof source === 'object' && source !== null && Object.hasOwn(source, forwardedPayload))
    Object.defineProperty(target, forwardedPayload, {
      value: Reflect.get(source, forwardedPayload),
      enumerable: true
    })
  if (typeof source === 'object' && source !== null && Object.hasOwn(source, forwardedRoute))
    Object.defineProperty(target, forwardedRoute, {
      value: Reflect.get(source, forwardedRoute),
      enumerable: true
    })
  return target
}

/**
 * Weak identity proves a package-owned immutable snapshot; public freezing/metadata cannot forge
 * it.
 */
const outbound = new WeakMap<object, symbol>()
/** Distinct private proof kinds cannot be forged by copying fields or freezing caller data. */
const legacySnapshot = Symbol('rpc-legacy-outbound-snapshot')
/** Runtime envelope admission remains separate from a normalized logical input. */
const runtimeSnapshot = Symbol('rpc-runtime-outbound-snapshot')
/** One logical caller admission survives its original retry owner without another portable walk. */
const runtimeInputSnapshot = Symbol('rpc-runtime-input-snapshot')
/** Existing options carry only a package-owned exact input reference, never a public skip flag. */
const runtimeInput = Symbol('rpc-runtime-input')
/** Logical input admission retains the original grammar depth when reused by a legacy frame. */
const runtimeInputDepth = Symbol('rpc-runtime-input-depth')

/** A logical input belongs to the same proof owner as the final immutable outbound envelope. */
export type IRuntimeRequestInput = Readonly<{
  method: string
  payload?: IRpcPortableValue
}>

/** Normalize caller data once at canonical admission, keeping omitted payload and sync failures. */
export function createRuntimeRequestInput(
  method: string,
  payload: unknown,
  binary: boolean | (() => never),
  options?: unknown,
  portableDepth: 0 | 2 = 0
): IRuntimeRequestInput {
  const retained = readRuntimeRequestInput(options, method, payload, portableDepth)
  if (retained) return retained
  /** Forwarding already has canonical wire admission; ordinary caller data receives one snapshot. */
  const portable =
    payload === undefined
      ? undefined
      : isForwardedPayload(options, payload)
        ? (payload as IRpcPortableValue)
        : normalizePortable(payload, portableDepth, new Set<object>(), binary)
  const input = { method, ...(portable === undefined ? {} : { payload: portable }) }
  Object.defineProperty(input, runtimeInputDepth, { value: portableDepth })
  Object.freeze(input)
  outbound.set(input, runtimeInputSnapshot)
  return input
}

/** Retain the exact admitted method/payload on the existing reconstructed send options. */
export function retainRuntimeRequestInput<T extends object>(
  options: T,
  input: IRuntimeRequestInput
): T {
  Object.defineProperty(options, runtimeInput, { value: input, enumerable: true })
  return options
}

/** Read only a genuine immutable input whose method and payload still match this logical send. */
export function readRuntimeRequestInput(
  options: unknown,
  method: string,
  payload: unknown,
  portableDepth: 0 | 2 = 0
): IRuntimeRequestInput | undefined {
  if (typeof options !== 'object' || options === null) return undefined
  const input = Reflect.get(options, runtimeInput) as IRuntimeRequestInput | undefined
  return input &&
    isRuntimeRequestInput(input) &&
    Reflect.get(input, runtimeInputDepth) === portableDepth &&
    input.method === method &&
    input.payload === payload
    ? input
    : undefined
}

/** In-place caller mutation and forged metadata cannot mint this original admission proof. */
export function isRuntimeRequestInput(value: object): value is IRuntimeRequestInput {
  return outbound.get(value) === runtimeInputSnapshot
}

/** Performs original first-user normalization before proving only non-opaque outbound envelopes. */
export function createOutboundEnvelope(value: unknown, options?: unknown): IRpcEnvelope {
  /** Trusted forwarding replaces only the validated payload slot; all header checks still run. */
  if (
    typeof options === 'object' &&
    options !== null &&
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'kind') === RpcEnvelopeKind.request
  ) {
    const data = Reflect.get(value, 'data') as
      | { route?: unknown; payload?: IRpcPortableValue }
      | undefined
    if (
      data &&
      (isForwardedPayload(options, data.payload) ||
        readRuntimeRequestInput(options, Reflect.get(value, 'method'), data.payload, 2))
    ) {
      const route = Reflect.get(options as object, forwardedRoute) as readonly string[] | undefined
      const header = normalizeRpcEnvelope({
        ...value,
        data: {
          route: {
            ...(data.route as object),
            ...(route === undefined ? {} : { forwardRoute: route })
          }
        }
      }) as Extract<IRpcEnvelope, { kind: 'request' }>
      const envelope = Object.freeze({
        ...header,
        data: Object.freeze({
          ...header.data,
          ...(data.payload === undefined ? {} : { payload: data.payload })
        })
      })
      outbound.set(envelope, legacySnapshot)
      return envelope
    }
  }
  /** The canonical contract owner retains getter order, failure pointers and portable snapshots. */
  const envelope = normalizeRpcEnvelope(value)
  if (envelope.kind !== RpcEnvelopeKind.variation) outbound.set(envelope, legacySnapshot)
  return envelope
}

/** Opaque controls, caller objects and inbound values retain full source codec admission. */
export function isOutboundEnvelope(value: unknown): value is IRpcEnvelope {
  return typeof value === 'object' && value !== null && outbound.get(value) === legacySnapshot
}

/** The same canonical proof owner retains an immutable runtime snapshot after full admission. */
export function createRuntimeOutboundEnvelope(value: unknown): IRpcRuntimeEnvelope {
  const envelope = normalizeRuntimeEnvelope(value)
  outbound.set(envelope, runtimeSnapshot)
  return envelope
}

/** Header admission remains complete while an exact canonical logical input is reused once. */
export function createRuntimeRequestOutboundEnvelope(
  header: unknown,
  input: IRuntimeRequestInput
): IRpcRuntimeEnvelope {
  /** Only the internal admission owner supplies this input; malformed caller headers still reject. */
  const envelope = normalizeRuntimeEnvelope(header)
  if (!isRuntimeRequestInput(input))
    throw invalidRpcEnvelope(RpcEnvelopeViolation.payload, '/payload')
  if (envelope.kind !== RpcRuntimeKind.call || envelope.task.method !== input.method)
    return createRuntimeOutboundEnvelope({ ...envelope, payload: input.payload })
  const complete = Object.freeze({
    ...envelope,
    ...(input.payload === undefined ? {} : { payload: input.payload })
  }) as IRpcRuntimeEnvelope
  outbound.set(complete, runtimeSnapshot)
  return complete
}

/** Only package-created runtime snapshots reuse admission; caller freezing and inbound data cannot. */
export function isRuntimeOutboundEnvelope(value: unknown): value is IRpcRuntimeEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    outbound.get(value) === runtimeSnapshot &&
    Reflect.get(value, 'profile') === RpcRuntimeProfile
  )
}

/**
 * Bounds JSON bytes only for the existing immutable portable snapshot proof. Six bytes per UTF-16
 * unit cover JSON escapes; an inconclusive bound falls back to exact physical sizing at the
 * caller.
 */
export function outboundJsonByteUpperBound(value: unknown): number | undefined {
  if (!isOutboundEnvelope(value)) return undefined
  return portableJsonByteUpperBound(value)
}

/** Counts snapshot structure without encoding or visiting characters of string payloads. */
function portableJsonByteUpperBound(value: unknown): number {
  if (typeof value === 'string') return value.length * 6 + 2
  /** Finite numbers, booleans, null and omitted undefined fields need at most 32 JSON bytes. */
  if (value === null || typeof value !== 'object') return 32
  /** Five bytes per array slot cover its JSON null/comma, including holes retained by map. */
  let bytes = Array.isArray(value) ? 2 + value.length * 5 : 2
  for (const key of Object.keys(value)) {
    /** Array indices are omitted by JSON; including their names still provides a safe upper bound. */
    bytes +=
      key.length * 6 + 4 + portableJsonByteUpperBound((value as Record<string, unknown>)[key])
  }
  return bytes
}

/**
 * Copies validated snapshots once, sorting owned JSON output or retaining legacy snapshot key
 * order.
 */
export function materializeOutboundJson(value: unknown, sortKeys = true): unknown {
  if (typeof value === 'number') return Object.is(value, -0) ? 0 : value
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => materializeOutboundJson(item, sortKeys))
  /** Ordinary records reproduce JSON.parse while defining **proto** safely as own data. */
  const result: Record<string, unknown> = {}
  /** Legacy bridge materialization preserves its already-admitted insertion order. */
  const keys = Object.keys(value)
  if (sortKeys) keys.sort()
  for (const key of keys)
    Object.defineProperty(result, key, {
      value: materializeOutboundJson((value as Record<string, unknown>)[key], sortKeys),
      enumerable: true,
      configurable: true,
      writable: true
    })
  return result
}
