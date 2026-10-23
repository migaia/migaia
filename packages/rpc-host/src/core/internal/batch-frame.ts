import { RpcCapability, RpcBatchPhysical } from '@migaia/rpc-contract'

/** Exact final transport identities carry only their completed/static capability intersection. */
const agreements = new WeakMap<
  object,
  Readonly<{
    limit?: number
    capabilities: readonly string[]
    cloneTransfer?: true
    capabilitiesForPeer?: (peerId: string) => readonly string[] | undefined
  }>
>()
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
  agreements.set(
    transport,
    Object.freeze({
      capabilities: Object.freeze([...capabilities]),
      ...(agreements.get(transport)?.cloneTransfer ? { cloneTransfer: true as const } : {}),
      ...(agreements.get(transport)?.capabilitiesForPeer
        ? { capabilitiesForPeer: agreements.get(transport)!.capabilitiesForPeer }
        : {}),
      ...(capabilities.includes(RpcCapability.batch)
        ? { limit: RpcBatchPhysical.maxBytes - framingBytes }
        : {})
    })
  )
  return transport
}

/**
 * Only native clone-transfer adapter construction records this physical fact on its original
 * receipt.
 */
export function registerCloneTransferCarrier<T extends object>(transport: T): T {
  agreements.set(
    transport,
    Object.freeze({ ...(agreements.get(transport) ?? { capabilities: [] }), cloneTransfer: true })
  )
  return transport
}

/** A platform name or public transport property cannot manufacture a native ownership boundary. */
export function hasCloneTransferCarrier(transport: object): boolean {
  return agreements.get(transport)?.cloneTransfer === true
}

/** Canonical gate wrappers explicitly carry the physical channel's agreement. */
export function carryBatchAgreement(source: object, target: object): void {
  const agreement = agreements.get(source)
  if (agreement !== undefined) agreements.set(target, agreement)
}

/** Qualification reads private identity only; absent agreement never probes a user frame. */
export function hasBatchAgreement(transport: object): boolean {
  return agreements.get(transport)?.limit !== undefined
}

/** Adapter framing bytes are deducted once from the complete physical frame's byte cap. */
export function batchPayloadLimit(transport: object): number {
  return agreements.get(transport)?.limit ?? RpcBatchPhysical.maxBytes
}

/** Read only the genuine completed intersection; no transport property or local offer grants it. */
export function readTransportCapabilities(transport: object): readonly string[] | undefined {
  return agreements.get(transport)?.capabilities
}

/**
 * Routed adapters borrow their actual channel agreement without installing another capability
 * table.
 */
export function registerPeerTransportCapabilities(
  transport: object,
  read: (peerId: string) => readonly string[] | undefined
): void {
  agreements.set(
    transport,
    Object.freeze({
      ...(agreements.get(transport) ?? { capabilities: [] }),
      capabilitiesForPeer: read
    })
  )
}

/** Undefined preserves ordinary carriers; a routed adapter returns an empty set for a departed peer. */
export function readPeerTransportCapabilities(
  transport: object,
  peerId: string
): readonly string[] | undefined {
  return agreements.get(transport)?.capabilitiesForPeer?.(peerId)
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
