/** Owns native browser observation details and counters shared by the physical source adapters. */
import type { RpcCarrierObservation } from '@migaia/rpc-host/sdk'
import { RpcProbeDirection } from '@migaia/rpc-contract/interfaces'

/** Browser native facts retain the original three stable detail fields, never business metadata. */
type IBrowserNativeDetail = { origin: string; transfers: number; rejectedSource: number }
/** Each existing native IO owns this original small counter and lazily allocated reusable detail. */
export type IBrowserObservationMetadata = {
  detail?: IBrowserNativeDetail
  rejectedSource: number
}

/** Count only a real native source rejection while the canonical observer is installed. */
export function rejectBrowserObservation(
  observation: RpcCarrierObservation,
  metadata: IBrowserObservationMetadata
): void {
  if (observation.active) metadata.rejectedSource += 1
  else {
    metadata.rejectedSource = 0
    metadata.detail = undefined
  }
}

/** Reuse the original native detail algorithm; SDK alone owns subscription, sizing and capture. */
export function emitBrowserObservation(
  observation: RpcCarrierObservation,
  metadata: IBrowserObservationMetadata,
  direction: RpcProbeDirection,
  content: unknown,
  transfer?: readonly ArrayBuffer[],
  origin?: string
): void {
  if (!observation.active) {
    metadata.rejectedSource = 0
    metadata.detail = undefined
    return
  }
  /** Publish storage before arbitrary observer callbacks can reenter this same native source. */
  const detail = (metadata.detail ??= { origin: '', transfers: 0, rejectedSource: 0 })
  detail.origin = origin ?? ''
  detail.transfers = direction === RpcProbeDirection.inbound ? -1 : (transfer?.length ?? 0)
  detail.rejectedSource = direction === RpcProbeDirection.inbound ? metadata.rejectedSource : 0
  if (direction === RpcProbeDirection.inbound) metadata.rejectedSource = 0
  observation.emit(direction, content, transfer, detail)
}
