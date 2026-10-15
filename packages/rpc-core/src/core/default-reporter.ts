/**
 * Default sink for background RPC failures when a caller passes no `report` option. Every rpc-*
 * package falls back to it, and it writes to `console.error`. Its single exported identity lets a
 * caller recognize the default reporter (for example to report an expected notice once) without
 * comparing against `console.error` itself.
 */
export const defaultRpcReporter = (error: unknown): void => {
  console.error(error)
}
