import { RpcCapability, RpcBatchPhysical } from '../../contract/wire-constants.js'

/** Exact final transport identities carry only their completed/static capability intersection. */
const agreements = new WeakMap<object, number>()
/** Only the canonical sender can bypass the gate's single-envelope physical limiter. */
const writers = new WeakSet<object>()

/** The existing gate cancels only queued physical work, leaving started protection unchanged. */
export type IBatchWriteGuard = (cancelQueued?: (reason: unknown) => void) => void | (() => void)

/** Registers immutable factory agreement without reading user transport metadata. */
export function registerBatchAgreement<T extends object>(
  transport: T,
  capabilities: readonly string[],
  framingBytes = 0
): T {
  if (capabilities.includes(RpcCapability.batch))
    agreements.set(transport, RpcBatchPhysical.maxBytes - framingBytes)
  return transport
}

/** Canonical gate wrappers explicitly carry the physical channel's agreement. */
export function carryBatchAgreement(source: object, target: object): void {
  const limit = agreements.get(source)
  if (limit !== undefined) agreements.set(target, limit)
}

/** Qualification reads private identity only; absent agreement never probes a user frame. */
export function hasBatchAgreement(transport: object): boolean {
  return agreements.has(transport)
}

/** Adapter framing bytes are deducted once from the complete physical frame's byte cap. */
export function batchPayloadLimit(transport: object): number {
  return agreements.get(transport) ?? RpcBatchPhysical.maxBytes
}

/** Existing gate still counts every envelope; its guard is rechecked at physical invocation. */
export function registerBatchWriter<T extends (guard?: IBatchWriteGuard) => void | Promise<void>>(
  writer: T
): T {
  writers.add(writer)
  return writer
}

/** Unknown callback identities retain the original utils limiter and signal behavior. */
export function isBatchWriter(writer: object): boolean {
  return writers.has(writer)
}
