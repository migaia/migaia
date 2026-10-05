/** Native isolate resource failures belong to the thread adapter, independently of core RPC. */
export const ERROR_SOURCE = '@migaia/rpc/threads'

/** Cold resource queries report failures without changing execution lifecycle. */
export const RpcThreadErrorCode = {
  /** D23: native Worker sampling failed; retain its cause and display unavailable. */
  usageSampleFailed: 'THREAD_USAGE_SAMPLE_FAILED'
} as const
export type IRpcThreadErrorCode = (typeof RpcThreadErrorCode)[keyof typeof RpcThreadErrorCode]
