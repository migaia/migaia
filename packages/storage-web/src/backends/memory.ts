import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract';
import { isStorageErrorFamily } from '../core/error-family.js';
import { createStorageOperationRuntime } from '../core/operation-reporter.js';
import { toPromise } from '../utils/async.js';
import {
  mergeSignals,
  snapshotSyncWriteOptions,
  throwIfAborted,
  withAbort
} from '../core/operation.js';
import {
  assertStorageKey,
  assertStringStorageKey,
  compareStorageKeys,
  encodeFlatStorageKey,
  snapshotKeyRange
} from '../core/key-domain.js';
import { isStorageKeyInRange } from '../core/query.js';
import { StorageBackend, StorageChannel, StorageOperation } from '../constants.js';
import { isUint8Array } from '../core/bytes.js';
import { planChannelWrite } from '../core/channel-write.js';
import { StorageError, StorageErrorCode } from '../types/errors.js';
import type { IStorageKey } from '../types/context.js';
import type { IRecordStore, ISyncCapableStore, ISyncKeyValueStore } from '../types/storage.js';
import {
  assertTransactionCallback,
  assertTransactionScopeActive,
  readTransactionConflictPolicy,
  type ITransactionScope
} from '../core/transaction.js';
import type { IStorageCapabilities } from '../types/capabilities.js';

const CAPABILITIES: IStorageCapabilities = Object.freeze({
  syncRead: true,
  binary: true,
  records: true,
  transactions: true,
  iteration: true,
  maxValueBytes: undefined,
  opaqueEntries: false
});

const autoKey = (): string =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * 纯内存实现。用于测试、SSR 服务端、以及其他后端不可用时的显式降级目标。 每个实例持有独立存储，天然隔离，不需要命名空间参数。 实现全部 L0 + L1 接口（record 使用
 * structured clone），v1 不提供原生二级索引。
 */
