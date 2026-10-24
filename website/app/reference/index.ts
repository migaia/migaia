/**
 * Registry of audited libraries. A library listed here renders its API pages only from its
 * reference file and must pass `bun scripts/audit/reference.ts <lib>` with zero findings. See
 * `app/reference/contract.ts` for the rules.
 */
import type { ILibraryReference } from './contract.js'
import { eventSubscriberReference } from './event-subscriber.js'
import { middlewarePipelineReference } from './middleware-pipeline.js'
import { pluginHostReference } from './plugin-host.js'
import { reactiveReference } from './reactive.js'
import { utilsReference } from './utils.js'
import { resourceReference } from './resource.js'
import { loggerReference } from './logger.js'
import { trayReference } from './tray.js'
import { rpcBrowserReference } from './rpc-browser.js'
import { rpcThreadsReference } from './rpc-threads.js'
import { rpcProcessReference } from './rpc-process.js'
import { storageWebReference } from './storage-web.js'
import { storeLightReference } from './store-light.js'
import { capabilityReference } from './capability.js'
import { lifecycleReference } from './lifecycle.js'
import { serializeReference } from './serialize.js'
import { reference as supervisionReference } from './supervision.js'
import { reference as wasmReference } from './wasm.js'
import { reference as rpcContractReference } from './rpc-contract.js'
import { reference as rpcCoreReference } from './rpc-core.js'
import { rpcDevtoolsReference } from './rpc-devtools.js'
import { rpcPoolReference } from './rpc-pool.js'
import { storageContractReference } from './storage-contract.js'
import { storageHostReference } from './storage-host.js'
import { storagePluginRedisReference } from './storage-plugin-redis.js'
import { storagePluginPostgresReference } from './storage-plugin-postgres.js'
import { storagePluginSqliteReference } from './storage-plugin-sqlite.js'
import { storagePluginQdrantReference } from './storage-plugin-qdrant.js'
import { storagePluginSparqlReference } from './storage-plugin-sparql.js'
import { storagePluginObjectReference } from './storage-plugin-object.js'
import { storagePluginCacheReference } from './storage-plugin-cache.js'
import { storagePluginArchiveReference } from './storage-plugin-archive.js'
import { storeDevtoolsReference } from './store-devtools.js'
import { storeIndexedReference } from './store-indexed.js'
import { storeKeyedReference } from './store-keyed.js'
import { storeMiddlewareReference } from './store-middleware.js'
import { storePersistReference } from './store-persist.js'
import { storeReactReference } from './store-react.js'
import { storeSharedReference } from './store-shared.js'
import { storeSsrReference } from './store-ssr.js'
import { storeWasmReference } from './store-wasm.js'
import { storeWorkerReference } from './store-worker.js'
import { microHubReference } from './micro-hub.js'

/** Audited libraries keyed by slug, in the order they were migrated. */
export const libraryReferences: Readonly<Record<string, ILibraryReference>> = {
  'event-subscriber': eventSubscriberReference,
  reactive: reactiveReference,
  'middleware-pipeline': middlewarePipelineReference,
  'plugin-host': pluginHostReference,
  utils: utilsReference,
  resource: resourceReference,
  logger: loggerReference,
  tray: trayReference,
  'rpc-browser': rpcBrowserReference,
  'rpc-threads': rpcThreadsReference,
  'rpc-process': rpcProcessReference,
  'storage-web': storageWebReference,
  'store-light': storeLightReference,
  capability: capabilityReference,
  lifecycle: lifecycleReference,
  serialize: serializeReference,
  supervision: supervisionReference,
  wasm: wasmReference,
  'rpc-contract': rpcContractReference,
  'rpc-core': rpcCoreReference,
  'rpc-devtools': rpcDevtoolsReference,
  'rpc-pool': rpcPoolReference,
  'storage-contract': storageContractReference,
  'storage-host': storageHostReference,
  'storage-plugin-redis': storagePluginRedisReference,
  'storage-plugin-postgres': storagePluginPostgresReference,
  'storage-plugin-sqlite': storagePluginSqliteReference,
  'storage-plugin-qdrant': storagePluginQdrantReference,
  'storage-plugin-sparql': storagePluginSparqlReference,
  'storage-plugin-object': storagePluginObjectReference,
  'storage-plugin-cache': storagePluginCacheReference,
  'storage-plugin-archive': storagePluginArchiveReference,
  'store-devtools': storeDevtoolsReference,
  'store-indexed': storeIndexedReference,
  'store-keyed': storeKeyedReference,
  'store-middleware': storeMiddlewareReference,
  'store-persist': storePersistReference,
  'store-react': storeReactReference,
  'store-shared': storeSharedReference,
  'store-ssr': storeSsrReference,
  'store-wasm': storeWasmReference,
  'store-worker': storeWorkerReference,
  'micro-hub': microHubReference
}

/** Returns the reference of an audited library, or `undefined` when it is not migrated yet. */
export function referenceFor(library: string): ILibraryReference | undefined {
  return libraryReferences[library]
}
