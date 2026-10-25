/** Private bootstrap records are consumed before core owns the message listener. */
export const ThreadBootstrap = {
  data: 'migaia.thread.data'
} as const

/** Native lifecycle event names belong to launcher adapters, never RPC transport policy. */
export const ThreadEvent = {
  message: 'message',
  /** Native deserialization failure retires an incomplete private bootstrap. */
  messageerror: 'messageerror',
  error: 'error',
  exit: 'exit',
  close: 'close'
} as const

/** Launch identity is adapter-owned and monotonic even when runtime IDs are recycled. */
export const THREAD_FINGERPRINT_PREFIX = 'rpc-thread-'

/** Native Node heap-limit identity selects supervision's resource-violation classification. */
export const THREAD_HEAP_ERROR_CODE = 'ERR_WORKER_OUT_OF_MEMORY'

/** A dedicated Worker without the launcher's private bootstrap must not retain capture forever. */
export const THREAD_BOOTSTRAP_TIMEOUT_MS = 10_000

/** Default transport identity is shared by definition name, namespace and native diagnostics. */
export const THREAD_NAMESPACE = 'thread'
