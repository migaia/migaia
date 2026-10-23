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
  'getScheduler',
  'emit',
  'registerDetect'
] as const
/** Public backend ids are encoded into PluginHost's stricter registration namespace. */
export const STORAGE_PLUGIN_NAME_PREFIX = 'storage-backend:'

/** Ordinary host operations share the existing zero-UUID default organization. */
export const STORAGE_DEFAULT_ORG = '00000000-0000-0000-0000-000000000000'
