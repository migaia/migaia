/** Stable error identity for the unit-neutral remote layer. */
export const ERROR_SOURCE = '@migaia/rpc/remote'

/** Public remote failures; each code has one owner and one caller action. */
export const RpcRemoteLayerErrorCode = {
  /** A description or control payload violates the remote contract; correct it before retrying. */
  contractInvalid: 'REMOTE_CONTRACT_INVALID',
  /** A supervisor cannot provide a ready unit or a channel cannot open; inspect the cause. */
  startFailed: 'REMOTE_START_FAILED',
  /** The registration was released or its generation left; wait for another ready generation. */
  closed: 'REMOTE_CLOSED'
} as const

export type IRpcRemoteLayerErrorCode =
  (typeof RpcRemoteLayerErrorCode)[keyof typeof RpcRemoteLayerErrorCode]
