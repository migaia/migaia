// Physical construction, layout resolution, native state and admitted attempts for the IndexedDB backend (see ./indexed-db.ts).
import type { createIndexedDbJournalImages } from './indexed-db-images.ts'
import {
  StorageContractError,
  StorageContractErrorCode,
  implement,
  kv,
  records,
  ttl,
  type ITransactionTtlApi,
  TransactionActivityMode,
  ConcurrencyHolderState,
  type IConcurrencyAttempt,
  type IConcurrencyAttemptContext
} from '@migaia/storage-contract'
import {
  createTransactionOwner,
  assertTransactionOwner,
  type IBackendJournalTransaction,
  createStorageOperationReporter,
  createStorageOperationRuntime,
  reportCleanupError,
  resolveStorageNamespace
} from '@migaia/storage-host/sdk'
import type { IStorageJournalImage, IStorageJournalTarget } from '@migaia/storage-host'
import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import { StorageBackend, StorageBrowserOwnerLabel, StorageOperation } from '../constants.ts'
import type { IStorageKey } from '../types/context.ts'
import type { ITransactionScope } from '@migaia/storage-contract'
import { acquireIndexedDbLocks } from './indexed-db-locks.ts'
import { indexedDbFeatureMissing } from './indexed-db-base-access.ts'
import {
  provideBackendConstruction,
  browserKeyValueApi,
  type IBackendRuntime
} from './construction.ts'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { createBrowserOrgBinding } from './organizations.ts'
import { attemptNative } from './indexed-db-attempt.ts'
import {
  isValidStoreName,
  INTERNAL_STORE_NAMES,
  indexedDbLayoutFingerprint,
  normalizeIndexedDbOperationError
} from './indexed-db-layout.ts'
import { assertLive, createIndexedDbController } from './indexed-db-lifecycle.ts'
import { open } from './indexed-db-open.ts'
import { dropData, transactionRecordApi } from './indexed-db-root.ts'
import type { IIndexedDbLogicalTransaction } from './indexed-db-root.ts'
import { CAPABILITIES, indexedDbHost } from './indexed-db.ts'
import type {
  IIndexedDbContext,
  IIndexedDbProvidedStore,
  IIndexedDbPhysical,
  IIndexedDbTransactionScope
} from './indexed-db.ts'

/** Retain the original provider, transaction owner, and native deletion closure for every org. */
export function createIndexedDbPhysical<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['physical'] {
  return {
    ...indexedDbContext.construction,
    journalBinding:
      indexedDbContext.assemblies.journal?.binding(indexedDbContext) ??
      indexedDbFeatureMissing.binding(),
    dropData: () => dropData(indexedDbContext),
    getPreparedClient: () => {
      assertLive(indexedDbContext)
      /** The original Feature executor already awaits this accessor inside its operation budget. */
      const prepared = () => {
        if (indexedDbContext.runtime.journal?.active())
          throw new StorageContractError(StorageContractErrorCode.unsupported, {
            backend: StorageBackend.indexedDb
          })
        /** A prepared physical connection retains its original identity and synchronous fast path. */
        if (
          indexedDbContext.prepareState === 'ready' &&
          indexedDbContext.deleting === undefined &&
          indexedDbContext.activeDatabase !== undefined
        )
          return indexedDbContext.activeDatabase
        return open(indexedDbContext, createStorageOperationRuntime())
      }
      return indexedDbContext.runtime.journal === undefined
        ? prepared()
        : indexedDbContext.runtime.journal.prepare().then(prepared)
    },
    getTransactionClient: (scope: object) => {
      /** Only the canonical owner can authorize a live view for this exact provided store. */
      const { id } = assertTransactionOwner(indexedDbContext.construction.store, scope)
      /** This lookup exposes the already-open native transaction and grants no new authority. */
      const native = indexedDbContext.nativeTransactions.get(id)
      if (native === undefined)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      /** Raw native Feature writes cannot bypass the selected commit image protocol. */
      if (indexedDbContext.runtime.journal?.active())
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: StorageBackend.indexedDb
        })
      return native.native
    }
  }
}

