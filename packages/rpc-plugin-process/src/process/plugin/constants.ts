/** A process plugin receives either framed bytes or an already framed message channel. */
export const ProcessPluginChannelKind = {
  byte: 'byte',
  messagePort: 'message'
} as const

export type ProcessPluginChannelKind =
  (typeof ProcessPluginChannelKind)[keyof typeof ProcessPluginChannelKind]

/** Byte deployments name their protocol so bootstrap admission can protect the first wire byte. */
export const ProcessPluginWire = {
  /** Prefix-framed native RPC negotiation and its installed control capabilities. */
  native: 'native',
  /** Content-Length JSON-RPC profile; it has no default native ping health. */
  jsonrpc: 'jsonrpc'
} as const

/** Supported byte-wire profiles; omission in live deployment options selects native. */
export type ProcessPluginWire = (typeof ProcessPluginWire)[keyof typeof ProcessPluginWire]

/** Default offers identify the process facade without guessing a platform runtime. */
export const PROCESS_PLUGIN_PEER_RUNTIME = 'process'

/** A borrowed external process is represented only by its locally owned socket session. */
export const ProcessConnectionProfile = {
  kind: 'process-connection'
} as const

export type ProcessConnectionProfile =
  (typeof ProcessConnectionProfile)[keyof typeof ProcessConnectionProfile]
