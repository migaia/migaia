import { normalizeRpcEnvelope, RpcEnvelopeKind, type IRpcEnvelope } from '../../contract/index.js'
import type { IRpcPortableValue } from '../../contract/types.js'
import type { IRpcContext } from '../typing.js'
import { readProviderRuntimeOperation } from './provider.js'
import type { IRpcRuntimeOptions } from '../../contract/runtime-api/types.js'

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
const outbound = new WeakSet<object>()

/** Performs original first-user normalization before proving only non-opaque outbound envelopes. */
export function createOutboundEnvelope(value: unknown, options?: unknown): IRpcEnvelope {
  /** Trusted forwarding replaces only the validated payload slot; all header checks still run. */
  if (
    typeof options === 'object' &&
    options !== null &&
    Object.hasOwn(options, forwardedPayload) &&
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'kind') === RpcEnvelopeKind.request
  ) {
    const data = Reflect.get(value, 'data') as
      | { route?: unknown; payload?: IRpcPortableValue }
      | undefined
    if (data && isForwardedPayload(options, data.payload)) {
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
      outbound.add(envelope)
      return envelope
    }
  }
  /** The canonical contract owner retains getter order, failure pointers and portable snapshots. */
  const envelope = normalizeRpcEnvelope(value)
  if (envelope.kind !== RpcEnvelopeKind.variation) outbound.add(envelope)
  return envelope
}

/** Opaque controls, caller objects and inbound values retain full source codec admission. */
export function isOutboundEnvelope(value: unknown): value is IRpcEnvelope {
  return typeof value === 'object' && value !== null && outbound.has(value)
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