/** Capture construction options and the supported realm ports before any native acquisition. */
export function captureIndexedDbConfiguration<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): void {
  if (
    indexedDbContext.options === null ||
    typeof indexedDbContext.options !== 'object' ||
    Array.isArray(indexedDbContext.options)
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IndexedDB options must be an object')
    })

  try {
    indexedDbContext.configuredDbName = indexedDbContext.options.dbName
    indexedDbContext.configuredKvStoreName = indexedDbContext.options.kvStoreName
    indexedDbContext.configuredBytesStoreName = indexedDbContext.options.bytesStoreName
    indexedDbContext.configuredRecordsStoreName = indexedDbContext.options.recordsStoreName
    indexedDbContext.configuredCleanupLegacyRecords = indexedDbContext.options.cleanupLegacyRecords
    indexedDbContext.configuredFactory = indexedDbContext.options.factory
    indexedDbContext.journalFactoryIsPrivate = indexedDbContext.options.journalFactoryIsPrivate
    if (
      indexedDbContext.journalFactoryIsPrivate !== undefined &&
      indexedDbContext.journalFactoryIsPrivate !== true
    )
      throw new TypeError(StorageErrorText.indexedDbJournalFactoryIsolationInvalid)
    indexedDbContext.configuredKeyRange = indexedDbContext.options.keyRange
    /** Read the optional owner and its label only once during this store's construction. */
    const owner = indexedDbContext.options.owner
    if (
      owner !== undefined &&
      (typeof owner !== 'object' || owner === null || Array.isArray(owner))
    )
      throw new TypeError(StorageErrorText.indexedDbOwnerInvalid)
    indexedDbContext.ownerLabel = owner?.label ?? StorageBrowserOwnerLabel
    if (typeof indexedDbContext.ownerLabel !== 'string')
      throw new TypeError(StorageErrorText.indexedDbOwnerInvalid)
  } catch (cause) {
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause
    })
  }

  try {
    indexedDbContext.realmDefaultFactory = (globalThis as { indexedDB?: IDBFactory }).indexedDB
  } catch {
    indexedDbContext.realmDefaultFactory = undefined
  }

  try {
    indexedDbContext.broadcastChannel = (
      globalThis as { BroadcastChannel?: typeof BroadcastChannel }
    ).BroadcastChannel
  } catch {
    indexedDbContext.broadcastChannel = undefined
  }

  try {
    indexedDbContext.webLocks = globalThis.navigator?.locks
  } catch {
    indexedDbContext.webLocks = undefined
  }
}
/** Resolve and validate the original database layout before opening or binding resources. */
export function resolveIndexedDbLayout<TValue>(indexedDbContext: IIndexedDbContext<TValue>): void {
  indexedDbContext.dbName =
    indexedDbContext.configuredDbName === undefined
      ? 'storage-plugin-browser'
      : indexedDbContext.configuredDbName

  indexedDbContext.kvStoreName =
    indexedDbContext.configuredKvStoreName === undefined
      ? 'kv'
      : indexedDbContext.configuredKvStoreName

  indexedDbContext.bytesStoreName =
    indexedDbContext.configuredBytesStoreName === undefined
      ? 'bytes'
      : indexedDbContext.configuredBytesStoreName

  indexedDbContext.recordsStoreName =
    indexedDbContext.configuredRecordsStoreName === undefined
      ? 'records'
      : indexedDbContext.configuredRecordsStoreName

  indexedDbContext.cleanupLegacyRecords =
    indexedDbContext.configuredCleanupLegacyRecords === undefined
      ? false
      : indexedDbContext.configuredCleanupLegacyRecords

  indexedDbContext.factory = (
    indexedDbContext.configuredFactory === undefined
      ? indexedDbContext.realmDefaultFactory
      : indexedDbContext.configuredFactory
  ) as IDBFactory

  indexedDbContext.keyRange =
    indexedDbContext.configuredKeyRange === undefined
      ? (globalThis as { IDBKeyRange?: typeof IDBKeyRange }).IDBKeyRange
      : indexedDbContext.configuredKeyRange

  if (
    indexedDbContext.journalFactoryIsPrivate === true &&
    (indexedDbContext.configuredFactory === undefined ||
      indexedDbContext.factory === indexedDbContext.realmDefaultFactory)
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError(StorageErrorText.indexedDbJournalFactoryMustBeInjected)
    })

  if (typeof indexedDbContext.cleanupLegacyRecords !== 'boolean')
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('cleanupLegacyRecords must be a boolean')
    })

  if (!indexedDbContext.factory)
    throw new StorageError(StorageBrowserErrorCode.unavailable, {
      backend: StorageBackend.indexedDb
    })

  if (
    (typeof indexedDbContext.factory !== 'object' &&
      typeof indexedDbContext.factory !== 'function') ||
    indexedDbContext.factory === null ||
    typeof (indexedDbContext.factory as { open?: unknown }).open !== 'function'
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IndexedDB factory must provide open()')
    })

  if (
    indexedDbContext.keyRange !== undefined &&
    (typeof indexedDbContext.keyRange !== 'function' ||
      typeof (indexedDbContext.keyRange as typeof IDBKeyRange).bound !== 'function' ||
      typeof (indexedDbContext.keyRange as typeof IDBKeyRange).lowerBound !== 'function' ||
      typeof (indexedDbContext.keyRange as typeof IDBKeyRange).upperBound !== 'function')
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError('IDBKeyRange must provide bound/lowerBound/upperBound')
    })

  indexedDbContext.configuredStoreNames = [
    indexedDbContext.kvStoreName,
    indexedDbContext.bytesStoreName,
    indexedDbContext.recordsStoreName
  ]

  /** Schema requirements are captured once before the existing opener can perform any I/O. */
  indexedDbContext.featureStoreNames = [...indexedDbContext.declaredObjectStores]

  if (
    !isValidStoreName(indexedDbContext.dbName) ||
    indexedDbContext.configuredStoreNames.some((storeName) => !isValidStoreName(storeName)) ||
    new Set(indexedDbContext.configuredStoreNames).size !==
      indexedDbContext.configuredStoreNames.length ||
    indexedDbContext.configuredStoreNames.some((storeName) =>
      INTERNAL_STORE_NAMES.has(storeName)
    ) ||
    indexedDbContext.featureStoreNames.some(
      (name) =>
        !isValidStoreName(name) ||
        INTERNAL_STORE_NAMES.has(name) ||
        indexedDbContext.configuredStoreNames.includes(name)
    ) ||
    new Set(indexedDbContext.featureStoreNames).size !== indexedDbContext.featureStoreNames.length
  )
    throw new StorageError(StorageBrowserErrorCode.invalidConfig, {
      backend: StorageBackend.indexedDb,
      cause: new TypeError(
        'IndexedDB channel store names must be non-empty, unique, and non-reserved'
      )
    })

  /** Preserve original name validation, then reject reserved org suffixes before native I/O. */
  if (indexedDbContext.bindOrganizations)
    resolveStorageNamespace(
      indexedDbContext.dbName,
      indexedDbContext.runtime.defaultOrgId,
      indexedDbContext.runtime.defaultOrgId
    )
}
/** Allocate the original connection, coordination and transaction registries in construction order. */
export function initializeIndexedDbNativeState<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): void {
  /**
   * Context-local observations cannot cross realms because `performance.now()` origins are
   * incomparable.
   */
  indexedDbContext.assemblies.indexes?.initialize(indexedDbContext)

  /** Physical deletion invalidates cached private log indexes without replacing the borrowed view. */
  indexedDbContext.journalGeneration = {}
  indexedDbContext.controller = createIndexedDbController(indexedDbContext)

  /** The original installation owns the physical database's default organization identity. */
  indexedDbContext.orgId = indexedDbContext.runtime.defaultOrgId

  /** One native epoch anchor retains the original installed scheduler as the elapsed-time owner. */
  indexedDbContext.ttlNow =
    indexedDbContext.assemblies.ttl?.clock(indexedDbContext.runtime.featureExpose.getScheduler()) ??
    (() => 0)

  /** Report-only owner for malformed or unavailable coordination transport behavior. */
  indexedDbContext.coordinationReporter = createStorageOperationReporter()

  /** One private registry member shared by every exact store in this physical data universe. */
  indexedDbContext.coordination = (
    indexedDbContext.assemblies.notifications?.coordination ?? acquireIndexedDbLocks
  )({
    factory: indexedDbContext.factory,
    realmDefaultFactory: indexedDbContext.realmDefaultFactory,
    broadcastChannel: indexedDbContext.broadcastChannel,
    dbName: indexedDbContext.dbName,
    layoutFingerprint: indexedDbLayoutFingerprint(
      indexedDbContext.kvStoreName,
      indexedDbContext.bytesStoreName,
      indexedDbContext.recordsStoreName
    ),
    ownOrigin: indexedDbContext.controller.origin,
    orgId: indexedDbContext.orgId,
    onChange: (change) =>
      indexedDbContext.assemblies.notifications?.external(indexedDbContext.controller, change),
    report: (error) => reportCleanupError(indexedDbContext.coordinationReporter, error),
    createKeyLockPort: () => indexedDbContext.runtime.createKeyLockPort()
  })

  /** Immutable capabilities reflect construction-time transport admission and never mutate later. */
  indexedDbContext.capabilities = {
    ...CAPABILITIES,
    secondaryIndexes: indexedDbContext.assemblies.indexes !== undefined,
    batch: indexedDbContext.assemblies.batch !== undefined,
    changeFeed:
      indexedDbContext.assemblies.changeFeed !== undefined && indexedDbContext.coordination.admitted
  }

  /** Brands the private context that an already-admitted logical operation may reuse. */
  indexedDbContext.mutationLeaseBrand = Symbol('indexeddb-mutation-lease')

  /** Shared preparation state; callers await the same attempt but own cancellation locally. */
  indexedDbContext.prepareState = 'idle'

  /** Native handles are indexed only after contract ownership has authorized their live views. */
  indexedDbContext.nativeTransactions = new Map<
    string,
    {
      readonly native: IDBTransaction
      readonly journal: (
        scope: Omit<ITransactionScope, 'use'>,
        prefix: string
      ) => IBackendJournalTransaction
      readonly images: {
        readonly changes: ReturnType<typeof createIndexedDbJournalImages>['changes']
        readImage(target: IStorageJournalTarget): Promise<IStorageJournalImage>
        writeImage(target: IStorageJournalTarget, image: IStorageJournalImage): Promise<void>
        readonly readRevision: (
          target: IStorageJournalTarget
        ) => ReturnType<ReturnType<typeof createIndexedDbJournalImages>['revision']>
      }
      readonly abort: () => void
      readonly clearRoot: (channel: 'value' | 'bytes' | 'record' | undefined) => Promise<void>
      readonly readKeys: () => Promise<string[]>
      readonly ttl: (scope: ITransactionScope) => ITransactionTtlApi
      readonly expiredRecord: (key: IStorageKey) => Promise<boolean>
      readonly recordEpoch: (
        scope: string
      ) => Promise<{ readonly global: number; readonly scope: number }>
      readonly removeRecordsByPrefix: (
        scope: ITransactionScope<unknown>,
        prefix: IStorageKey
      ) => Promise<number>
    }
  >()

  /**
   * Iterator pages reuse the same optional backend journal port without shadowing operation
   * runtime.
   */
  indexedDbContext.runtimeJournal = indexedDbContext.runtime.journal
}
/** Construct the original construction after its prerequisite native ports exist. */
export function createIndexedDbConstruction<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['construction'] {
  return provideBackendConstruction(
    indexedDbContext.store,
    [
      implement(kv, browserKeyValueApi(indexedDbContext.store, indexedDbContext.batchApi), {
        forTransaction: (scope) => scope
      }),
      implement(records, indexedDbContext.recordApi, {
        forTransaction: (scope: ITransactionScope) => transactionRecordApi(indexedDbContext, scope)
      }),
      ...(indexedDbContext.assemblies.ttl === undefined
        ? []
        : [
            implement(ttl, indexedDbContext.ttlApi, {
              forTransaction: (scope: ITransactionScope) =>
                indexedDbContext.assemblies.ttl!.transaction(indexedDbContext, scope)
            })
          ])
    ],
    indexedDbContext.controller,
    () => {
      if (indexedDbContext.activeDatabase === undefined)
        throw new StorageError(StorageBrowserErrorCode.unavailable, {
          backend: StorageBackend.indexedDb
        })
      return indexedDbContext.activeDatabase
    },
    async () => {
      await open(indexedDbContext, createStorageOperationRuntime())
    }
  )
}
/** Construct the original transactionOwner after its prerequisite native ports exist. */
export function createIndexedDbTransactionOwner<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['transactionOwner'] {
  return createTransactionOwner<TValue>(
    indexedDbContext.construction.store,
    normalizeIndexedDbOperationError,
    {
      activityMode: TransactionActivityMode.native,
      asyncDisposeKey,
      concurrencyStages: indexedDbContext.runtime.stageBindings.concurrencyStages(
        indexedDbContext.construction.store
      )
    }
  )
}
/** Construct the original orgBinding after its prerequisite native ports exist. */
export function createIndexedDbOrgBinding<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['orgBinding'] {
  return indexedDbContext.bindOrganizations
    ? createBrowserOrgBinding<
        IIndexedDbProvidedStore<TValue>,
        IDBDatabase,
        IIndexedDbPhysical<TValue>
      >(
        indexedDbContext.runtime,
        indexedDbContext.dbName,
        indexedDbContext.physical,
        (target, ports) =>
          indexedDbHost<TValue>(
            {
              dbName: target,
              kvStoreName: indexedDbContext.kvStoreName,
              bytesStoreName: indexedDbContext.bytesStoreName,
              recordsStoreName: indexedDbContext.recordsStoreName,
              cleanupLegacyRecords: indexedDbContext.cleanupLegacyRecords,
              factory: indexedDbContext.factory,
              journalFactoryIsPrivate: indexedDbContext.journalFactoryIsPrivate,
              keyRange: indexedDbContext.keyRange,
              owner: { label: indexedDbContext.ownerLabel }
            },
            ports,
            indexedDbContext.featureStoreNames,
            false,
            indexedDbContext.assemblies
          )
      )
    : undefined
}
/** Register backfill operations on the same native record store before capability publication. */

