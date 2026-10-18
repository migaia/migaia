/** Public Host operations; private naming and admission registries stay with their owners. */
export { assertStorageBackendId, defineFeature, definePlugin } from './contracts.js'
export { createStorageHost, StorageHostFacade } from './storage-host.js'
export type { IStoragePluginCore, IStorageNativePluginDescriptor } from './contracts.js'
export type * from './types.js'
