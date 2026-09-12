/** Internal R02 foundations; intentionally absent from package root and public exports. */
export {
  assertStorageBackendId,
  defineFeature,
  definePlugin,
  readStorageNativePluginMetadata
} from './contracts.js'
export {
  pluginNameFromBackendId,
  reactiveAdapterNameFromBackendId,
  STORAGE_LIVE_QUERY_SERVICE_NAME
} from './names.js'
export { createStorageHost, StorageHostFacade } from './storage-host.js'
export type { IStoragePluginCore, IStorageNativePluginDescriptor } from './contracts.js'
export type * from './types.js'