/** Acquire through the original provider before invoking one native attempt. */
export function runIndexedDbConcurrencyAttempt<TValue, T>(
  logicalTransaction: IIndexedDbLogicalTransaction<TValue, T>,
  context: IConcurrencyAttemptContext
): Promise<IConcurrencyAttempt<Awaited<T>>> {
  return logicalTransaction.indexedDbContext.coordination.keyPort.attempt(
    context,
    {
      status: ConcurrencyHolderState.held,
      owner: logicalTransaction.indexedDbContext.controller.origin,
      label: logicalTransaction.indexedDbContext.ownerLabel,
      scope: 'local',
      /** The provider captures the actual acquisition time after any logical wait. */
      get since() {
        return Date.now()
      }
    },
    {
      attempt: (context) => runIndexedDbAdmittedAttempt(logicalTransaction, context)
    },
    logicalTransaction.indexedDbContext.runtime.stageBindings.concurrencyStages(
      logicalTransaction.indexedDbContext.construction.store
    ),
    logicalTransaction.indexedDbContext.controller.closingSignal,
    logicalTransaction.root?.ranges()
  )
}
/** Run the original endpoint pipeline around exactly one admitted native callback. */
/** One admitted attempt owns native commit classification without changing retry policy. */
export type IIndexedDbAdmittedAttempt<TValue, T> = {
  /** Original logicalTransaction belongs to this admitted provider attempt. */
  readonly logicalTransaction: IIndexedDbLogicalTransaction<TValue, T>
  /** Original context belongs to this admitted provider attempt. */
  readonly context: IConcurrencyAttemptContext

  /** The fixed journal selection belongs to the original logical operation. */
  selectedJournal: IBackendRuntime['journal']

  /** A final native conflict is normalized only after its original pipeline unwinds. */
  commitConflict: IConcurrencyAttempt<Awaited<T>> | undefined

  /** Only rethrowing this exact failure permits the canonical policy to retry. */
  commitFailure: StorageContractError | undefined
}
/** Execute exactly one admitted native callback through its original public pipeline. */
async function runIndexedDbAdmittedAttempt<TValue, T>(
  logicalTransaction: IIndexedDbLogicalTransaction<TValue, T>,
  context: IConcurrencyAttemptContext
): Promise<IConcurrencyAttempt<Awaited<T>>> {
  /** Commit classification stays private to this same provider attempt. */
  const attemptState = { logicalTransaction, context } as IIndexedDbAdmittedAttempt<TValue, T>
  attemptState.selectedJournal = attemptState.logicalTransaction.selectedJournal

  try {
    const value = attemptState.logicalTransaction.pipeline
      ? await attemptState.logicalTransaction.indexedDbContext.runtime.execution.run(
          {
            operation: StorageOperation.indexedDbTransaction,
            input: attemptState.logicalTransaction.run,
            ctx: attemptState.context
          },
          (run: (scope: IIndexedDbTransactionScope<TValue>) => T) =>
            attemptNative(attemptState, run)
        )
      : await attemptNative(attemptState, attemptState.logicalTransaction.run)
    return { status: 'committed', value }
  } catch (cause) {
    if (attemptState.commitConflict !== undefined && cause === attemptState.commitFailure)
      return attemptState.commitConflict
    throw cause
  }
}
