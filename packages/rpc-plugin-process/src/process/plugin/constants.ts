/** A process plugin receives either framed bytes or an already framed message channel. */
export const ProcessPluginChannelKind = {
  byte: 'byte',
  messagePort: 'message'
} as const

export type ProcessPluginChannelKind =
  (typeof ProcessPluginChannelKind)[keyof typeof ProcessPluginChannelKind]

/** A borrowed external process is represented only by its locally owned socket session. */
export const ProcessConnectionProfile = {
  kind: 'process-connection'
} as const

export type ProcessConnectionProfile =
  (typeof ProcessConnectionProfile)[keyof typeof ProcessConnectionProfile]
