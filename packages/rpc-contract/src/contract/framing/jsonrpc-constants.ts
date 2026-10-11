/** Frame budgets include all header bytes and exclude UTF-8 body bytes from the header. */
export const JsonRpcLimit = {
  headerBytes: 1024,
  bodyBytes: 16_777_216,
  handshakeMs: 10_000
} as const
/** Canonical Content-Length framing never uses the native four-byte stream prefix. */
export const JsonRpcHeader = {
  length: 'content-length',
  type: 'content-type',
  end: '\r\n\r\n',
  line: '\r\n',
  prefix: 'Content-Length: '
} as const
