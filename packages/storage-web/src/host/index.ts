/** Internal R02 foundations; intentionally absent from package root and public exports. */
export {
  assertStorageBackendId,
  defineStorageBackendFeature,
  defineStorageBackendKind,
  defineStorageBackendPlugin,
  readStorageBackendFeatureMetadata,
  readStorageBackendPluginMetadata
} from './contracts.js'
export {
  pluginNameFromBackendId,
  reactiveAdapterNameFromBackendId,
  STORAGE_LIVE_QUERY_SERVICE_NAME
} from './names.js'
export { compileStorageFeatureTopology } from './feature-compiler.js'
export { createStorageHost, StorageHostFacade } from './storage-host.js'
export type * from './types.js'
