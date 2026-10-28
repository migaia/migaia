// Per-organization native store class for the SQLite store (see ./store.ts).
import {
  snapshotStorageKey,
  createTransactionBuilder,
  runWithConcurrency,
  snapshotConcurrencyLockHoldings,
  lockKey,
  reportCleanupError,
  throwIfAborted,
  withAbort
} from '@migaia/storage-host/sdk'
import {
  assertSyncWriteOptions,
  readTransactionConflictPolicy,
  type IOperationContext
} from '@migaia/storage-contract'
import { asyncDisposeKey } from '@migaia/plugin-host'
import type { IStorageJournalExecutionPort } from '@migaia/storage-host'
import { SqliteNames, SqliteControl, SqliteOperation } from './constants.ts'
import { createSqliteExecutor } from './sql.ts'
import type { ISqliteNativeStore, ISqliteRow } from './types.ts'
import { sqliteRead, sqliteRemove, sqliteConvert, sqliteWriteRaw, sqliteWrite } from './store-io.ts'
import {
  sqliteTextKeys,
  sqliteClear,
  sqliteIterator,
  sqliteSyncMutation,
  sqliteObserve
} from './store-mutation.ts'
import {
  sqliteTextInput,
  sqliteRootRead,
  sqliteRootWrite,
  sqlitePrepareWrite,
  sqliteBytesInput,
  sqliteSynchronous
} from './store-operation.ts'
import { sqliteRevisionKey, sqliteDecodeLockIdentity } from './store-revision.ts'
import { sqliteExecuteSql } from './store-scope.ts'
import {
  sqliteStatement,
  sqliteOperationOrg,
  sqliteLocalGroup,
  sqliteJournalFor
} from './store-state.ts'
import type { ISqliteOrganizationContext } from './store-state.ts'
import { sqliteTransact, sqliteHolderOf } from './store-transaction.ts'

/**
 * One organization's native SQLite store: text, bytes, record, TTL and RDF channels over the shared
 * database.
 */
export class SqliteOrgBase<TValue> implements ISqliteNativeStore<TValue> {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #organization: ISqliteOrganizationContext<TValue>

  /** SQL tag installed by the executor spread in the constructor; declared for the store type. */
  declare readonly sql: ISqliteNativeStore<TValue>['sql']

  backend: ISqliteNativeStore<TValue>['backend'] = SqliteNames.backend

  capabilities: ISqliteNativeStore<TValue>['capabilities'] = {
    batch: true,
    syncRead: true,
    binary: true,
    records: true,
    transactions: true,
    iteration: true,
    secondaryIndexes: false,
    changeFeed: false,
    maxValueBytes: undefined,
    opaqueEntries: false
  }

