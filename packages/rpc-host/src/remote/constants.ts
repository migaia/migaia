export { RemoteMethodName } from '@migaia/rpc-contract/remote'

/** Names for service plugins are private to remote; user plugins must avoid this prefix. */
export const REMOTE_SERVE_PLUGIN_PREFIX = 'migaia_remote_serve#'

/** Original process drain budget, shared with native thread shutdown without another drain owner. */
export const DEFAULT_DRAIN_MS = 5_000
