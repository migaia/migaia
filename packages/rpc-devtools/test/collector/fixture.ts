import {
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome,
  RpcProbeStage,
  type IRpcProbeEventView
} from '@migaia/rpc-core/probe'

/** Shared input vocabulary keeps repeated fixture identity in one owner. */
export const CollectorFixture = {
  endpoint: 'business-endpoint',
  otherEndpoint: 'other-endpoint',
  method: 'echo',
  otherMethod: 'other',
  sender: 'sender',
  target: 'target',
  receiver: 'receiver',
  peer: 'peer',
  trace: 'trace-one',
  otherTrace: 'trace-two',
  carrier: 'Memory',
  /** Record fixtures supply their own diagnostic source instead of invoking codec fallback metadata. */
  errorSource: 'collector-fixture',
  /** The primary native error must retain this test-data identity across the record codec boundary. */
  primaryErrorCode: 'PRIMARY_FIXTURE',
  /** The cause remains a native TypeError with a distinct diagnostic identity after decoding. */
  causeErrorCode: 'CAUSE_FIXTURE'
} as const

/** Returns a hand-filled mutable public view; callers may reuse it exactly like a Core emitter. */
export function collectorView(seq = 1): IRpcProbeEventView {
  return {
    seq,
    at: 1000 + seq,
    endpointId: CollectorFixture.endpoint,
    stage: RpcProbeStage.message,
    direction: RpcProbeDirection.outbound,
    kind: RpcProbeKind.request,
    outcome: RpcProbeOutcome.settled,
    messageId: `message-${seq}`,
    method: CollectorFixture.method,
    senderId: CollectorFixture.sender,
    targetId: CollectorFixture.target,
    receiverId: CollectorFixture.receiver,
    peerId: CollectorFixture.peer,
    trace: CollectorFixture.trace,
    sizeBytes: 64,
    chunkIndex: -1,
    chunkCount: -1,
    members: -1,
    durationMs: 1,
    rejection: undefined,
    lifecycle: undefined,
    error: undefined,
    carrier: CollectorFixture.carrier,
    detail: undefined,
    content: undefined
  }
}
