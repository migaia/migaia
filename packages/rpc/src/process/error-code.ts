/** Stable source for errors owned by native process channels and launch adapters. */
export const ERROR_SOURCE = '@migaia/rpc/process'

/** Process boundary failures; callers close or recreate the affected connection. */
export const RpcProcessErrorCode = {
  /** Handshake exceeded its scheduler deadline; caller must open a new channel. */
  handshakeTimeout: 'PROCESS_HANDSHAKE_TIMEOUT',
  /** Peer authorization failed; caller must not retry without valid credentials. */
  authRejected: 'PROCESS_CHANNEL_AUTH_REJECTED',
  /** A closed process channel rejected further work; caller must reconnect. */
  channelClosed: 'PROCESS_CHANNEL_CLOSED',
  /** Dial or launch could not establish a channel; caller may inspect the original cause. */
  connectFailed: 'PROCESS_CHANNEL_CONNECT_FAILED',
  /** The requested local listener could not bind; caller must choose an available address. */
  listenFailed: 'PROCESS_CHANNEL_LISTEN_FAILED',
  /**
   * Invalid process-plugin options violate R1/R2/R8 before launch; caller must correct the named
   * field.
   */
  pluginInvalidOption: 'PROCESS_PLUGIN_INVALID_OPTION'
} as const

export type IRpcProcessErrorCode = (typeof RpcProcessErrorCode)[keyof typeof RpcProcessErrorCode]
