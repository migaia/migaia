/**
 * Registry of audited libraries. A library listed here renders its API pages only from its
 * reference file and must pass `bun scripts/audit/reference.ts <lib>` with zero findings. See
 * `app/reference/contract.ts` for the rules.
 */
import type { ICode, ILibraryReference } from './contract.js'
import { eventSubscriberReference } from './event-subscriber.js'
import { middlewarePipelineReference } from './middleware-pipeline.js'
import { pluginHostReference } from './plugin-host.js'
import { reactiveReference } from './reactive.js'
import { utilsReference } from './utils.js'
import { resourceReference } from './resource.js'
import { logHostReference } from './log-host.js'
import { logConsoleReference } from './log-plugin-console.js'
import { logHttpReference } from './log-plugin-http.js'
import { logFileReference } from './log-plugin-file.js'
import { logProcessReference } from './log-plugin-process.js'
import { logReasoningReference } from './log-plugin-reasoning.js'
import { logDurableReference } from './log-plugin-durable.js'
import { trayReference } from './tray.js'
import { rpcBrowserReference } from './rpc-plugin-browser.js'
import { rpcThreadsReference } from './rpc-plugin-thread.js'
import { rpcProcessReference } from './rpc-plugin-process.js'
import { storageWebReference } from './storage-web.js'
import { storeLightReference } from './store-light.js'
import { capabilityReference } from './capability.js'
import { lifecycleReference } from './lifecycle.js'
import { serializeReference } from './serialize.js'
import { reference as supervisionReference } from './supervision.js'
import { reference as wasmReference } from './wasm.js'
import { reference as rpcContractReference } from './rpc-contract.js'
import { rpcHostReference } from './rpc-host.js'
import { rpcDevtoolsReference } from './rpc-plugin-devtools.js'
import { rpcPoolReference } from './rpc-plugin-pool.js'
import { rpcCoroutinesReference } from './rpc-plugin-coroutines.js'
import { storageContractReference } from './storage-contract.js'
import { storageHostReference } from './storage-host.js'
import { storageContractCases } from './storage-contract-cases.js'
import { storageHostCases } from './storage-host-cases.js'
import { storageAssertionSymbols } from './storage-assertion-examples.js'
import { storageAuthoringExamples, storageAuthoringSymbols } from './storage-authoring-examples.js'
import { storageHostInputExamples } from './storage-host-authoring.js'
import { storageHostNativeAuthorTypes } from './storage-host-native-authors.js'
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

/** Migrated authoring pages retain their already-maintained examples at the current public owner. */
const storageExamples: Readonly<Record<string, ICode>> = {
  ...storageAuthoringExamples,
  'storage-host:authoring/codec:snapshotCodec': storageHostInputExamples.snapshotCodec,
  'storage-host:authoring/context:snapshotSyncWriteOptions':
    storageHostInputExamples.snapshotSyncWriteOptions,
  'storage-host:authoring/backend:createBackendJournalNamespace':
    storageHostNativeAuthorTypes.IBackendJournalNamespaceOptions.example,
  'storage-host:authoring/backend:collectUniqueIndexOwners':
    storageHostNativeAuthorTypes.IUniqueIndexErrorFactory.example,
  'storage-host:authoring/query:refineStorageVectorQuery':
    storageContractReference.symbols.refineStorageVectorQuery!.example!
}

