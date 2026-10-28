import {
  runTransactionOperation,
  snapshotConcurrencyLockRange,
  lockKey,
  snapshotStorageKeyPrefix,
  snapshotStorageBatchKeys
} from '@migaia/storage-host/sdk'
import {
  StorageBackend,
  StorageConflictPolicy,
  StorageTransactionOperation,
  storageBackendOperation
} from '../constants.ts'
import type { IWriteOptions } from '../types/context.ts'
import { BrowserBatchMethod, observeBrowserBatch, snapshotBrowserBatchEntries } from './batch.ts'
import {
  IIndexedDbContext,
  IIndexedDbScopeContext,
  IIndexedDbTransactionScope,
  IRootPrepared,
  assertLive,
  executeOperation,
  remove,
  removePrefix,
  request,
  rootKeys,
  rootMutation,
  toIdbKey,
  write
} from './indexed-db.ts'
/** Counted observations enclose the original native root pipeline without another executor. */
export function runRootBatch<TValue, I, R>(
  indexedDbContext: IIndexedDbContext<TValue>,
  method: string,
  input: I,
  ctx: IWriteOptions | undefined,
  count: number | undefined,
  prepare: (input: I, context: IWriteOptions) => IRootPrepared<TValue, R>
): Promise<Awaited<R>> {
  return observeBrowserBatch(
    indexedDbContext.runtime,
    indexedDbContext.construction.store,
    storageBackendOperation(StorageBackend.indexedDb, method),
    count,
    () =>
      rootMutation(
        indexedDbContext,
        method,
        input,
        ctx,
        { channel: 'value', kind: 'batch' },
        prepare
      )
  )
}

/** Standard root batches reuse the same native views and original concurrency/pipeline owner. */
export function createIndexedDbBatchApi<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['batchApi'] {
  return {
    getMany: async (keys, ctx) => {
      assertLive(indexedDbContext)
      const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
      if (captured.length === 0) return []
      return runRootBatch(
        indexedDbContext,
        BrowserBatchMethod.getMany,
        captured.map((entry) => entry.key),
        ctx,
        captured.length,
        (keys) => {
          const entries = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
          return {
            keys: entries
              .filter((entry, index) => entry.firstIndex === index)
              .map((entry) => lockKey.text(entry.key)),
            run: (scope) => scope.getMany(entries.map((entry) => entry.key))
          }
        }
      )
    },
    setMany: async (entries, ctx) => {
      assertLive(indexedDbContext)
      const captured = snapshotBrowserBatchEntries(entries, StorageBackend.indexedDb, true)
      if (captured.length === 0) return
      return runRootBatch(
        indexedDbContext,
        BrowserBatchMethod.setMany,
        captured.map(({ key, value, ttlMs }) => ({
          key,
          value,
          ...(ttlMs === undefined ? {} : { ttlMs })
        })),
        ctx,
        captured.length,
        (entries, context) => {
          const values = snapshotBrowserBatchEntries(entries, StorageBackend.indexedDb, true)
          return {
            keys: values.flatMap((entry) => rootKeys('value', entry.key, context)),
            run: (scope) => scope.setMany(values)
          }
        }
      )
    },
    removeMany: async (keys, ctx) => {
      assertLive(indexedDbContext)
      const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
      if (captured.length === 0) return 0
      return runRootBatch(
        indexedDbContext,
        BrowserBatchMethod.removeMany,
        captured.map((entry) => entry.key),
        ctx,
        captured.length,
        (keys) => {
          const entries = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
          return {
            keys: entries
              .filter((entry, index) => entry.firstIndex === index)
              .map((entry) => lockKey.text(entry.key)),
            run: (scope) => scope.removeMany(entries.map((entry) => entry.key))
          }
        }
      )
    },
    removeByPrefix: async (prefix, ctx) => {
      assertLive(indexedDbContext)
      const captured = snapshotStorageKeyPrefix(prefix, StorageBackend.indexedDb)
      return runRootBatch(
        indexedDbContext,
        BrowserBatchMethod.removeByPrefix,
        captured.key,
        ctx,
        undefined,
        (prefix) => {
          const range = snapshotStorageKeyPrefix(prefix, StorageBackend.indexedDb)
          return {
            keys: [],
            ranges: [
              {
                channel: 'text',
                ...snapshotConcurrencyLockRange(
                  { channel: 'text', prefix: range.key },
                  StorageBackend.indexedDb
                )
              }
            ],
            run: (scope) => scope.removeByPrefix(range.key)
          }
        }
      )
    }
  }
}

