import { type IChangeFeedStore, type IStorageChange } from '@migaia/storage-contract'
import { isStorageErrorFamily } from '../core/error-family.js'
import { createStorageOperationRuntime } from '../core/operation-reporter.js'
import {
  mergeSignals,
  snapshotSyncWriteOptions,
  throwIfAborted,
  withAbort
} from '../core/operation.js'
import {
  assertStringStorageKey,
  compareStorageKeys,
  encodeFlatStorageKey,
  snapshotStorageKey,
  snapshotKeyRange
} from '../core/key-domain.js'
import { isStorageKeyInRange } from '../core/query.js'
import { StorageBackend, StorageChannel, StorageOperation } from '../constants.js'
import { isUint8Array } from '../core/bytes.js'
import { createStorageToken } from '../utils/storage-token.js'
import { planChannelWrite } from '../core/channel-write.js'
import {
  createBackendReactiveController,
  registerBackendReactiveController
} from './reactive-controller.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import type { IStorageKey } from '../types/context.js'
import type { IRecordStore, ISyncCapableStore, ISyncKeyValueStore } from '../types/storage.js'
import {
  assertTransactionCallback,
  assertTransactionScopeActive,
  readTransactionConflictPolicy,
  type ITransactionScope
} from '../core/transaction.js'
import type { IStorageCapabilities } from '../types/capabilities.js'

/**
 * `changeFeed: true` only for this backend: `memoryStorageHost()` creates one isolated, unshared
 * store per call (§ own doc comment below), so SWV2-R16's "same-page multiple instances" and
 * "cross-tab" clauses have no referent here — there is no second instance or tab that could ever
 * observe the same data, unlike localStorageHost/sessionStorageHost/IndexedDB. The single-instance
 * local change feed below is therefore this backend's _entire_ meaningful scope for
 * SWV2-B05/R05/R16, not a partial slice of a larger cross-tab feature still to come.
 */
const CAPABILITIES: IStorageCapabilities = Object.freeze({
  syncRead: true,
  binary: true,
  records: true,
  transactions: true,
  iteration: true,
  secondaryIndexes: false,
  changeFeed: true,
  maxValueBytes: undefined,
  opaqueEntries: false
})

/**
 * 纯内存实现。用于测试、SSR 服务端、以及其他后端不可用时的显式降级目标。 每个实例持有独立存储，天然隔离，不需要命名空间参数。 实现全部 L0 + L1 接口（record 使用
 * structured clone），v1 不提供原生二级索引。
 */