/** These authoring operations moved intact; their contract descriptions remain canonical. */
const movedStorageAuthoringSymbols = Object.fromEntries(
  [
    'provideCapabilities',
    'assertTransactionOwner',
    'createTransactionOwner',
    'deriveTransactionIterator',
    'nextTransactionIterator',
    'readTransactionOperationContext',
    'registerTransactionFinalizer',
    'resolveConcurrencyPolicy',
    'refineStorageVectorQuery',
    'createStorageBlobBodyReader',
    'createStorageBlobObject',
    'snapshotStorageBlobGet',
    'snapshotStorageBlobList',
    'snapshotStorageBlobPut',
    'hasStorageCapability',
    'useStorageCapability',
    'snapshotCodec',
    'readConcurrencyLockIdentities',
    'runWithConcurrency',
    'snapshotConcurrencyLockHoldings',
    'snapshotConcurrencyLockKeys',
    'snapshotConcurrencyLockRange',
    'snapshotOperationContext',
    'snapshotSyncWriteOptions',
    'snapshotStorageCounterIncrement',
    'createStorageBatchKeyCapture',
    'decodeOrderedStorageKey',
    'decodeStorageOrgKey',
    'encodeOrderedStorageKey',
    'encodeStorageOrgKey',
    'encodeStorageOrgStringPrefix',
    'orderStorageKeysByBytes',
    'snapshotStorageBatchKeys',
    'snapshotStorageKey',
    'snapshotStorageKeyPrefix',
    'snapshotStorageOrgKeyPrefix',
    'compileStorageQueryCondition',
    'compileStorageWhere',
    'createRdfQuery',
    'createRecordQuery',
    'createVectorQuery',
    'snapshotStorageWhere',
    'encodeStorageRdfQuad',
    'encodeStorageRdfTerm',
    'getStorageOrgGraphPrefix',
    'prefixStorageOrgGraph',
    'snapshotStorageRdfPattern',
    'snapshotStorageRdfQuad',
    'snapshotStorageRdfTerm',
    'unprefixStorageOrgGraph',
    'createStorageIteratorLifetime',
    'createSparqlTag',
    'createSqlTag',
    'deriveStorageSqlQuery',
    'snapshotStorageBaseDetailed',
    'createTransactionBuilder',
    'runTransactionOperation',
    'useTransactionCapability',
    'snapshotStorageTtlTarget',
    'snapshotStorageDeleteCountMode',
    'snapshotStorageVector',
    'snapshotStorageVectorCollection',
    'snapshotStorageVectorFilter',
    'snapshotStorageVectorIds',
    'snapshotStorageVectorSearch',
    'snapshotStorageVectorUpsert'
  ].map((name) => [name, storageContractReference.symbols[name]!])
)

/** Attach existing programs and cases without changing any authored contract or option description. */
function withStorageExamples(library: string, reference: ILibraryReference): ILibraryReference {
  /** A re-export of one operation uses the same complete program as its owning module. */
  const examples = Object.fromEntries(
    Object.entries(storageExamples)
      .filter(([key]) => key.startsWith(`${library}:`))
      .map(([key, example]) => [key.slice(key.lastIndexOf(':') + 1), example])
  )
  /**
   * Missing moved symbols reuse the original contract; newly introduced functions have explicit
   * docs.
   */
  const symbols =
    library === 'storage-host'
      ? { ...movedStorageAuthoringSymbols, ...reference.symbols, ...storageAuthoringSymbols }
      : library === 'storage-contract'
        ? { ...reference.symbols, ...storageAssertionSymbols }
        : reference.symbols
  return {
    ...reference,
    symbols: Object.fromEntries(
      Object.entries(symbols).map(([key, doc]) => {
        /** Module-qualified reference keys retain the original operation name. */
        const name = key.slice(key.lastIndexOf(':') + 1)
        /** Only host authoring operations moved the contract's existing runtime examples. */
        const cases =
          library === 'storage-host'
            ? (storageContractCases[name] ?? storageHostCases[name])
            : undefined
        return [
          key,
          {
            ...doc,
            example:
              examples[name] ??
              (Object.hasOwn(reference.symbols, key)
                ? doc.example
                : (cases?.[0]?.example ?? doc.example)),
            cases: doc.cases ?? cases
          }
        ]
      })
    )
  }
}

/** Audited libraries keyed by slug, in the order they were migrated. */
export const libraryReferences: Readonly<Record<string, ILibraryReference>> = {
  'event-subscriber': eventSubscriberReference,
  reactive: reactiveReference,
  'middleware-pipeline': middlewarePipelineReference,
  'plugin-host': pluginHostReference,
  utils: utilsReference,
  resource: resourceReference,
  'log-host': logHostReference,
  'log-plugin-console': logConsoleReference,
  'log-plugin-http': logHttpReference,
  'log-plugin-file': logFileReference,
  'log-plugin-process': logProcessReference,
  'log-plugin-reasoning': logReasoningReference,
  'log-plugin-durable': logDurableReference,
  tray: trayReference,
  'rpc-plugin-browser': rpcBrowserReference,
  'rpc-plugin-thread': rpcThreadsReference,
  'rpc-plugin-process': rpcProcessReference,
  'storage-web': storageWebReference,
  'store-light': storeLightReference,
  capability: capabilityReference,
  lifecycle: lifecycleReference,
  serialize: serializeReference,
  supervision: supervisionReference,
  wasm: wasmReference,
  'rpc-contract': rpcContractReference,
  'rpc-host': rpcHostReference,
  'rpc-plugin-devtools': rpcDevtoolsReference,
  'rpc-plugin-pool': rpcPoolReference,
  'rpc-plugin-coroutines': rpcCoroutinesReference,
  'storage-contract': withStorageExamples('storage-contract', storageContractReference),
  'storage-host': withStorageExamples('storage-host', storageHostReference),
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
