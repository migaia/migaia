/** RPC failure codes are declared by rpc-contract; this package owns no local codes. */
export const RpcProcessLocalErrorCode = {} as const

/** No package-local semantic values exist; RPC code unions come from rpc-contract. */
export type IRpcProcessLocalErrorCode =
  (typeof RpcProcessLocalErrorCode)[keyof typeof RpcProcessLocalErrorCode]
