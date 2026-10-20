import type { IRpcProbeEventView } from './types.js'

/**
 * The public snapshot API explicitly requests a field copy. Detail, error and content keep their
 * existing ownership and reference identity; no nested value is cloned.
 */
export function snapshotProbeEvent(view: IRpcProbeEventView): Readonly<IRpcProbeEventView> {
  return Object.freeze({
    seq: view.seq,
    carrierSeq: view.carrierSeq,
    at: view.at,
    endpointId: view.endpointId,
    stage: view.stage,
    direction: view.direction,
    kind: view.kind,
    outcome: view.outcome,
    messageId: view.messageId,
    method: view.method,
    variation: view.variation,
    senderId: view.senderId,
    targetId: view.targetId,
    receiverId: view.receiverId,
    peerId: view.peerId,
    trace: view.trace,
    sizeBytes: view.sizeBytes,
    chunkIndex: view.chunkIndex,
    chunkCount: view.chunkCount,
    members: view.members,
    durationMs: view.durationMs,
    rejection: view.rejection,
    lifecycle: view.lifecycle,
    error: view.error,
    carrier: view.carrier,
    detail: view.detail,
    content: view.content
  })
}
