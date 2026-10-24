import { IndexedDbFeature } from '../constants.js'
import { indexedDbFeatureMissing } from './indexed-db-base-access.js'
import {
  createIndexedDbJournalImages,
  indexedDbJournalTarget,
  isIndexedDbJournalRevision
} from './indexed-db-images.js'
import {
  createIndexedDbJournalTerminal,
  createIndexedDbJournalView,
  IndexedDbJournalLayout
} from './indexed-db-journal.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  ConcurrencyHolderState
} from '@migaia/storage-contract'
import {
  assertTransactionOwner,
  runTransactionOperation,
  createTransactionBuilder
} from '@migaia/storage-host/authoring/transaction'
import { runWithConcurrency, ConcurrencyPolicy } from '@migaia/storage-host/authoring/concurrency'
import {
  createBackendJournalNamespace,
  storageJournalLockKey,
  StorageJournalLock,
  encodeStorageJournalImage,
  decodeStorageJournalImage,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
import type { IStorageJournalBackendBinding } from '@migaia/storage-host'
import { StorageBackend } from '../constants.js'
import { encodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'
import type { IOperationContext } from '../types/context.js'
import { type ITransactionScope } from '@migaia/storage-contract'
import {
  journalNative,
  IIndexedDbContext,
  IIndexedDbNativeCallback,
  IIndexedDbNativeRegistration,
  INTERNAL_META_NAMESPACE,
  META_STORE_NAME,
  assertLive,
  normalizeIndexedDbOperationError,
  putNative,
  readIndexedDbBytes,
  request,
  runTransaction,
  toIdbKey,
  withMutationLease,
  type IIndexedDbStore
} from './indexed-db.js'
/** Private journal methods authenticate exact live views through this original native registry. */

/** Borrow the same native registration's journal operations without adding a resource owner. */
export function indexedDbRegistrationJournal<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>,
  ...args: Parameters<IIndexedDbNativeRegistration<TValue>['journal']>
): ReturnType<IIndexedDbNativeRegistration<TValue>['journal']> {
  const [view, prefix] = args
  nativeState.journalTerminal ??= createIndexedDbJournalTerminal((error) =>
    reportCleanupError(nativeState.operationRuntime.reporter, error)
  )
  /** No raw native handle or commit right leaves this physical owner. */
  const metadata = createIndexedDbJournalView({
    scope: view,
    metadata: nativeState.native.objectStore(META_STORE_NAME),
    namespace: INTERNAL_META_NAMESPACE,
    prefix,
    keyRange: nativeState.attemptState.logicalTransaction.indexedDbContext.keyRange!,
    request: <R>(make: () => IDBRequest<R>) => request(nativeState, make)
  })
  return {
    onCommit: nativeState.journalTerminal.onCommit,
    onRollback: nativeState.journalTerminal.onRollback,
    onEnd: nativeState.journalTerminal.onEnd,
    run: (work) => runTransactionOperation(view, () => work(metadata))
  }
}

/** Private image methods use the registration's existing physical access and journal order. */
export function createIndexedDbRegistrationImages<TValue, T>(
  nativeState: IIndexedDbNativeCallback<TValue, T>
): IIndexedDbNativeRegistration<TValue>['images'] {
  return {
    changes: nativeState.journalImages.changes,
    readImage: async (target) => {
      const row = indexedDbJournalTarget(target)
      if (row.metadata) {
        const deadline = await nativeState.ttlAccess.deadline(row.channel, row.key)
        return encodeStorageJournalImage(deadline !== undefined, deadline)
      }
      const name =
        row.channel === 'value'
          ? nativeState.attemptState.logicalTransaction.indexedDbContext.kvStoreName
          : row.channel === 'bytes'
            ? nativeState.attemptState.logicalTransaction.indexedDbContext.bytesStoreName
            : nativeState.attemptState.logicalTransaction.indexedDbContext.recordsStoreName
      const targetStore = nativeState.native.objectStore(name)
      const value: unknown = await request(nativeState, () => targetStore.get(toIdbKey(row.key)))
      const present =
        value !== undefined ||
        (await request(nativeState, () => targetStore.getKey(toIdbKey(row.key)))) !== undefined
      return encodeStorageJournalImage(
        present,
        row.channel === 'bytes' ? readIndexedDbBytes(value) : value,
        row.channel === 'bytes'
      )
    },
    writeImage: async (target, image) => {
      const row = indexedDbJournalTarget(target)
      const decoded = decodeStorageJournalImage(image, row.channel === 'bytes' && !row.metadata)
      if (row.metadata) {
        if (
          decoded.present &&
          (typeof decoded.value !== 'number' || !Number.isFinite(decoded.value))
        )
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        await nativeState.ttlAccess.restore(
          row.channel,
          row.key,
          decoded.present ? (decoded.value as number) : undefined
        )
      } else if (!decoded.present) await nativeState.removeNative(row.channel, row.key)
      else {
        if (row.channel === 'value' && typeof decoded.value !== 'string')
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        await putNative(nativeState, row.channel, row.key, decoded.value)
      }
    },
    readRevision: (target) => {
      const row = indexedDbJournalTarget(target)
      return nativeState.journalImages.revision(row.channel, row.key)
    }
  }
}

/** Bind private journal operations to the original physical database and generation. */
export function createIndexedDbPhysicalJournal<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IStorageJournalBackendBinding {
  return {
    requiresIndexedDbUndo: true,
    forOrg: (orgId) =>
      (indexedDbContext.orgBinding?.resolve(orgId) ?? indexedDbContext.physical).journalBinding!,
    lockTarget: (target) => indexedDbJournalTarget(target).lock,
    changes: (scope) => journalNative(indexedDbContext, scope).images.changes(),
    readImage: (scope, target) =>
      runTransactionOperation(scope, () =>
        journalNative(indexedDbContext, scope).images.readImage(target)
      ),
    writeImage: (scope, target, image) =>
      runTransactionOperation(scope, () =>
        journalNative(indexedDbContext, scope).images.writeImage(target, image)
      ),
    readRevision: (scope, target) =>
      runTransactionOperation(scope, () =>
        journalNative(indexedDbContext, scope).images.readRevision(target)
      ),
    openNamespace: async (prefix) => {
      assertLive(indexedDbContext)
      if (typeof prefix !== 'string' || prefix.length === 0)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      if (indexedDbContext.keyRange === undefined)
        throw new StorageContractError(StorageContractErrorCode.unsupported)
      /** Private methods and cached index reads retain this original physical generation. */
      const generation = indexedDbContext.journalGeneration
      const authenticate = (scope: Omit<ITransactionScope, 'use'>) => {
        const info = assertTransactionOwner(indexedDbContext.construction.store, scope)
        const current = indexedDbContext.nativeTransactions.get(info.id)
        if (current === undefined)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        return { info, port: current.journal(scope, prefix) }
      }
      return createBackendJournalNamespace({
        assertLive: () => {
          assertLive(indexedDbContext)
          if (generation !== indexedDbContext.journalGeneration)
            throw new StorageContractError(StorageContractErrorCode.disposed)
        },
        closingSignal: indexedDbContext.controller.closingSignal,
        backend: StorageBackend.indexedDb,
        report: (error) => reportCleanupError(indexedDbContext.coordinationReporter, error),
        nativeAtomic: true,
        indexExclusive:
          indexedDbContext.webLocks === undefined &&
          indexedDbContext.journalFactoryIsPrivate !== true
            ? false
            : undefined,
        reserve: (hold) =>
          indexedDbContext.webLocks === undefined &&
          indexedDbContext.journalFactoryIsPrivate !== true
            ? hold()
            : runWithConcurrency(
                {
                  store: indexedDbContext.store,
                  options: { lock: [storageJournalLockKey(prefix, StorageJournalLock.resource)] },
                  policy: ConcurrencyPolicy.fail()
                },
                {
                  attempt: (context) =>
                    indexedDbContext.coordination.keyPort.attemptMetadata(
                      context,
                      {
                        status: ConcurrencyHolderState.held,
                        owner: indexedDbContext.controller.origin,
                        label: indexedDbContext.ownerLabel,
                        scope: 'local',
                        since: Date.now()
                      },
                      {
                        attempt: async () => {
                          if (indexedDbContext.webLocks !== undefined) {
                            /**
                             * Native Web Locks owns lifetime exclusion; no expiring metadata lease
                             * is substituted.
                             */
                            const name = encodeFlatStorageKey([
                              IndexedDbJournalLayout.resource,
                              indexedDbContext.dbName,
                              prefix
                            ])
                            await indexedDbContext.webLocks
                              .request(
                                name,
                                { mode: 'exclusive', ifAvailable: true },
                                async (lock) => {
                                  if (lock === null)
                                    throw new StorageContractError(
                                      StorageContractErrorCode.lockRejected
                                    )
                                  await hold()
                                }
                              )
                              .catch((cause: unknown) => {
                                throw normalizeIndexedDbOperationError(cause)
                              })
                          } else await hold()
                          return { status: 'committed', value: undefined }
                        }
                      },
                      indexedDbContext.runtime.stageBindings.concurrencyStages(
                        indexedDbContext.construction.store
                      ),
                      indexedDbContext.controller.closingSignal
                    )
                }
              ),
        authenticate,
        transaction: (work) =>
          withMutationLease(indexedDbContext, (lease) =>
            runTransaction(
              indexedDbContext,
              (scope) => work(authenticate(scope).port),
              { lock: [storageJournalLockKey(prefix, StorageJournalLock.head)] },
              lease,
              false,
              undefined,
              false
            )
          )
      })
    }
  }
}

/** Undo uses only the explicitly selected backend image protocol and host journal runtime. */
export function createIndexedDbUndo<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): Pick<IIndexedDbStore<TValue>, 'undo'> {
  if (indexedDbContext.runtime.journal === undefined)
    return indexedDbFeatureMissing.fail(IndexedDbFeature.hostJournal)
  return {
    undo: async (txId: string, ctx?: IOperationContext) => {
      assertLive(indexedDbContext)
      const release = indexedDbContext.controller.beginMutation()
      return runWithConcurrency<{ readonly txId: string }>(
        {
          store: indexedDbContext.store,
          options: ctx ?? {},
          prepare: () => indexedDbContext.runtime.journal!.prepare()
        },
        {
          attempt: async (context) => ({
            status: 'committed',
            value: await indexedDbContext.runtime.journal!.undo(txId, (keys, work) =>
              createTransactionBuilder(
                indexedDbContext.store,
                context,
                indexedDbContext.runtime.getChainMethods('tx')
              )
                .lock(keys[0]!, ...keys.slice(1))
                .run(work)
            )
          })
        }
      ).finally(release)
    }
  }
}

/** Journal Feature owns images, undo and private namespace bindings without native handles. */
export class IndexedDbJournalAssembly {
  readonly images = createIndexedDbJournalImages
  readonly isRevision = isIndexedDbJournalRevision
  readonly binding = createIndexedDbPhysicalJournal
  readonly registration = indexedDbRegistrationJournal
  readonly registrationImages = createIndexedDbRegistrationImages
  readonly undo = createIndexedDbUndo
}
