// @ts-expect-error PluginHost naming is owned by private host/names.
import { pluginNameFromBackendId } from '../../src/host.js'
// @ts-expect-error reactive registration naming is not an application capability.
import { reactiveAdapterNameFromBackendId } from '../../src/host.js'
// @ts-expect-error live-query service registration is private.
import { STORAGE_LIVE_QUERY_SERVICE_NAME } from '../../src/host.js'
// @ts-expect-error native WeakMap admission metadata is not a public lookup API.
import { readStorageNativePluginMetadata } from '../../src/host.js'

void pluginNameFromBackendId
void reactiveAdapterNameFromBackendId
void STORAGE_LIVE_QUERY_SERVICE_NAME
void readStorageNativePluginMetadata
