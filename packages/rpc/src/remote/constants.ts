/** Reserved method namespace shared by plugin and host remote endpoints. */
export const RemoteMethodName = {
  describe: 'migaia.remote.describe',
  hostUse: 'migaia.remote.host.use',
  hostUnUse: 'migaia.remote.host.unUse',
  hostInspect: 'migaia.remote.host.inspect'
} as const

/** Names for service plugins are private to remote; user plugins must avoid this prefix. */
export const REMOTE_SERVE_PLUGIN_PREFIX = 'migaia_remote_serve#'
