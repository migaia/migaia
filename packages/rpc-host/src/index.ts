/** One native host projects every RPC call under its installed transport namespace. */
export { createRpcHost } from './host/create-rpc-host.ts'
export type { IRpcHost, IRpcHostOptions } from './host/public.ts'
export type {
  IRpcNamespace,
  IRpcCallOptions,
  IRpcNotifyOptions,
  IRpcStreamOptions,
  IRpcFanoutResult,
  IRpcClosingEvent,
  IRpcPeerClosedEvent,
  IRpcClosingHandler,
  IRpcPeerClosedHandler
} from './namespace/types.ts'
export type {
  IRpcContext,
  IRpcProvide,
  IRpcProvider,
  IRpcProviderMethod
} from './dispatch/types.ts'
export { defaultRpcReporter } from './host/report.ts'
export { RpcWarningCode } from './host/warning.ts'
export type { IRpcWarning } from './host/warning.ts'
