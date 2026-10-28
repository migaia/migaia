// Key-value, record, TTL and counter capability APIs for the SQLite store (see ./store.ts).
import {
  snapshotStorageKey,
  snapshotStorageBatchKeys,
  snapshotStorageCounterIncrement,
  lockKey,
  createRecordQuery,
  throwIfAborted
} from '@migaia/storage-host/sdk'
import {
  assertStorageTtlDuration,
  assertOperationContext,
  readTransactionConflictPolicy,
  type IKeyValueApi,
  type ITtlApi,
  type ITtlTarget,
  type ICounterApi,
  type IRecordsApi
} from '@migaia/storage-contract'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { SqliteNames, SqliteOperation } from './constants.ts'
import type { ISqliteNativeStore } from './types.ts'
import {
  sqliteConvert,
  sqliteWriteRaw,
  sqliteCaptureTtlTarget,
  sqliteChangeDeadline,
  sqliteAssertTtlTarget,
  sqliteExpiration,
  sqliteRead,
  sqliteWrite
} from './store-io.ts'
import { sqliteRemoveTextBatch, sqliteRemovePrefix, sqliteIterator } from './store-mutation.ts'
import {
  sqliteBatchSize,
  sqliteRootRead,
  sqliteReadSnapshot,
  sqliteGetMany,
  sqliteCaptureTextEntries,
  sqliteRootWrite,
  sqliteTextInput
} from './store-operation.ts'
import type { ISqliteOrganizationContext } from './store-state.ts'

