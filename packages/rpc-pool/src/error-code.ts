/** The stable package source identifies pool-owned admission and cleanup failures. */
export const RPC_POOL_ERROR_SOURCE = '@migaia/rpc-pool'

/** Only pool-owned failures receive these registered codes; Peer errors pass through unchanged. */
export const RpcPoolErrorCode = {
  /** Invalid construction or resize arguments are rejected before any native acquisition. */
  invalidOptions: 'INVALID_OPTIONS',
  /** A closing pool rejects new work while draining operations already accepted. */
  poolClosed: 'POOL_CLOSED',
  /** A full bounded FIFO rejects the new operation without calling a Peer. */
  queueFull: 'QUEUE_FULL',
  /** Cancellation removes only an operation still waiting in the pool FIFO. */
  callAborted: 'CALL_ABORTED',
  /** All member closes were attempted and their original failures are collected. */
  closeFailed: 'CLOSE_FAILED'
} as const

export type IRpcPoolErrorCode = (typeof RpcPoolErrorCode)[keyof typeof RpcPoolErrorCode]
