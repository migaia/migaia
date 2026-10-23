import type { IBrowserPluginOptions } from './plugin-types.js'

/** A reliable native stream is owned by this plugin; its enclosing session stays borrowed. */
export type IWebTransportReliableStream = Readonly<{
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
}>
/** Only connection readiness and one native reliable stream are needed from a WebTransport. */
export type IWebTransportReliableSession = Readonly<{
  ready?: Promise<unknown>
  createBidirectionalStream(): Promise<IWebTransportReliableStream>
}>
/** Cold installation opens one ordered reliable stream on the caller's existing session. */
export type IWebTransportPluginOptions = IBrowserPluginOptions &
  Readonly<{
    session: IWebTransportReliableSession
  }>
