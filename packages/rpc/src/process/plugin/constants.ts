/** A process plugin receives either framed bytes or an already framed message channel. */
export const ProcessPluginChannelKind = {
  byte: 'byte',
  messagePort: 'message'
} as const

export type ProcessPluginChannelKind =
  (typeof ProcessPluginChannelKind)[keyof typeof ProcessPluginChannelKind]

/** Byte deployments name their protocol so bootstrap admission can protect the first wire byte. */
export const ProcessPluginWire = {
  native: 'native',
  jsonrpc: 'jsonrpc'
} as const

export type ProcessPluginWire = (typeof ProcessPluginWire)[keyof typeof ProcessPluginWire]

/** A borrowed external process is represented only by its locally owned socket session. */
export const ProcessConnectionProfile = {
  kind: 'process-connection'
} as const

export type ProcessConnectionProfile =
  (typeof ProcessConnectionProfile)[keyof typeof ProcessConnectionProfile]