  get: ISqliteNativeStore<TValue>['get'] = (key, ctx) => {
    sqliteTextInput(this.#organization, key)
    return sqliteRootRead(
      this.#organization,
      SqliteOperation.get,
      { key },
      ctx,
      (orgId, _input, observeKey, state) =>
        sqliteRead(this.#organization, 'text', key, orgId, state, undefined, observeKey) as
          | string
          | null
    )
  }

  set: ISqliteNativeStore<TValue>['set'] = (key, value, ctx) => {
    sqliteTextInput(this.#organization, key, value, true)
    return sqliteRootWrite(
      this.#organization,
      SqliteOperation.set,
      { key, value },
      ctx,
      (captured) => {
        sqliteTextInput(this.#organization, captured.key, captured.value, true)
        return sqlitePrepareWrite(this.#organization, 'text', captured.key, captured.value)
      }
    )
  }

  remove: ISqliteNativeStore<TValue>['remove'] = (key, ctx) => {
    sqliteTextInput(this.#organization, key)
    return sqliteRootWrite(this.#organization, SqliteOperation.remove, { key }, ctx, (captured) => {
      sqliteTextInput(this.#organization, captured.key)
      return {
        keys: [lockKey.text(captured.key)],
        run: (state) => {
          sqliteRemove(this.#organization, 'text', captured.key, state)
        }
      }
    })
  }

  has: ISqliteNativeStore<TValue>['has'] = (key, ctx) => {
    sqliteTextInput(this.#organization, key)
    return sqliteRootRead(
      this.#organization,
      SqliteOperation.has,
      { key },
      ctx,
      (orgId, _input, observeKey, state) =>
        sqliteRead(this.#organization, 'text', key, orgId, state, undefined, observeKey) !== null
    )
  }

  keys: ISqliteNativeStore<TValue>['keys'] = (ctx) =>
    sqliteRootRead(
      this.#organization,
      SqliteOperation.keys,
      {},
      ctx,
      (orgId, _input, observeKey, state) =>
        sqliteTextKeys(this.#organization, orgId, observeKey, state)
    )

  clearValues: ISqliteNativeStore<TValue>['clearValues'] = (ctx) =>
    sqliteRootWrite(this.#organization, SqliteOperation.clearValues, {}, ctx, () => ({
      keys: [],
      guard: { channels: ['text'] },
      run: (state) => sqliteClear(this.#organization, ['text'], state)
    }))

  clearAll: ISqliteNativeStore<TValue>['clearAll'] = (ctx) =>
    sqliteRootWrite(this.#organization, SqliteOperation.clearAll, {}, ctx, () => ({
      keys: [],
      guard: { channels: ['text', 'bytes', 'record'] },
      run: (state) => sqliteClear(this.#organization, ['text', 'bytes', 'record'], state)
    }))

  getBytes: ISqliteNativeStore<TValue>['getBytes'] = (key, ctx) => {
    sqliteTextInput(this.#organization, key)
    return sqliteRootRead(
      this.#organization,
      SqliteOperation.getBytes,
      { key },
      ctx,
      (orgId, _input, observeKey, state) =>
        sqliteRead(
          this.#organization,
          'bytes',
          key,
          orgId,
          state,
          undefined,
          observeKey
        ) as Uint8Array | null
    )
  }

  setBytes: ISqliteNativeStore<TValue>['setBytes'] = (key, value, ctx) => {
    const bytes = sqliteBytesInput(this.#organization, key, value)
    return sqliteRootWrite(
      this.#organization,
      SqliteOperation.setBytes,
      { key, value: bytes },
      ctx,
      (captured) =>
        sqlitePrepareWrite(
          this.#organization,
          'bytes',
          captured.key,
          sqliteBytesInput(this.#organization, captured.key, captured.value)
        )
    )
  }

  removeBytes: ISqliteNativeStore<TValue>['removeBytes'] = (key, ctx) => {
    sqliteTextInput(this.#organization, key)
    return sqliteRootWrite(
      this.#organization,
      SqliteOperation.removeBytes,
      { key },
      ctx,
      (captured) => {
        sqliteTextInput(this.#organization, captured.key)
        return {
          keys: [lockKey.bytes(captured.key)],
          run: (state) => {
            sqliteRemove(this.#organization, 'bytes', captured.key, state)
          }
        }
      }
    )
  }

  clearBytes: ISqliteNativeStore<TValue>['clearBytes'] = (ctx) =>
    sqliteRootWrite(this.#organization, SqliteOperation.clearBytes, {}, ctx, () => ({
      keys: [],
      guard: { channels: ['bytes'] },
      run: (state) => sqliteClear(this.#organization, ['bytes'], state)
    }))

  getRecord: ISqliteNativeStore<TValue>['getRecord'] = (key, ctx) => {
    /** Caller compound keys must remain stable while operation middleware and admission await. */
    const captured = snapshotStorageKey(key, SqliteNames.backend)
    return sqliteRootRead(
      this.#organization,
      SqliteOperation.getRecord,
      { key: captured },
      ctx,
      (orgId, _input, observeKey, state) =>
        sqliteRead(this.#organization, 'record', captured, orgId, state, undefined, observeKey) as
          | TValue
          | undefined
    )
  }

  putRecord: ISqliteNativeStore<TValue>['putRecord'] = (value, key, ctx) => {
    /** Capture before middleware and physical admission can yield to caller mutations. */
    const captured = key === undefined ? undefined : snapshotStorageKey(key, SqliteNames.backend)
    return sqliteRootWrite(
      this.#organization,
      SqliteOperation.putRecord,
      { value, key: captured },
      ctx,
      (input) => {
        /** Transformed input remains private while logical and physical admission can await. */
        const key =
          input.key === undefined ? undefined : snapshotStorageKey(input.key, SqliteNames.backend)
        if (key !== undefined) {
          const mutation = sqlitePrepareWrite(this.#organization, 'record', key, input.value)
          return {
            ...mutation,
            run: (state) => {
              mutation.run(state)
              return key
            }
          }
        }
        const raw = sqliteConvert(this.#organization, 'record', 'encode', input.value) as string
        return {
          keys: [],
          run: (state) => {
            const actual = String(
              sqliteStatement<TValue, ISqliteRow>(
                this.#organization,
                SqliteControl.generatedKey,
                [],
                'get',
                state
              ).key
            )
            sqliteWriteRaw(
              this.#organization,
              'record',
              actual,
              raw,
              state,
              readTransactionConflictPolicy(state.context, SqliteNames.backend)
            )
            return actual
          }
        }
      }
    )
  }

  deleteRecord: ISqliteNativeStore<TValue>['deleteRecord'] = (key, ctx) => {
    /** Caller compound keys must remain stable while operation middleware and admission await. */
    const captured = snapshotStorageKey(key, SqliteNames.backend)
    return sqliteRootWrite(
      this.#organization,
      SqliteOperation.deleteRecord,
      { key: captured },
      ctx,
      (input) => {
        /** The prepared key survives the asynchronous physical admission below. */
        const key = snapshotStorageKey(input.key, SqliteNames.backend)
        return {
          keys: [lockKey.record(key)],
          run: (state) => {
            sqliteRemove(this.#organization, 'record', key, state)
          }
        }
      }
    )
  }

  clearRecords: ISqliteNativeStore<TValue>['clearRecords'] = (ctx) =>
    sqliteRootWrite(this.#organization, SqliteOperation.clearRecords, {}, ctx, () => ({
      keys: [],
      guard: { channels: ['record'] },
      run: (state) => sqliteClear(this.#organization, ['record'], state)
    }))

  iterateRecords: ISqliteNativeStore<TValue>['iterateRecords'] = (range, ctx) =>
    sqliteIterator(this.#organization, range, ctx)

  transaction: ISqliteNativeStore<TValue>['transaction'] = (run, options) =>
    sqliteTransact(this.#organization, run, options)

  tx: ISqliteNativeStore<TValue>['tx'] = () =>
    createTransactionBuilder(
      this.#organization.store,
      undefined,
      this.#organization.core.getChainMethods('tx')
    )

  metadata: ISqliteNativeStore<TValue>['metadata'] = {
    get: (key, ctx) => {
      sqliteTextInput(this.#organization, key)
      return sqliteRootRead(
        this.#organization,
        SqliteOperation.metadataGet,
        { key },
        ctx,
        (orgId) => sqliteRead(this.#organization, 'metadata', key, orgId)
      )
    },
    set: (key, value, ctx) => {
      sqliteTextInput(this.#organization, key)
      return sqliteRootRead(
        this.#organization,
        SqliteOperation.metadataSet,
        { key, value },
        ctx,
        (orgId) =>
          sqliteSyncMutation(
            this.#organization,
            (state) => sqliteWrite(this.#organization, 'metadata', key, value, state, 'replace'),
            [sqliteRevisionKey(this.#organization, 'metadata', key)],
            undefined,
            orgId
          )
      )
    },
    delete: (key, ctx) => {
      sqliteTextInput(this.#organization, key)
      return sqliteRootRead(
        this.#organization,
        SqliteOperation.metadataDelete,
        { key },
        ctx,
        (orgId) =>
          sqliteSyncMutation(
            this.#organization,
            (state) => {
              sqliteRemove(this.#organization, 'metadata', key, state)
            },
            [sqliteRevisionKey(this.#organization, 'metadata', key)],
            undefined,
            orgId
          )
      )
    }
  }

  sync: ISqliteNativeStore<TValue>['sync'] = {
    get: (key) =>
      sqliteSynchronous(this.#organization, SqliteOperation.get, { key }, () => {
        sqliteTextInput(this.#organization, key)
        return sqliteRead(this.#organization, 'text', key, this.#organization.runtime.orgId) as
          | string
          | null
      }),
    set: (key, value, options) =>
      sqliteSynchronous(this.#organization, SqliteOperation.set, { key, value, options }, () => {
        sqliteTextInput(this.#organization, key, value, true)
        assertSyncWriteOptions(options)
        const policy = options?.conflictPolicy ?? 'conflict'
        sqliteSyncMutation(
          this.#organization,
          (state) => sqliteWrite(this.#organization, 'text', key, value, state, policy),
          [lockKey.text(key), lockKey.bytes(key), lockKey.record(key)]
        )
      }),
    remove: (key) =>
      sqliteSynchronous(this.#organization, SqliteOperation.remove, { key }, () => {
        sqliteTextInput(this.#organization, key)
        sqliteSyncMutation(
          this.#organization,
          (state) => sqliteRemove(this.#organization, 'text', key, state),
          [lockKey.text(key)]
        )
      }),
    has: (key) =>
      sqliteSynchronous(this.#organization, SqliteOperation.has, { key }, () => {
        sqliteTextInput(this.#organization, key)
        return (
          sqliteRead(this.#organization, 'text', key, this.#organization.runtime.orgId) !== null
        )
      }),
    keys: () =>
      sqliteSynchronous(this.#organization, SqliteOperation.keys, {}, () =>
        sqliteTextKeys(this.#organization, this.#organization.runtime.orgId)
      ),
    clearValues: () =>
      sqliteSynchronous(this.#organization, SqliteOperation.clearValues, {}, () =>
        sqliteSyncMutation(
          this.#organization,
          (state) => sqliteClear(this.#organization, ['text'], state),
          [],
          { channels: ['text'] }
        )
      )
  }

  inspectLocks: ISqliteNativeStore<TValue>['inspectLocks'] = (ctx) => {
    this.#organization.controller.assertLive()
    const finish = this.#organization.controller.beginMutation()
    return withAbort(ctx, async (signal, context) =>
      this.#organization.core.execution.run(
        { operation: 'inspectLocks', input: {}, ctx: context },
        async () => {
          throwIfAborted(signal)
          const orgId = sqliteOperationOrg(this.#organization, context)
          sqliteObserve(
            this.#organization,
            this.#organization.concurrencyStages,
            'beforeLockInspect'
          )
          try {
            const inspect = () => {
              if (!this.#organization.wal)
                return sqliteLocalGroup(this.#organization, orgId).locks.inspectLocks()
              const rows = sqliteStatement<TValue, readonly ISqliteRow[]>(
                this.#organization,
                `SELECT key,owner,label,pid,since,expires_at FROM ${this.#organization.tables.locks} WHERE org_id=?`,
                [orgId],
                'all'
              )
              return snapshotConcurrencyLockHoldings(
                rows.map((row) => {
                  const id = row.key as string
                  return {
                    key: sqliteDecodeLockIdentity(this.#organization, id),
                    holder: sqliteHolderOf(this.#organization, row),
                    expired: Number(row.expires_at) <= Date.now(),
                    expiresAt: Number(row.expires_at)
                  }
                })
              )
            }
            const rows = inspect()
            sqliteObserve(
              this.#organization,
              this.#organization.concurrencyStages,
              'afterLockInspect',
              rows.length
            )
            return rows
          } catch (error) {
            sqliteObserve(
              this.#organization,
              this.#organization.concurrencyStages,
              'onLockInspectError',
              (error as { code?: unknown })?.code
            )
            throw error
          }
        }
      )
    ).finally(finish)
  }

  dispose: ISqliteNativeStore<TValue>['dispose'] = () => this.#organization.controller.dispose();

  [asyncDisposeKey]: ISqliteNativeStore<TValue>[typeof asyncDisposeKey] = () =>
    (this.#organization.symbolic ??= this.#organization.controller
      .dispose()
      .catch((error) => reportCleanupError(this.#organization.report, error)))

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(organization: ISqliteOrganizationContext<TValue>) {
    this.#organization = organization
    Object.assign(
      this,
      this.#organization.core.journal === undefined
        ? {}
        : {
            undo: async (txId: string, ctx?: IOperationContext) => {
              this.#organization.controller.assertLive()
              const release = this.#organization.controller.beginMutation()
              let selected: IStorageJournalExecutionPort | undefined
              return runWithConcurrency<{ readonly txId: string }>(
                {
                  store: this.#organization.store,
                  options: ctx === undefined ? {} : ctx,
                  prepare: (context) => {
                    selected = sqliteJournalFor(this.#organization, context)
                    return selected!.prepare()
                  }
                },
                {
                  attempt: async (context) => ({
                    status: 'committed',
                    value: await selected!.undo(txId, (keys, work) =>
                      createTransactionBuilder(
                        this.#organization.store,
                        context,
                        this.#organization.core.getChainMethods('tx')
                      )
                        .lock(keys[0]!, ...keys.slice(1))
                        .run(work)
                    )
                  })
                }
              ).finally(release)
            }
          }
    )
    Object.assign(
      this,
      createSqliteExecutor(
        (prepare, ctx, run) =>
          sqliteRootRead(this.#organization, SqliteOperation.sql, {}, ctx, () =>
            sqliteExecuteSql(this.#organization, prepare, undefined, run)
          ),
        this.#organization.statements
      )
    )
  }
}
