import type {
  IBackendLifecycleController,
  createBackendChangeController
} from '@migaia/storage-host/sdk'
import type { captureIndexedDbTtlClock, createIndexedDbTtlAccess } from './indexed-db-ttl.ts'
import type {
  createIndexedDbJournalImages,
  isIndexedDbJournalRevision
} from './indexed-db-images.ts'
import type { acquireIndexedDbCoordination } from './indexed-db-coordination.ts'
import type {
  createIndexedDbTtlApi,
  transactionTtlApi,
  indexedDbRegistrationTtl
} from './indexed-db-ttl-assembly.ts'
import type {
  createIndexedDbBatchApi,
  createIndexedDbScopeBatch
} from './indexed-db-batch-assembly.ts'
import type {
  createIndexedDbPhysicalJournal,
  indexedDbRegistrationJournal,
  createIndexedDbRegistrationImages,
  createIndexedDbUndo
} from './indexed-db-journal-assembly.ts'
import type { indexedDbNativeAfterCommit } from './indexed-db-notifications-assembly.ts'
import type { IIndexedDbContext, IIndexedDbStore } from './indexed-db.ts'
import type { IStorageChange } from '@migaia/storage-contract'
/** Installation-local Feature owners; absent entries do not import optional implementations. */
export type IIndexedDbAssemblyPlan = {
  /** Only this explicit owner imports the full canonical record-query keyset implementation. */
  keyset?: {
    readonly query: typeof import('@migaia/storage-host/sdk').createRecordQuery
  }
  indexes?: {
    readonly assertHandle: typeof import('./indexed-db-indexes-assembly.ts').assertHandle
    readonly initialize: typeof import('./indexed-db-indexes-assembly.ts').IndexedDbIndexesAssembly.prototype.initialize
    readonly ensureSchema: (database: IDBDatabase) => boolean
    readonly validateSchema: (database: IDBDatabase) => void
    readonly beforeCommit: typeof import('./indexed-db-indexes-assembly.ts').IndexedDbIndexesAssembly.prototype.beforeCommit
    readonly register: typeof import('./indexed-db-indexes-assembly.ts').registerIndexedDbBackfill
    readonly api: typeof import('./indexed-db-indexes-assembly.ts').createIndexedDbStoreIndexes
    readonly scope: typeof import('./indexed-db-indexes-assembly.ts').createIndexedDbScopeIndexes
  }
  ttl?: {
    readonly clock: typeof captureIndexedDbTtlClock
    readonly access: typeof createIndexedDbTtlAccess
    readonly api: typeof createIndexedDbTtlApi
    readonly transaction: typeof transactionTtlApi
    readonly registration: typeof indexedDbRegistrationTtl
    ensureSchema(metadata: IDBObjectStore): boolean
    hasSchema(metadata: IDBObjectStore): boolean
  }
  batch?: {
    readonly observe: typeof import('./batch.ts').observeBrowserBatch
    readonly api: typeof createIndexedDbBatchApi
    readonly scope: typeof createIndexedDbScopeBatch
  }
  journal?: {
    readonly images: typeof createIndexedDbJournalImages
    readonly isRevision: typeof isIndexedDbJournalRevision
    readonly binding: typeof createIndexedDbPhysicalJournal
    readonly registration: typeof indexedDbRegistrationJournal
    readonly registrationImages: typeof createIndexedDbRegistrationImages
    readonly undo: typeof createIndexedDbUndo
  }
  notifications?: {
    readonly controller: typeof createBackendChangeController
    readonly coordination: typeof acquireIndexedDbCoordination
    readonly afterCommit: typeof indexedDbNativeAfterCommit
    readonly publish: typeof import('./indexed-db-notifications-assembly.ts').publishChange
    external(controller: IBackendLifecycleController, change: IStorageChange): void
    subscribe<T>(
      context: IIndexedDbContext<T>,
      listener: Parameters<IIndexedDbStore<T>['subscribeChanges']>[0]
    ): ReturnType<IIndexedDbStore<T>['subscribeChanges']>
  }
  changeFeed?: {
    watch<T>(
      context: IIndexedDbContext<T>,
      ...args: Parameters<IIndexedDbStore<T>['watch']>
    ): ReturnType<IIndexedDbStore<T>['watch']>
  }
}