export const memoryStorage = <TValue = unknown>(): ISyncCapableStore<IRecordStore<TValue>> => {
  const kv = new Map<string, string>();
  const bytes = new Map<string, Uint8Array>();
  const documents = new Map<string, [IStorageKey, TValue]>();
  const recordRevisions = new Map<string, number>();
  let recordEpoch = 0;
  let disposed = false;

  const assertLive = (): void => {
    if (disposed)
      throw new StorageContractError(StorageContractErrorCode.disposed, {
        backend: StorageBackend.memory
      });
  };

  const cloneValue = <T>(value: T, key?: IStorageKey): T => {
    try {
      return structuredClone(value);
    } catch (cause) {
      throw new StorageError(StorageErrorCode.serializeFailed, {
        backend: StorageBackend.memory,
        key,
        cause
      });
    }
  };

  const checkCrossChannel = (
    key: IStorageKey,
    attemptedChannel: 'value' | 'bytes' | 'record',
    conflictPolicy: 'conflict' | 'replace' = 'conflict',
    applyReplace = true,
    encodedKey = encodeFlatStorageKey(key)
  ): void => {
    const stringKey = typeof key === 'string' ? key : undefined;
    const existing = new Set<'value' | 'bytes' | 'record'>();
    if (stringKey !== undefined && kv.has(stringKey)) existing.add('value');
    if (stringKey !== undefined && bytes.has(stringKey)) existing.add('bytes');
    if (documents.has(encodedKey)) existing.add('record');
    const plan = planChannelWrite(
      key,
      attemptedChannel,
      existing,
      conflictPolicy,
      StorageBackend.memory
    );
    if (!applyReplace) return;
    for (const channel of plan.remove) {
      if (channel === StorageChannel.value && stringKey !== undefined) kv.delete(stringKey);
      if (channel === StorageChannel.bytes && stringKey !== undefined) bytes.delete(stringKey);
      if (channel === 'record') {
        if (documents.delete(encodedKey))
          recordRevisions.set(encodedKey, (recordRevisions.get(encodedKey) ?? 0) + 1);
      }
    }
  };

  const sync: ISyncKeyValueStore = {
    get: (key) => {
      assertLive();
      assertStringStorageKey(key, StorageBackend.memory);
      return kv.get(key) ?? null;
    },
    set: (key, value, options) => {
      assertLive();
      assertStringStorageKey(key, StorageBackend.memory);
      const optionsSnapshot = snapshotSyncWriteOptions(options);
      if (typeof value !== 'string')
        throw new StorageError(StorageErrorCode.invalidConfig, {
          backend: StorageBackend.memory,
          key,
          cause: new TypeError('storage value must be a string')
        });
      checkCrossChannel(key, 'value', optionsSnapshot.conflictPolicy);
      kv.set(key, value);
    },
    remove: (key) => {
      assertLive();
      assertStringStorageKey(key, StorageBackend.memory);
      kv.delete(key);
    },
    has: (key) => {
      assertLive();
      assertStringStorageKey(key, StorageBackend.memory);
      return kv.has(key);
    },
    keys: () => {
      assertLive();
      return [...kv.keys()];
    },
    clearValues: () => {
      assertLive();
      kv.clear();
    }
  };

  /** Tombstone：草稿里记录"这个 key 在提交时应被删除"，和"未触碰"区分开。 */
  const TOMBSTONE = Symbol('memory-transaction-tombstone');

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
    assertLive();
    /** Scope remains usable only while the transaction callback is pending. */
    let scopeActive = true;
    const draft = new Map<
      string,
      [IStorageKey, TValue, 'conflict' | 'replace'] | typeof TOMBSTONE
    >();
    const readRevisions = new Map<string, number>();
    const readSnapshots = new Map<string, TValue | undefined>();
    let snapshotEpoch: number | undefined;
    const revisionOf = (encoded: string): number => recordRevisions.get(encoded) ?? 0;
    const trackRevision = (encoded: string): void => {
      // 惰性捕获 snapshot epoch（SW-A28/A29「快照在首次读取时建立」）：与 indexed-db 一致。事务开始后才发生的
      // clearRecords 不影响「首次读取之后」的快照一致性——首次读取前就 clear 的，读到的是 post-clear 的一致状态，
      // 不应误报冲突。空事务（无任何读写）不建立快照，也不做 epoch 检查。
      if (snapshotEpoch === undefined) snapshotEpoch = recordEpoch;
      if (!readRevisions.has(encoded)) readRevisions.set(encoded, revisionOf(encoded));
    };
    const scope: ITransactionScope<TValue> = {
      get: async (key) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.memory);
        assertStorageKey(key, StorageBackend.memory);
        const encoded = encodeFlatStorageKey(key);
        trackRevision(encoded);
        if (readSnapshots.has(encoded)) {
          const snapshot = readSnapshots.get(encoded);
          return snapshot === undefined ? undefined : cloneValue(snapshot, key);
        }
        if (draft.has(encoded)) {
          const entry = draft.get(encoded)!;
          const snapshot = entry === TOMBSTONE ? undefined : cloneValue(entry[1], key);
          readSnapshots.set(encoded, snapshot);
          return snapshot === undefined ? undefined : cloneValue(snapshot, key);
        }
        const stored = documents.get(encoded)?.[1];
        const snapshot = stored === undefined ? undefined : cloneValue(stored, key);
        readSnapshots.set(encoded, snapshot);
        return snapshot === undefined ? undefined : cloneValue(snapshot, key);
      },
      put: async (value, key, options) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.memory);
        const conflictPolicy = readTransactionConflictPolicy(options, StorageBackend.memory);
        const resolvedKey = key ?? autoKey();
        assertStorageKey(resolvedKey, StorageBackend.memory);
        const keySnapshot = cloneValue(resolvedKey, resolvedKey);
        const encoded = encodeFlatStorageKey(keySnapshot);
        trackRevision(encoded);
        readSnapshots.delete(encoded);
        draft.set(encoded, [keySnapshot, cloneValue(value, keySnapshot), conflictPolicy]);
        return resolvedKey;
      },
      delete: async (key) => {
        assertTransactionScopeActive(scopeActive, StorageBackend.memory);
        assertStorageKey(key, StorageBackend.memory);
        const encoded = encodeFlatStorageKey(key);
        trackRevision(encoded);
        readSnapshots.delete(encoded);
        draft.set(encoded, TOMBSTONE);
      }
    };
    let result: T;
    try {
      result = await run(scope);
    } catch (error) {
      if (isStorageErrorFamily(error)) throw error;
      throw new StorageError(StorageErrorCode.transactionFailed, {
        backend: StorageBackend.memory,
        cause: error
      });
    } finally {
      scopeActive = false;
    }
    throwIfAborted(signal);
    for (const entry of draft.values()) {
      assertLive();
      throwIfAborted(signal);
      if (entry !== TOMBSTONE) checkCrossChannel(entry[0], 'record', entry[2], false);
    }
    assertLive();
    throwIfAborted(signal);
    if (snapshotEpoch !== undefined && recordEpoch !== snapshotEpoch)
      throw new StorageError(StorageErrorCode.transactionConflict, {
        backend: StorageBackend.memory,
        operation: StorageOperation.transactionCommit,
        cause: new Error('record epoch changed')
      });
    for (const [encoded, expected] of readRevisions) {
      const actual = revisionOf(encoded);
      if (actual !== expected)
        throw new StorageError(StorageErrorCode.transactionConflict, {
          backend: StorageBackend.memory,
          operation: StorageOperation.transactionCommit,
          cause: new Error(`record revision changed from ${expected} to ${actual}`)
        });
    }
    for (const [encoded, entry] of draft) {
      if (entry === TOMBSTONE) {
        documents.delete(encoded);
        recordRevisions.set(encoded, revisionOf(encoded) + 1);
      } else {
        checkCrossChannel(entry[0], 'record', entry[2]);
        documents.set(encoded, [entry[0], entry[1]]);
        recordRevisions.set(encoded, revisionOf(encoded) + 1);
      }
    }
    return result;
  };

  return {
    backend: StorageBackend.memory,
    capabilities: CAPABILITIES,
    sync,
    get: (key, ctx) => withAbort(ctx, async () => sync.get(key)),
    set: (key, value, ctx) =>
      withAbort(ctx, async (_signal, context) => {
        assertLive();
        if (typeof value !== 'string')
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: StorageBackend.memory,
            key,
            cause: new TypeError('storage value must be a string')
          });
        checkCrossChannel(key, 'value', context?.conflictPolicy);
        sync.set(key, value, { conflictPolicy: context?.conflictPolicy });
      }),
    remove: (key, ctx) => withAbort(ctx, async () => sync.remove(key)),
    has: (key, ctx) => withAbort(ctx, async () => sync.has(key)),
    keys: (ctx) => withAbort(ctx, async () => sync.keys()),
    clearValues: (ctx) => withAbort(ctx, async () => sync.clearValues()),
    clearAll: (ctx) =>
      withAbort(ctx, async () => {
        assertLive();
        kv.clear();
        bytes.clear();
        documents.clear();
        recordEpoch += 1;
      }),
    dispose: () =>
      toPromise(() => {
        disposed = true;
        kv.clear();
        bytes.clear();
        documents.clear();
      }),

    getBytes: (key, ctx) =>
      withAbort(ctx, async () => {
        assertLive();
        assertStringStorageKey(key, StorageBackend.memory);
        const value = bytes.get(key);
        return value ? new Uint8Array(value) : null;
      }),
    setBytes: (key, value, ctx) =>
      withAbort(ctx, async (_signal, context) => {
        assertLive();
        assertStringStorageKey(key, StorageBackend.memory);
        if (!isUint8Array(value))
          throw new StorageError(StorageErrorCode.invalidConfig, {
            backend: StorageBackend.memory,
            key,
            cause: new TypeError('bytes value must be a Uint8Array')
          });
        let prepared: Uint8Array;
        try {
          prepared = new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
        } catch (cause) {
          throw new StorageError(StorageErrorCode.serializeFailed, {
            backend: StorageBackend.memory,
            key,
            cause
          });
        }
        checkCrossChannel(key, 'bytes', context?.conflictPolicy);
        bytes.set(key, prepared);
      }),
    clearBytes: (ctx) =>
      withAbort(ctx, async () => {
        assertLive();
        bytes.clear();
      }),

    getRecord: (key, ctx) =>
      withAbort(ctx, async () => {
        assertLive();
        assertStorageKey(key, StorageBackend.memory);
        const value = documents.get(encodeFlatStorageKey(key))?.[1];
        return value === undefined ? undefined : cloneValue(value, key);
      }),
    putRecord: (value, key, ctx) =>
      withAbort(ctx, async (_signal, context) => {
        assertLive();
        const resolvedKey = key ?? autoKey();
        assertStorageKey(resolvedKey, StorageBackend.memory);
        const keySnapshot = cloneValue(resolvedKey, resolvedKey);
        const encoded = encodeFlatStorageKey(keySnapshot);
        const prepared = cloneValue(value, keySnapshot);
        checkCrossChannel(keySnapshot, 'record', context?.conflictPolicy, true, encoded);
        documents.set(encoded, [keySnapshot, prepared]);
        recordRevisions.set(encoded, (recordRevisions.get(encoded) ?? 0) + 1);
        return resolvedKey;
      }),
    deleteRecord: (key, ctx) =>
      withAbort(ctx, async () => {
        assertLive();
        assertStorageKey(key, StorageBackend.memory);
        const encoded = encodeFlatStorageKey(key);
        documents.delete(encoded);
        recordRevisions.set(encoded, (recordRevisions.get(encoded) ?? 0) + 1);
      }),
    clearRecords: (ctx) =>
      withAbort(ctx, async () => {
        assertLive();
        documents.clear();
        recordEpoch += 1;
      }),
    iterateRecords: async function* (range, ctx) {
      const rangeSnapshot = snapshotKeyRange(range, StorageBackend.memory);
      /** One reporter shared by every abort subscription inside this iteration operation. */
      const runtime = createStorageOperationRuntime();
      const merged = mergeSignals(ctx, runtime.reporter);
      try {
        assertLive();
        throwIfAborted(merged.signal);
        const entries = [...documents.values()].sort(([left], [right]) =>
          compareStorageKeys(left, right)
        );
        for (const [storageKey, value] of entries) {
          assertLive();
          throwIfAborted(merged.signal);
          if (isStorageKeyInRange(storageKey, rangeSnapshot))
            yield [cloneValue(storageKey, storageKey), cloneValue(value, storageKey)];
        }
      } finally {
        merged.dispose();
      }
    },
    transaction: (run, ctx) => {
      return withAbort(ctx, (signal) => {
        assertTransactionCallback(run, StorageBackend.memory);
        return runTransaction(run, signal);
      });
    }
  };
};
