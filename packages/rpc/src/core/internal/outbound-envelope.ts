import { normalizeRpcEnvelope, RpcEnvelopeKind, type IRpcEnvelope } from '../../contract/index.js'

/**
 * Weak identity proves a package-owned immutable snapshot; public freezing/metadata cannot forge
 * it.
 */
const outbound = new WeakSet<object>()

/** Performs original first-user normalization before proving only non-opaque outbound envelopes. */
export function createOutboundEnvelope(value: unknown): IRpcEnvelope {
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
