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
  'getChangeController',
  'getStore',
  'getBackendId',
  'getLifecycle',
  'onDispose',
  'getScheduler',
  'getPublishedBackend',
  'emit',
  'registerDetect'
] as const
/** Public backend ids are encoded into PluginHost's stricter registration namespace. */
export const STORAGE_PLUGIN_NAME_PREFIX = 'storage-backend:'
/** Journal bootstrap remains an internal original PluginHost registration, outside backend ids. */
export const STORAGE_JOURNAL_BOOTSTRAP_PREFIX = 'storage-journal-bootstrap:'

/** Ordinary host operations share the existing zero-UUID default organization. */
export const STORAGE_DEFAULT_ORG = '00000000-0000-0000-0000-000000000000'
/** Memory remains the original fallback label for shared flat-key diagnostic inputs. */
export const STORAGE_MEMORY_BACKEND = 'memory'
/** Organization views reject these raw native query entry points before driver execution. */
export const STORAGE_ORG_NATIVE_QUERY_METHODS = ['sql', 'sparql'] as const

/** Finite fluent families accepted from selected Feature outputs by the original host installer. */
export const STORAGE_CHAIN_FAMILIES = Object.freeze({
  query: true,
  tx: true,
  vector: true,
  rdf: true
})

/** Stable native plugin identity for explicit journal runtime installation and duplicate detection. */
export const STORAGE_JOURNAL_PLUGIN_ID = 'storage-journal'
