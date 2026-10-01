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
  pluginInvalidOption: 'PROCESS_PLUGIN_INVALID_OPTION',
  /**
   * Invalid resilience limits, ownership, or health configuration; correct the named field before
   * opening a connection.
   */
  resilienceInvalidOption: 'PROCESS_RESILIENCE_INVALID_OPTION',
  /** A connection, call-rate, or payload limit rejected admission before provider execution. */
  connectionLimit: 'PROCESS_CONNECTION_LIMIT',
  /**
   * A shared target is suspended after an explicit instance-health event until a ready replacement
   * exists.
   */
  instanceUnhealthy: 'PROCESS_INSTANCE_UNHEALTHY',
  /**
   * An enabled native health ping returned false before its supervision deadline; the owner must
   * restart the unit.
   */
  healthPingFailed: 'PROCESS_HEALTH_PING_FAILED',
  /** A terminal registration rejects new remote calls before they reach its inactive generation. */
  terminalCall: 'PROCESS_TERMINAL_CALL',
  /** A liquidated registration cannot restart; the caller must create a new registration. */
  liquidated: 'PROCESS_LIQUIDATED'
} as const

export type IRpcProcessErrorCode = (typeof RpcProcessErrorCode)[keyof typeof RpcProcessErrorCode]
