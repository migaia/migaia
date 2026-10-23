/** Admission belongs to the cooperative transport; wire and replacement errors keep their owners. */
export const ERROR_SOURCE = 'rpc.transport.coroutine'

/** Invalid sources cannot acquire task ports or supervision authority. */
export const RpcCoroutineErrorCode = {
  /** Supply exactly one callable task or a genuine connection received by that task generation. */
  sourceInvalid: 'COROUTINE_SOURCE_INVALID'
} as const

/** The package's public admission error values. */
export type IRpcCoroutineErrorCode =
  (typeof RpcCoroutineErrorCode)[keyof typeof RpcCoroutineErrorCode]
