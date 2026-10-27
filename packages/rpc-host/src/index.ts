/** One native host projects every RPC call under its installed transport namespace. */
export { createRpcHost } from './host/create-rpc-host.js'
export type { IRpcHost, IRpcHostOptions } from './host/public.js'
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
} from './namespace/types.js'
export type {
  IRpcContext,
  IRpcProvide,
  IRpcProvider,
  IRpcProviderMethod
} from './dispatch/types.js'
export { defaultRpcReporter } from './host/report.js'
export { RpcWarningCode } from './host/warning.js'
export type { IRpcWarning } from './host/warning.js'