/** Assemble the original keyValue port table from explicit organization state. */
export function createSqliteKeyValue<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  base: ISqliteNativeStore<TValue>
): IKeyValueApi {
  return {
    get: base.get,
    set: base.set,
    remove: base.remove,
    has: base.has,
    keys: base.keys,
    clearValues: base.clearValues,
    clearAll: base.clearAll,
    sync: base.sync,
    getMany: async (keys, ctx) => {
      const count = sqliteBatchSize(organization, keys)
      if (count === 0) {
        assertOperationContext(ctx)
        throwIfAborted(ctx?.signal)
        return []
      }
      /** Capture caller keys before stages; terminal capture includes supported in-place rewrites. */
      const captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
      const input = { keys: captured.map(({ key }) => key) }
      return sqliteRootRead(
        organization,
        SqliteOperation.getMany,
        input,
        ctx,
        (orgId, prepared, observeKey, state) => {
          const actual = snapshotStorageBatchKeys(
            (prepared as typeof input).keys,
            SqliteNames.backend
          )
          for (const [index, { key, firstIndex }] of actual.entries())
            if (firstIndex === index) observeKey?.(lockKey.text(key))
          return state === undefined
            ? sqliteReadSnapshot(organization, orgId, (current) =>
                sqliteGetMany(organization, actual, current)
              )
            : sqliteGetMany(organization, actual, state)
        },
        { count }
      )
    },
    setMany: async (entries, ctx) => {
      const count = sqliteBatchSize(organization, entries)
      if (count === 0) {
        assertOperationContext(ctx)
        throwIfAborted(ctx?.signal)
        return
      }
      /** Every duplicate, value and TTL failure precedes the first pipeline or native request. */
      const captured = sqliteCaptureTextEntries(entries)
      const input = { entries: captured.map(({ key, value, ttlMs }) => ({ key, value, ttlMs })) }
      return sqliteRootWrite(
        organization,
        SqliteOperation.setMany,
        input,
        ctx,
        (prepared) => {
          const actual = sqliteCaptureTextEntries(prepared.entries)
          /** Codec success precedes locks and table changes, matching ordinary root replacement. */
          const raw = actual.map((entry) => ({
            ...entry,
            value: sqliteConvert(organization, 'text', 'encode', entry.value) as string
          }))
          return {
            keys: actual.flatMap(({ key }) =>
              typeof key === 'string'
                ? [lockKey.text(key), lockKey.bytes(key), lockKey.record(key)]
                : [lockKey.text(key), lockKey.record(key)]
            ),
            run: (state) => {
              for (const entry of raw)
                sqliteWriteRaw(
                  organization,
                  'text',
                  entry.key,
                  entry.value,
                  state,
                  readTransactionConflictPolicy(state.context, SqliteNames.backend),
                  entry.ttlMs
                )
            }
          }
        },
        { count }
      )
    },
    removeMany: async (keys, ctx) => {
      const count = sqliteBatchSize(organization, keys)
      if (count === 0) {
        assertOperationContext(ctx)
        throwIfAborted(ctx?.signal)
        return 0
      }
      /** Repeated structural keys share first-position facts and affect one physical row. */
      const captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
      const input = { keys: captured.map(({ key }) => key) }
      return sqliteRootWrite(
        organization,
        SqliteOperation.removeMany,
        input,
        ctx,
        (prepared) => {
          const actual = snapshotStorageBatchKeys(prepared.keys, SqliteNames.backend)
          return {
            keys: actual
              .filter(({ firstIndex }, index) => firstIndex === index)
              .map(({ key }) => lockKey.text(key)),
            run: (state) => {
              return sqliteRemoveTextBatch(organization, actual, state)
            }
          }
        },
        { count }
      )
    },
    removeByPrefix: async (prefix, ctx) => {
      organization.controller.assertLive()
      /** The original prefix owner fixes the caller snapshot before asynchronous middleware. */
      /** Caller prefix survives middleware before a prepared mutation acquires physical admission. */
      const captured = snapshotStorageKey(prefix, SqliteNames.backend)
      return sqliteRootWrite(
        organization,
        SqliteOperation.removeByPrefix,
        { prefix: captured },
        ctx,
        (input) => {
          /**
           * Middleware can replace the prefix; physical admission can still await after
           * preparation.
           */
          const actual = snapshotStorageKey(input.prefix, SqliteNames.backend)
          return {
            keys: [],
            guard: { channels: ['text'], prefix: actual },
            run: (state) => sqliteRemovePrefix(organization, 'text', actual, state)
          }
        },
        { count: undefined }
      )
    }
  }
}
/** Assemble the original recordApi port table from explicit organization state. */
export function createSqliteRecordApi<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): IRecordsApi<TValue> {
  return {
    query: <R = TValue>() =>
      createRecordQuery<R>(
        {
          asyncDisposeKey,
          pushdown: {
            operators: [],
            operations: [],
            source: SqliteNames.backend,
            index: `${organization.table}_${SqliteNames.record}`
          },
          execute: ({ ctx }) => sqliteIterator(organization, undefined, ctx)
        },
        organization.core.getChainMethods('query')
      ),
    removeByPrefix: (prefix, ctx) => {
      /** Caller prefix survives middleware before a prepared mutation acquires physical admission. */
      const captured = snapshotStorageKey(prefix, SqliteNames.backend)
      return sqliteRootWrite(
        organization,
        SqliteOperation.removeByPrefix,
        { prefix: captured },
        ctx,
        (input) => {
          /** This transformed prefix survives the later asynchronous physical admission. */
          const prefix = snapshotStorageKey(input.prefix, SqliteNames.backend)
          return {
            keys: [],
            guard: { channels: ['record'], prefix },
            run: (state) => sqliteRemovePrefix(organization, 'record', prefix, state)
          }
        }
      )
    }
  }
}
/** Assemble the original timeToLive port table from explicit organization state. */
export function createSqliteTtlApi<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): ITtlApi {
  return {
    expire: async (target, ms, ctx) => {
      organization.controller.assertLive()
      const captured = sqliteCaptureTtlTarget(target)
      assertStorageTtlDuration(ms, SqliteNames.backend)
      return sqliteRootWrite(
        organization,
        SqliteOperation.ttlExpire,
        { target: captured, ms },
        ctx,
        (input) => {
          const target = sqliteCaptureTtlTarget(input.target)
          assertStorageTtlDuration(input.ms, SqliteNames.backend)
          return {
            keys: [target],
            run: (state) => sqliteChangeDeadline(organization, target, state, input.ms)
          }
        }
      )
    },
    remaining: async (target, ctx) => {
      organization.controller.assertLive()
      const captured = sqliteCaptureTtlTarget(target)
      return sqliteRootRead(
        organization,
        SqliteOperation.ttlRemaining,
        captured,
        ctx,
        (orgId, input, observeKey, state) => {
          /** Read admission and middleware have settled; this native lookup has no await. */
          const target = input as ITtlTarget
          sqliteAssertTtlTarget(target)
          observeKey?.(target)
          const row = sqliteExpiration(organization, target, orgId, state)
          return row?.expires_at == null
            ? undefined
            : Math.max(0, Number(row.expires_at) - Date.now())
        }
      )
    },
    persist: async (target, ctx) => {
      organization.controller.assertLive()
      const captured = sqliteCaptureTtlTarget(target)
      return sqliteRootWrite(organization, SqliteOperation.ttlPersist, captured, ctx, (input) => {
        const target = sqliteCaptureTtlTarget(input)
        return { keys: [target], run: (state) => sqliteChangeDeadline(organization, target, state) }
      })
    }
  }
}
/** Assemble the original counters port table from explicit organization state. */
export function createSqliteCounterApi<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): ICounterApi {
  return {
    increment: async (key, by, ctx) => {
      organization.controller.assertLive()
      sqliteTextInput(organization, key)
      snapshotStorageCounterIncrement(by, SqliteNames.backend)
      return sqliteRootWrite(
        organization,
        SqliteOperation.counterIncrement,
        { key, by },
        ctx,
        (input) => {
          sqliteTextInput(organization, input.key)
          const increment = snapshotStorageCounterIncrement(input.by, SqliteNames.backend)
          return {
            keys: [lockKey.text(input.key), lockKey.bytes(input.key), lockKey.record(input.key)],
            run: (state) => {
              const result = increment(
                sqliteRead(organization, 'text', input.key, state.orgId, state) as string | null
              )
              sqliteWrite(organization, 'text', input.key, String(result), state, 'conflict')
              return result
            }
          }
        }
      )
    }
  }
}