/** Compose this authentic native scope's batch operations. */
export function createIndexedDbScopeBatch<TValue, T>(
  scopeState: IIndexedDbScopeContext<TValue, T>
): Pick<
  IIndexedDbTransactionScope<TValue>,
  'removeByPrefix' | 'getMany' | 'setMany' | 'removeMany'
> {
  return {
    removeByPrefix: (prefix) =>
      runTransactionOperation(scopeState.scope, (view) => {
        const captured = snapshotStorageKeyPrefix(prefix, StorageBackend.indexedDb)
        return executeOperation(
          scopeState.nativeState,
          view,
          StorageTransactionOperation.removeByPrefix,
          undefined,
          () => removePrefix(scopeState.nativeState, 'value', captured),
          {}
        )
      }),
    getMany: (keys) =>
      runTransactionOperation(scopeState.scope, (view) => {
        const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
        if (captured.length === 0) return []
        return executeOperation(
          scopeState.nativeState,
          view,
          StorageTransactionOperation.getMany,
          { count: captured.length },
          async () => {
            /** Repeated positions reuse one native read in this snapshot. */
            const reads: Promise<string | undefined>[] = []
            return Promise.all(
              captured.map(({ key, firstIndex }, index) => {
                const pending =
                  firstIndex === index
                    ? (async () => {
                        if (!(await scopeState.nativeState.ttlAccess.present('value', key)))
                          return undefined
                        const value = await request(scopeState.nativeState, () =>
                          scopeState.nativeState.native
                            .objectStore(
                              scopeState.nativeState.attemptState.logicalTransaction
                                .indexedDbContext.kvStoreName
                            )
                            .get(toIdbKey(key))
                        )
                        return typeof value === 'string' ? value : undefined
                      })()
                    : reads[firstIndex]!
                reads.push(pending)
                return pending
              })
            )
          },
          { count: captured.length }
        )
      }),
    setMany: (entries) =>
      runTransactionOperation(scopeState.scope, (view) => {
        /** Every entry is captured and validated before the batch issues its first write. */
        const captured = snapshotBrowserBatchEntries(entries, StorageBackend.indexedDb, true)
        if (captured.length === 0) return
        return executeOperation(
          scopeState.nativeState,
          view,
          StorageTransactionOperation.setMany,
          { count: captured.length },
          async () => {
            for (const { key, value, ttlMs } of captured) {
              await write(
                scopeState.nativeState,
                'value',
                key,
                value,
                StorageConflictPolicy.conflict
              )
              if (ttlMs !== undefined)
                await scopeState.nativeState.ttlAccess.expire('value', key, ttlMs)
            }
          },
          { count: captured.length }
        )
      }),
    removeMany: (keys) =>
      runTransactionOperation(scopeState.scope, (view) => {
        const captured = snapshotStorageBatchKeys(keys, StorageBackend.indexedDb)
        if (captured.length === 0) return 0
        return executeOperation(
          scopeState.nativeState,
          view,
          StorageTransactionOperation.removeMany,
          { count: captured.length },
          async () => {
            let removed = 0
            for (let index = 0; index < captured.length; index += 1) {
              const { key, firstIndex } = captured[index]!
              if (firstIndex !== index) continue
              if (!(await scopeState.nativeState.ttlAccess.present('value', key))) continue
              await remove(scopeState.nativeState, 'value', key)
              removed += 1
            }
            return removed
          },
          { count: captured.length }
        )
      })
  }
}

/** Batch Feature reuses the original root planner and authentic transaction views. */
export class IndexedDbBatchAssembly {
  /** Batch observations enclose the same original root/scope execution owner. */
  readonly observe = observeBrowserBatch
  readonly api = createIndexedDbBatchApi
  readonly scope = createIndexedDbScopeBatch
}
