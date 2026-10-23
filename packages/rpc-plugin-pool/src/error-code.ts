/** Stable error domain owned by this code table; package moves preserve this identity. */
export const ERROR_SOURCE = 'rpc.pool'

/** The stable package source identifies pool-owned admission and cleanup failures. */
export const RPC_POOL_ERROR_SOURCE = ERROR_SOURCE

/** Only pool-owned failures receive these registered codes; Peer errors pass through unchanged. */
export const RpcPoolErrorCode = {
  /** Invalid construction or resize arguments are rejected before any native acquisition. */
  invalidOptions: 'INVALID_OPTIONS',
  /** Listener and parent-only sources cannot open independent members; choose spawn or connect. */
  transportUnsupported: 'POOL_TRANSPORT_UNSUPPORTED',
  /** Closing/closed admission rejects new calls, first stream next or resize; create another pool. */
  poolClosed: 'POOL_CLOSED',
  /**
   * All available slots are reserved and the bounded FIFO is full; the new call never reaches a
   * Peer.
   */
  queueFull: 'QUEUE_FULL',
  /**
   * Queued cancellation removes only its FIFO entry; a native AbortError retains the signal reason
   * on cause.
   */
  callAborted: 'CALL_ABORTED',
  /**
   * Final close attempted all members but retained one or more close failures, including earlier
   * retirement failures. Inspect AggregateError.errors/cause; the pool is terminal, not reopened.
   */
  closeFailed: 'CLOSE_FAILED'
} as const

/** Registered pool-owned failure values; original Peer errors keep their own identities. */
export type IRpcPoolErrorCode = (typeof RpcPoolErrorCode)[keyof typeof RpcPoolErrorCode]
