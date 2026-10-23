/** Stable WebTransport boundary diagnostics are shared by its opener and owning tests. */
export const WebTransportPluginText = {
  /** The native plugin registration defaults to this carrier label. */
  name: 'web-transport',
  /** The original reliable byte owner rejects a non-text JSON control frame with this context. */
  expectedString: 'WebTransport byte control requires a string',
  /** Native ready/open/lock failures retain their original identity on the transport boundary. */
  openFailed: 'WebTransport reliable stream could not open',
  /** EOF retires only the created stream; the caller still owns the session. */
  closed: 'WebTransport reliable stream is closed',
  /** All original reader/writer cleanup failures remain reachable through this aggregate. */
  cleanupFailed: 'WebTransport reliable stream cleanup failed'
} as const
