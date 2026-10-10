/** Browser operations preserve Core error identities and declare no independent thrown errors. */
export const RpcBrowserErrorCode = {} as const
export type IRpcBrowserErrorCode = (typeof RpcBrowserErrorCode)[keyof typeof RpcBrowserErrorCode]
