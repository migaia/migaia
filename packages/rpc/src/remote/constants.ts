/** Reserved method namespace shared by plugin and host remote endpoints. */
export const RemoteMethodName = {
  /** Mutually negotiated v2 application directory; the legacy describe route stays separate. */
  runtimeDescribe: 'migaia.remote.runtime.describe',
  /** Distinct internal stream wire routes share the original provider registry with scalar routes. */
  runtimeStreamPrefix: 'migaia.remote.runtime.stream.',
  /** Automatic application methods cannot impersonate the reserved library control namespace. */
  runtimeNamespace: 'migaia.remote.',
  describe: 'migaia.remote.describe',
  hostUse: 'migaia.remote.host.use',
  hostUnUse: 'migaia.remote.host.unUse',
  hostInspect: 'migaia.remote.host.inspect'
} as const

/** Names for service plugins are private to remote; user plugins must avoid this prefix. */
export const REMOTE_SERVE_PLUGIN_PREFIX = 'migaia_remote_serve#'

/** Original process drain budget, shared with native thread shutdown without another drain owner. */
export const DEFAULT_DRAIN_MS = 5_000