export const memoryStorageHost = <TValue = unknown>(): ISyncCapableStore<IRecordStore<TValue>> &
  IChangeFeedStore => {
  const kv = new Map<string, string>()
  const bytes = new Map<string, Uint8Array>()
  const documents = new Map<string, [IStorageKey, TValue]>()
  const recordRevisions = new Map<string, number>()
  let recordEpoch = 0

  /** Private commit-after controller shared with direct consumers and Host materialization. */
  const controller = createBackendReactiveController({
    backend: StorageBackend.memory,
    finalize: () => {
      kv.clear()
      bytes.clear()
      documents.clear()
    }
  })

  /**
   * SWV2-R16/I05/I06/E08: fires only after a mutation has fully and durably committed (never from
   * inside a `try` that could still fail, never on validation/conflict/rollback failure), and
   * isolates each listener's own throw so one bad listener cannot block delivery to the rest or
   * corrupt the write that already happened — the write itself is done by the time this runs.
   */
  const publishChange = (change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>): void => {
    controller.publish(change)
  }

  const assertLive = (): void => {
    controller.assertLive()
  }

  const cloneValue = <T>(value: T, key?: IStorageKey): T => {
    try {
      return structuredClone(value)
    } catch (cause) {
      throw new StorageError(StorageErrorCode.serializeFailed, {
        backend: StorageBackend.memory,
        key,
        cause
      })
    }
  }

  const checkCrossChannel = (
    key: IStorageKey,
    attemptedChannel: 'value' | 'bytes' | 'record',
    conflictPolicy: 'conflict' | 'replace' = 'conflict',
    applyReplace = true,
    encodedKey = encodeFlatStorageKey(key),
    /**
     * A `conflictPolicy: 'replace'` write silently evicts whatever other channel already held this
     * key — that eviction is itself a commit-worthy mutation and must publish its own `remove`
     * event on its own channel, not just the attempted channel's `put` event, or a subscriber would
     * never learn the evicted channel's data is gone. The one caller inside a transaction's commit
     * loop (`runTransaction`) opts out with `emitEvent: false`: that path already aggregates every
     * affected record key into one `kind:'batch'` event fired once after the whole transaction
     * commits, so an eviction there must not additionally fire its own standalone event mid-batch.
     */
    emitEvent = true
  ): void => {
    const stringKey = typeof key === 'string' ? key : undefined
    const existing = new Set<'value' | 'bytes' | 'record'>()
    if (stringKey !== undefined && kv.has(stringKey)) existing.add('value')
    if (stringKey !== undefined && bytes.has(stringKey)) existing.add('bytes')
    if (documents.has(encodedKey)) existing.add('record')
    const plan = planChannelWrite(
      key,
      attemptedChannel,
      existing,
      conflictPolicy,
      StorageBackend.memory
    )
    if (!applyReplace) return
    for (const channel of plan.remove) {
      if (channel === StorageChannel.value && stringKey !== undefined) {
        if (kv.delete(stringKey) && emitEvent)
          publishChange({ channel: 'value', kind: 'remove', keys: [key] })
      }
      if (channel === StorageChannel.bytes && stringKey !== undefined) {
        if (bytes.delete(stringKey) && emitEvent)
          publishChange({ channel: 'bytes', kind: 'remove', keys: [key] })
      }
      if (channel === 'record') {
        if (documents.delete(encodedKey)) {
          recordRevisions.set(encodedKey, (recordRevisions.get(encodedKey) ?? 0) + 1)
          if (emitEvent) publishChange({ channel: 'record', kind: 'remove', keys: [key] })
        }
      }
    }
  }

  const sync: ISyncKeyValueStore = {
    get: (key) => {
      assertLive()
      assertStringStorageKey(key, StorageBackend.memory)
      return kv.get(key) ?? null
    },
    set: (key, value, options) => {
      assertLive()
      assertStringStorageKey(key, StorageBackend.memory)
      const optionsSnapshot = snapshotSyncWriteOptions(options)
      if (typeof value !== 'string')
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.memory,
          key,
          cause: new TypeError('storage value must be a string')
        })
      checkCrossChannel(key, 'value', optionsSnapshot.conflictPolicy)
      kv.set(key, value)
      publishChange({ channel: 'value', kind: 'put', keys: [key] })
    },
    remove: (key) => {
      assertLive()
      assertStringStorageKey(key, StorageBackend.memory)
      // SWV2-§4.6 ties an event to a successful mutation: removing an absent key changed
      // nothing, so it must not publish (SOL-SWV2-047).
      if (kv.delete(key)) publishChange({ channel: 'value', kind: 'remove', keys: [key] })
    },
    has: (key) => {
      assertLive()
      assertStringStorageKey(key, StorageBackend.memory)
      return kv.has(key)
    },
    keys: () => {
      assertLive()
      return [...kv.keys()]
    },
    clearValues: () => {
      assertLive()
      const hadEntries = kv.size > 0
      kv.clear()
      if (hadEntries) publishChange({ channel: 'value', kind: 'clear' })
    }
  }

  /** Tombstone：草稿里记录"这个 key 在提交时应被删除"，和"未触碰"区分开。 */
  const TOMBSTONE = Symbol('memory-transaction-tombstone')

  /**
   * 事务作用域只读写一份隔离草稿，提交前完全不碰真实的 `documents`。
   *
   * 之前的实现直接在真实 Map 上写入、失败时用开头拍的快照整体覆盖回去—— 如果这次事务执行期间（run(scope) 的任意一次 await 之间）有其他并发的 putRecord
   * 或另一个事务成功提交，那次快照恢复会把那次无关的成功写入 也一起抹掉。草稿隔离后，失败只需要丢弃草稿，真实数据从未被动过； 成功时的合并循环是纯同步的（没有
   * await），不会被其他调用交错。
   */
  const runTransaction = async <T>(
    run: (tx: ITransactionScope<TValue>) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> => {
    assertLive()
    /** Scope remains usable only while the transaction callback is pending. */
    let scopeActive = true
    const draft = new Map<
      string,
      [IStorageKey, TValue, 'conflict' | 'replace'] | typeof TOMBSTONE
    >()
    /** Original key for every touched entry, including tombstones (which don't keep one). */
    const draftKeys = new Map<string, IStorageKey>()
    const readRevisions = new Map<string, number>()
    const readSnapshots = new Map<string, TValue | undefined>()
    let snapshotEpoch: number | undefined
    const revisionOf = (encoded: string): number => recordRevisions.get(encoded) ?? 0
    const trackRevision = (encoded: string): void => {
      // 惰性捕获 snapshot epoch（SW-A28/A29「快照在首次读取时建立」）：与 indexed-db 一致。事务开始后才发生的
      // clearRecords 不影响「首次读取之后」的快照一致性——首次读取前就 clear 的，读到的是 post-clear 的一致状态，
      // 不应误报冲突。空事务（无任何读写）不建立快照，也不做 epoch 检查。
      if (snapshotEpoch === undefined) snapshotEpoch = recordEpoch
      if (!readRevisions.has(encoded)) readRevisions.set(encoded, revisionOf(encoded))
    }
    const scope: ITransactionScope<TValue> = {
      get: async (key) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.memory)
        const keySnapshot = snapshotStorageKey(key, StorageBackend.memory)
        const encoded = encodeFlatStorageKey(keySnapshot)
        trackRevision(encoded)
        if (readSnapshots.has(encoded)) {
          const snapshot = readSnapshots.get(encoded)
          return snapshot === undefined ? undefined : cloneValue(snapshot, keySnapshot)
        }
        if (draft.has(encoded)) {
          const entry = draft.get(encoded)!
          const snapshot = entry === TOMBSTONE ? undefined : cloneValue(entry[1], keySnapshot)
          readSnapshots.set(encoded, snapshot)
          return snapshot === undefined ? undefined : cloneValue(snapshot, keySnapshot)
        }
        const stored = documents.get(encoded)?.[1]
        const snapshot = stored === undefined ? undefined : cloneValue(stored, keySnapshot)
        readSnapshots.set(encoded, snapshot)
        return snapshot === undefined ? undefined : cloneValue(snapshot, keySnapshot)
      },
      put: async (value, key, options) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.memory)
        const conflictPolicy = readTransactionConflictPolicy(options, StorageBackend.memory)
        const resolvedKey = key ?? createStorageToken()
        const keySnapshot = snapshotStorageKey(resolvedKey, StorageBackend.memory)
        const encoded = encodeFlatStorageKey(keySnapshot)
        trackRevision(encoded)
        readSnapshots.delete(encoded)
        draft.set(encoded, [keySnapshot, cloneValue(value, keySnapshot), conflictPolicy])
        draftKeys.set(encoded, keySnapshot)
        return resolvedKey
      },
      delete: async (key) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.memory)
        const keySnapshot = snapshotStorageKey(key, StorageBackend.memory)
        const encoded = encodeFlatStorageKey(keySnapshot)
        trackRevision(encoded)
        readSnapshots.delete(encoded)
        draft.set(encoded, TOMBSTONE)
        draftKeys.set(encoded, keySnapshot)
      }
    }
    let result: T
    try {
      result = await run(scope)
    } catch (error) {
      if (isStorageErrorFamily(error)) throw error
      throw new StorageError(StorageErrorCode.transactionFailed, {
        backend: StorageBackend.memory,
        cause: error
      })
    } finally {
      scopeActive = false
    }
    throwIfAborted(signal)
    for (const entry of draft.values()) {
      assertLive()
      throwIfAborted(signal)
      if (entry !== TOMBSTONE) checkCrossChannel(entry[0], 'record', entry[2], false)
    }
    assertLive()
    throwIfAborted(signal)
    if (snapshotEpoch !== undefined && recordEpoch !== snapshotEpoch)
      throw new StorageError(StorageErrorCode.transactionConflict, {
        backend: StorageBackend.memory,
        operation: StorageOperation.transactionCommit,
        cause: new Error('record epoch changed')
      })
    for (const [encoded, expected] of readRevisions) {
      const actual = revisionOf(encoded)
      if (actual !== expected)
        throw new StorageError(StorageErrorCode.transactionConflict, {
          backend: StorageBackend.memory,
          operation: StorageOperation.transactionCommit,
          cause: new Error(`record revision changed from ${expected} to ${actual}`)
        })
    }
    const committedKeys: IStorageKey[] = []
    for (const [encoded, entry] of draft) {
      if (entry === TOMBSTONE) {
        if (documents.delete(encoded)) {
          recordRevisions.set(encoded, revisionOf(encoded) + 1)
          committedKeys.push(draftKeys.get(encoded)!)
        }
      } else {
        checkCrossChannel(entry[0], 'record', entry[2], true, undefined, false)
        documents.set(encoded, [entry[0], entry[1]])
        recordRevisions.set(encoded, revisionOf(encoded) + 1)
        committedKeys.push(draftKeys.get(encoded)!)
      }
    }
    // SWV2-B05 "batch one-event": the whole transaction's writes/deletes fanout as a single
    // `kind:'batch'` event after every entry above committed, not one event per key — and only
    // reached at all when the loop above didn't throw (rollback ⇒ no event). A read-only
    // transaction (`draft` empty) has nothing to report.
    if (committedKeys.length > 0)
      publishChange({ channel: 'record', kind: 'batch', keys: committedKeys })
    return result
  }

  const store: ISyncCapableStore<IRecordStore<TValue>> & IChangeFeedStore = {
    backend: StorageBackend.memory,
    capabilities: CAPABILITIES,
    sync,
    get: (key, ctx) => withAbort(ctx, async () => sync.get(key)),
    set: (key, value, ctx) =>
      withAbort(ctx, async (_signal, context) => {
        assertLive()
        if (typeof value !== 'string')
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: StorageBackend.memory,
            key,
            cause: new TypeError('storage value must be a string')
          })
        checkCrossChannel(key, 'value', context?.conflictPolicy)
        sync.set(key, value, { conflictPolicy: context?.conflictPolicy })
      }),
    remove: (key, ctx) => withAbort(ctx, async () => sync.remove(key)),
    has: (key, ctx) => withAbort(ctx, async () => sync.has(key)),
    keys: (ctx) => withAbort(ctx, async () => sync.keys()),
    clearValues: (ctx) => withAbort(ctx, async () => sync.clearValues()),
    clearAll: (ctx) =>
      withAbort(ctx, async () => {
        assertLive()
        // SOL-SWV2-047: a clear over an already-empty store changed nothing.
        const hadEntries = kv.size > 0 || bytes.size > 0 || documents.size > 0
        kv.clear()
        bytes.clear()
        documents.clear()
        recordEpoch += 1
        if (hadEntries) publishChange({ channel: 'all', kind: 'clear' })
      }),
    dispose: () => {
      return controller.dispose()
    },

    getBytes: (key, ctx) =>
      withAbort(ctx, async () => {
        assertLive()
        assertStringStorageKey(key, StorageBackend.memory)
        const value = bytes.get(key)
        return value ? new Uint8Array(value) : null
      }),
    setBytes: (key, value, ctx) =>
      withAbort(ctx, async (_signal, context) => {
        assertLive()
        assertStringStorageKey(key, StorageBackend.memory)
        if (!isUint8Array(value))
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: StorageBackend.memory,
            key,
            cause: new TypeError('bytes value must be a Uint8Array')
          })
        let prepared: Uint8Array
        try {
          prepared = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()
        } catch (cause) {
          throw new StorageError(StorageErrorCode.serializeFailed, {
            backend: StorageBackend.memory,
            key,
            cause
          })
        }
        checkCrossChannel(key, 'bytes', context?.conflictPolicy)
        bytes.set(key, prepared)
        publishChange({ channel: 'bytes', kind: 'put', keys: [key] })
      }),
    clearBytes: (ctx) =>
      withAbort(ctx, async () => {
        assertLive()
        const hadEntries = bytes.size > 0
        bytes.clear()
        if (hadEntries) publishChange({ channel: 'bytes', kind: 'clear' })
      }),

    getRecord: (key, ctx) =>
      withAbort(ctx, async () => {
        assertLive()
        const keySnapshot = snapshotStorageKey(key, StorageBackend.memory)
        const value = documents.get(encodeFlatStorageKey(keySnapshot))?.[1]
        return value === undefined ? undefined : cloneValue(value, keySnapshot)
      }),
    putRecord: (value, key, ctx) =>
      withAbort(ctx, async (_signal, context) => {
        assertLive()
        const resolvedKey = key ?? createStorageToken()
        const keySnapshot = snapshotStorageKey(resolvedKey, StorageBackend.memory)
        const encoded = encodeFlatStorageKey(keySnapshot)
        const prepared = cloneValue(value, keySnapshot)
        checkCrossChannel(keySnapshot, 'record', context?.conflictPolicy, true, encoded)
        documents.set(encoded, [keySnapshot, prepared])
        recordRevisions.set(encoded, (recordRevisions.get(encoded) ?? 0) + 1)
        publishChange({ channel: 'record', kind: 'put', keys: [keySnapshot] })
        return resolvedKey
      }),
    deleteRecord: (key, ctx) =>
      withAbort(ctx, async () => {
        assertLive()
        const keySnapshot = snapshotStorageKey(key, StorageBackend.memory)
        const encoded = encodeFlatStorageKey(keySnapshot)
        const existed = documents.delete(encoded)
        if (existed) {
          recordRevisions.set(encoded, (recordRevisions.get(encoded) ?? 0) + 1)
          publishChange({ channel: 'record', kind: 'remove', keys: [keySnapshot] })
        }
      }),
    clearRecords: (ctx) =>
      withAbort(ctx, async () => {
        assertLive()
        const hadEntries = documents.size > 0
        documents.clear()
        recordEpoch += 1
        if (hadEntries) publishChange({ channel: 'record', kind: 'clear' })
      }),
    iterateRecords: async function* (range, ctx) {
      const rangeSnapshot = snapshotKeyRange(range, StorageBackend.memory)
      /** One reporter shared by every abort subscription inside this iteration operation. */
      const runtime = createStorageOperationRuntime()
      const merged = mergeSignals(ctx, runtime.reporter)
      try {
        assertLive()
        throwIfAborted(merged.signal)
        const entries = [...documents.values()].sort(([left], [right]) =>
          compareStorageKeys(left, right)
        )
        for (const [storageKey, value] of entries) {
          assertLive()
          throwIfAborted(merged.signal)
          if (isStorageKeyInRange(storageKey, rangeSnapshot))
            yield [cloneValue(storageKey, storageKey), cloneValue(value, storageKey)]
        }
      } finally {
        merged.dispose()
      }
    },
    transaction: (run, ctx) => {
      return withAbort(ctx, (signal) => {
        assertTransactionCallback(run, StorageBackend.memory)
        const release = controller.beginMutation()
        return runTransaction(run, signal).finally(release)
      })
    },
    subscribeChanges: (listener) => {
      assertLive()
      return controller.subscribe(listener)
    }
  }
  registerBackendReactiveController(store, controller)
  return store
}
