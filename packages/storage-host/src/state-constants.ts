/** Original native descriptor hook names; storage metadata is consumed before this boundary. */
export const STORAGE_DESCRIPTOR_HOOKS = ['install', 'expose', 'featureExpose'] as const
/** Storage-owned author metadata never enters PluginHost's closed native descriptor vocabulary. */
export const STORAGE_DESCRIPTOR_METADATA = [
  'kind',
  'capabilityInstaller',
  'journalBinding'
] as const
/** Host-injected expose methods cannot be replaced by a backend author. */
export const STORAGE_RESERVED_EXPOSE = [
  'getKind',
  'getStore',
  'getBackendId',
  'getLifecycle',
  'onDispose',
  'getScheduler'
] as const
/** Public backend ids are encoded into PluginHost's stricter registration namespace. */
export const STORAGE_PLUGIN_NAME_PREFIX = 'storage-backend:'
