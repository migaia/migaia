/**
 * Default sink for background RPC failures when a caller passes no `report` option. Every rpc-*
 * package falls back to it, and it writes to `console.error`. Notice coalescing follows caller
 * configuration, not this function identity; an explicit reporter receives the same events as its
 * wrapper.
 */
export const defaultRpcReporter = (error: unknown): void => {
  console.error(error)
}
