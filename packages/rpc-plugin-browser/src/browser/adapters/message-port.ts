/** Browser public MessagePort shell borrows the SDK's sole EventTarget message algorithm. */
export { createBrowserMessagePortTransport } from '@migaia/rpc-host/plugin'
export type {
  IBrowserMessagePortLike,
  IBrowserMessagePortTransportOptions
} from '@migaia/rpc-host/plugin'
