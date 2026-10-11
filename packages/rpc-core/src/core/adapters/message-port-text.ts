/** Stable MessagePort-only text stays outside the RPC root entry's static graph. */
export const RpcMessagePortErrorText = {
  /** Browser deserialization diagnostic delivered to transport-error listeners. */
  browserMessagePortDeserializeFailed: '[rpc] browser message port could not deserialize a message',
  /** Browser terminal send and subscribe failure text consumed by the MessagePort adapter. */
  browserMessagePortClosed: '[rpc] browser message port is closed',
  /** Node deserialization diagnostic retains the adapter's optional detail suffix. */
  messagePortDeserializeFailed: (detail: string): string =>
    `[rpc] message port could not deserialize a message${detail}`,
  /** Node terminal send and subscribe failure text consumed by the MessagePort adapter. */
  messagePortClosed: '[rpc] message port is closed',
  /** Node close-event diagnostic replayed to late transport-error listeners. */
  messagePortTerminated: '[rpc] message port closed'
} as const
