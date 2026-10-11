/** This private test workspace declares no production errors or runtime exports. */
export const RpcIntegrationErrorCode = {} as const
export type IRpcIntegrationErrorCode = (typeof RpcIntegrationErrorCode)[keyof typeof RpcIntegrationErrorCode]
