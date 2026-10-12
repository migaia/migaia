/** Stable validation and failure text belongs to the pool boundary, not its native Peer owners. */
export const RpcPoolText = {
  optionsObject: 'pool options must be an object with a spawn source',
  size: 'pool size must be a positive integer',
  maxQueue: 'pool maxQueue must be a finite non-negative integer',
  idleTimeoutMs: 'pool idleTimeoutMs must be a finite positive number no greater than 2147483647',
  closed: 'pool is closing or closed',
  queueFull: 'pool queue is full',
  aborted: 'queued pool call was aborted',
  /** The native cancellation name lets consumers retain their usual AbortError branch. */
  abortName: 'AbortError',
  closeFailed: 'pool member cleanup failed'
} as const

/** Pool lifecycle describes client dispatch only, independently of native supervision state. */
export const RpcPoolState = {
  open: 'open',
  closing: 'closing',
  closed: 'closed'
} as const

export type RpcPoolState = (typeof RpcPoolState)[keyof typeof RpcPoolState]

/** The bounded FIFO default counts waiting operations, excluding occupied member slots. */
export const RPC_POOL_DEFAULT_MAX_QUEUE = 256

/** Global timers share this portable signed 32-bit maximum; larger Node delays become 1ms. */
export const RPC_POOL_MAX_IDLE_TIMEOUT_MS = 2147483647
