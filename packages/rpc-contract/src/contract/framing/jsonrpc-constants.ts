/** Frame budgets include all header bytes and exclude UTF-8 body bytes from the header. */
export const JsonRpcLimit = {
  /** Maximum Content-Length header block bytes, including its terminating separator. */
  headerBytes: 1024,
  /** Maximum complete UTF-8 JSON body bytes, independent of header size. */
  bodyBytes: 16_777_216,
  /** Default bridge hello deadline used by its connection owner, not a decoder timer. */
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
