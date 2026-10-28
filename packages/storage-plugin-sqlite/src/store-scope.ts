// Transaction scope, SQL execution and transaction cursors for the SQLite store (see ./store.ts).
import {
  snapshotStorageKey,
  snapshotStorageBatchKeys,
  projectStorageBatchKeys,
  snapshotStorageCounterIncrement,
  useTransactionCapability,
  throwIfAborted
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStorageKey,
  assertStorageTtlDuration,
  assertOperationContext,
  readTransactionConflictPolicy,
  type IStorageKey,
  type IStorageBatchKey,
  type IKeyValueApi,
  type ITtlTarget,
  type IOperationContext,
  type IKeyRange,
  type IStorageIterator,
  type ICompiledStorageSql
} from '@migaia/storage-contract'
import { SqliteNames, SqliteControl, SqliteOperation } from './constants.js'
import { normalizeSqliteFailure } from './errors.js'
import { decodeKey } from './key-codec.js'
import { createSqliteExecutor } from './sql.js'
import type { ISqliteTransactionScope, ISqliteRow } from './types.js'
import {
  sqliteCaptureTtlTarget,
  sqliteAssertTtlTarget,
  sqliteChangeDeadline,
  sqliteExpiration,
  sqliteRead,
  sqliteWrite,
  sqliteRemove,
  sqliteRecordRows,
  sqliteLiveExpiration,
  sqlitePrune,
  sqliteConvert
} from './store-io.js'
import { sqliteRemoveTextBatch, sqliteRemovePrefix, sqliteObserve } from './store-mutation.js'
import {
  sqliteScoped,
  sqliteTextInput,
  sqliteBytesInput,
  sqliteGetMany,
  sqliteCaptureTextEntries,
  sqliteProjectTextEntries
} from './store-operation.js'
import { sqliteRevision } from './store-revision.js'
import {
  ttlOperations,
  counterOperations,
  sqliteStatement,
  sqliteNativeFor,
  sqliteAssertRoot,
  sqliteIsBusy,
  SqlitePhysicalBusy
} from './store-state.js'
import type {
  ISqliteInternalScope,
  ISqliteOrganizationContext,
  ITextBatchEntry,
  INativeState
} from './store-state.js'

/**
 * One SQLite transaction scope: staged reads and writes bound to its organization and native
 * transaction.
 */
class SqliteScope<TValue> implements ISqliteInternalScope<TValue> {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #organization: ISqliteOrganizationContext<TValue>

  /** Installed by a spread in the constructor; declared so the class carries the store type. */
  declare readonly sql: ISqliteInternalScope<TValue>['sql'];

  [ttlOperations]: ISqliteInternalScope<TValue>[typeof ttlOperations] = {
    expire: (target, ms) =>
      sqliteScoped(
        this.#organization,
        this,
        SqliteOperation.ttlExpire,
        () => {
          const captured = sqliteCaptureTtlTarget(target)
          assertStorageTtlDuration(ms, SqliteNames.backend)
          return { target: captured, ms }
        },
        (state, _current, input) => {
          const current = input as { target: ITtlTarget; ms: number }
          const target = current.target
          sqliteAssertTtlTarget(target)
          assertStorageTtlDuration(current.ms, SqliteNames.backend)
          return sqliteChangeDeadline(this.#organization, target, state, current.ms)
        }
      ),
    remaining: (target) =>
      sqliteScoped(
        this.#organization,
        this,
        SqliteOperation.ttlRemaining,
        () => sqliteCaptureTtlTarget(target),
        (state, _current, input) => {
          /** Native expiry lookup runs before this terminal returns; no further await borrows input. */
          const target = input as ITtlTarget
          sqliteAssertTtlTarget(target)
          const row = sqliteExpiration(this.#organization, target, state.orgId, state)
          return row?.expires_at == null
            ? undefined
            : Math.max(0, Number(row.expires_at) - Date.now())
        }
      ),
    persist: (target) =>
      sqliteScoped(
        this.#organization,
        this,
        SqliteOperation.ttlPersist,
        () => sqliteCaptureTtlTarget(target),
        (state, _current, input) => {
          /** This synchronous native segment consumes the accepted target without another image. */
          const target = input as ITtlTarget
          sqliteAssertTtlTarget(target)
          return sqliteChangeDeadline(this.#organization, target, state)
        }
      )
  };

  [counterOperations]: ISqliteInternalScope<TValue>[typeof counterOperations] = {
    increment: (key, by) =>
      sqliteScoped(
        this.#organization,
        this,
        SqliteOperation.counterIncrement,
        () => {
          sqliteTextInput(this.#organization, key)
          snapshotStorageCounterIncrement(by, SqliteNames.backend)
          return { key, by }
        },
        (state, current, input) => {
          const captured = input as { key: string; by?: number }
          sqliteTextInput(this.#organization, captured.key)
          const increment = snapshotStorageCounterIncrement(captured.by, SqliteNames.backend)
          const result = increment(
            sqliteRead(this.#organization, 'text', captured.key, state.orgId, state, current) as
              | string
              | null
          )
          sqliteWrite(
            this.#organization,
            'text',
            captured.key,
            String(result),
            state,
            'conflict',
            current
          )
          return result
        }
      )
  }

  use: ISqliteInternalScope<TValue>['use'] = (capability) =>
    useTransactionCapability(this, capability)

  get: ISqliteInternalScope<TValue>['get'] = (key) =>
    sqliteScoped(this.#organization, this, SqliteOperation.get, { key }, (state, current) => {
      sqliteTextInput(this.#organization, key)
      return sqliteRead(this.#organization, 'text', key, state.orgId, state, current) as
        | string
        | null
    })

  set: ISqliteInternalScope<TValue>['set'] = (key, value, options) =>
    sqliteScoped(
      this.#organization,
      this,
      SqliteOperation.set,
      { key, value, options },
      (state, current) => {
        sqliteTextInput(this.#organization, key, value, true)
        sqliteWrite(
          this.#organization,
          'text',
          key,
          value,
          state,
          readTransactionConflictPolicy(options, SqliteNames.backend),
          current
        )
      }
    )

  remove: ISqliteInternalScope<TValue>['remove'] = (key) =>
    sqliteScoped(this.#organization, this, SqliteOperation.remove, { key }, (state) => {
      sqliteTextInput(this.#organization, key)
      sqliteRemove(this.#organization, 'text', key, state)
    })

  has: ISqliteInternalScope<TValue>['has'] = (key) =>
    sqliteScoped(this.#organization, this, SqliteOperation.has, { key }, (state, current) => {
      sqliteTextInput(this.#organization, key)
      return sqliteRead(this.#organization, 'text', key, state.orgId, state, current) !== null
    })

  getBytes: ISqliteInternalScope<TValue>['getBytes'] = (key) =>
    sqliteScoped(this.#organization, this, SqliteOperation.getBytes, { key }, (state, current) => {
      sqliteTextInput(this.#organization, key)
      return sqliteRead(
        this.#organization,
        'bytes',
        key,
        state.orgId,
        state,
        current
      ) as Uint8Array | null
    })

  setBytes: ISqliteInternalScope<TValue>['setBytes'] = (key, value, options) => {
    let bytes: Uint8Array
    return sqliteScoped(
      this.#organization,
      this,
      SqliteOperation.setBytes,
      () => {
        bytes = sqliteBytesInput(this.#organization, key, value)
        return { key, value: bytes, options }
      },
      (state, current) =>
        sqliteWrite(
          this.#organization,
          'bytes',
          key,
          bytes,
          state,
          readTransactionConflictPolicy(options, SqliteNames.backend),
          current
        )
    )
  }

  removeBytes: ISqliteInternalScope<TValue>['removeBytes'] = (key) =>
    sqliteScoped(this.#organization, this, SqliteOperation.removeBytes, { key }, (state) => {
      sqliteTextInput(this.#organization, key)
      sqliteRemove(this.#organization, 'bytes', key, state)
    })

  getRecord: ISqliteInternalScope<TValue>['getRecord'] = (key) => {
    let captured: IStorageKey
    return sqliteScoped(
      this.#organization,
      this,
      SqliteOperation.getRecord,
      () => {
        captured = snapshotStorageKey(key, SqliteNames.backend)
        return { key: captured }
      },
      (state, current) =>
        sqliteRead(this.#organization, 'record', captured, state.orgId, state, current) as
          | TValue
          | undefined
    )
  }

  putRecord: ISqliteInternalScope<TValue>['putRecord'] = (value, key, options) => {
    let captured: IStorageKey | undefined
    return sqliteScoped(
      this.#organization,
      this,
      SqliteOperation.putRecord,
      () => {
        captured = key === undefined ? undefined : snapshotStorageKey(key, SqliteNames.backend)
        return { value, key: captured, options }
      },
      (state, current) => {
        const actual =
          captured ??
          String(
            sqliteStatement<TValue, ISqliteRow>(
              this.#organization,
              SqliteControl.generatedKey,
              [],
              'get',
              state
            ).key
          )
        sqliteWrite(
          this.#organization,
          'record',
          actual,
          value,
          state,
          readTransactionConflictPolicy(options, SqliteNames.backend),
          current
        )
        return actual
      }
    )
  }

  deleteRecord: ISqliteInternalScope<TValue>['deleteRecord'] = (key) => {
    let captured: IStorageKey
    return sqliteScoped(
      this.#organization,
      this,
      SqliteOperation.deleteRecord,
      () => {
        captured = snapshotStorageKey(key, SqliteNames.backend)
        return { key: captured }
      },
      (state) => {
        sqliteRemove(this.#organization, 'record', captured, state)
      }
    )
  }

  getMany: ISqliteInternalScope<TValue>['getMany'] = (keys) => {
    let captured: readonly IStorageBatchKey[]
    let input: { keys: readonly IStorageKey[] }
    return sqliteScoped(
      this.#organization,
      this,
      SqliteOperation.getMany,
      () => {
        captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
        return (input = { keys: captured.map(({ key }) => key) })
      },
      (state, current, prepared) => {
        // Middleware has finished; this terminal consumes keys synchronously before returning.
        const actual = projectStorageBatchKeys((prepared as typeof input).keys, SqliteNames.backend)
        return sqliteGetMany(this.#organization, actual, state, current)
      },
      {
        get count() {
          return captured.length
        }
      }
    )
  }

  setMany: ISqliteInternalScope<TValue>['setMany'] = (entries) => {
    let captured: readonly ITextBatchEntry[]
    let input: { entries: Parameters<IKeyValueApi['setMany']>[0] }
    return sqliteScoped(
      this.#organization,
      this,
      SqliteOperation.setMany,
      () => {
        captured = sqliteCaptureTextEntries(entries)
        return (input = {
          entries: captured.map(({ key, value, ttlMs }) => ({ key, value, ttlMs }))
        })
      },
      (state, current, prepared) => {
        const actual = sqliteProjectTextEntries((prepared as typeof input).entries)
        for (const entry of actual)
          sqliteWrite(
            this.#organization,
            'text',
            entry.key,
            entry.value,
            state,
            'conflict',
            current,
            entry.ttlMs
          )
      },
      {
        get count() {
          return captured.length
        }
      }
    )
  }

  removeMany: ISqliteInternalScope<TValue>['removeMany'] = (keys) => {
    let captured: readonly IStorageBatchKey[]
    let input: { keys: readonly IStorageKey[] }
    return sqliteScoped(
      this.#organization,
      this,
      SqliteOperation.removeMany,
      () => {
        captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
        return (input = { keys: captured.map(({ key }) => key) })
      },
      (state, _current, prepared) => {
        // Scope admission is already held; no wait separates this projection from native SQL.
        const actual = projectStorageBatchKeys((prepared as typeof input).keys, SqliteNames.backend)
        return sqliteRemoveTextBatch(this.#organization, actual, state)
      },
      {
        get count() {
          return captured.length
        }
      }
    )
  }

  removeByPrefix: ISqliteInternalScope<TValue>['removeByPrefix'] = (prefix) => {
    let captured: IStorageKey
    return sqliteScoped(
      this.#organization,
      this,
      SqliteOperation.removeByPrefix,
      () => {
        captured = snapshotStorageKey(prefix, SqliteNames.backend)
        return { prefix: captured }
      },
      (state, _current, input) => {
        /** The outer snapshot protects pipeline waits; this native segment has no await. */
        const prefix = (input as { prefix: IStorageKey }).prefix
        assertStorageKey(prefix, SqliteNames.backend)
        return sqliteRemovePrefix(this.#organization, 'text', prefix, state)
      },
      { count: undefined }
    )
  }

  iterateRecords: ISqliteInternalScope<TValue>['iterateRecords'] = (range) =>
    sqliteTransactionIterator(this.#organization, this, range)

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(organization: ISqliteOrganizationContext<TValue>) {
    this.#organization = organization
    Object.assign(
      this,
      createSqliteExecutor(
        (prepare, ctx, run) =>
          sqliteScoped(this.#organization, this, SqliteOperation.sql, {}, (state, current) =>
            sqliteExecuteSql(this.#organization, prepare, ctx, run, state, current)
          ),
        this.#organization.statements
      )
    )
  }
}

/** Create the full scope afresh for callback, accepted operation and final validation views. */
export function sqliteCreateScope<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): ISqliteTransactionScope<TValue> {
  const scope: ISqliteInternalScope<TValue> = new SqliteScope<TValue>(organization)
  const api = organization.core.createTransactionApi(scope)
  if (api !== undefined) Object.defineProperty(scope, 'api', { value: api, enumerable: true })
  return scope
}
/** SQL statistics use the shared compile output and retain native result shape and error cause. */
export function sqliteExecuteSql<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  prepare: () => ICompiledStorageSql,
  ctx: IOperationContext | undefined,
  run: (compiled: ICompiledStorageSql) => R,
  state?: INativeState,
  scope?: ISqliteTransactionScope<TValue>
): R {
  if (
    organization.shared !== undefined ||
    state?.journalBefore !== undefined ||
    (state === undefined && organization.core.journal?.active())
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: SqliteNames.backend
    })
  /** Root SQL never joins another native attempt; scope SQL validates its original owner first. */
  if (scope) sqliteNativeFor(organization, scope)
  else sqliteAssertRoot(organization)
  assertOperationContext(ctx)
  const context = ctx
  throwIfAborted(context?.signal)
  const compiled = prepare()
  const observer = scope ? organization.sqlStages.forTransaction(scope) : organization.sqlStages
  const started = Date.now()
  sqliteObserve(organization, observer, 'beforeSql', compiled.values.length, compiled.text.length)
  try {
    const result = run(compiled)
    sqliteObserve(
      organization,
      observer,
      'afterSql',
      Date.now() - started,
      Array.isArray(result)
        ? result.length
        : result && typeof result === 'object' && 'changes' in result
          ? result.changes
          : result === undefined
            ? 0
            : 1
    )
    return result
  } catch (error) {
    sqliteObserve(organization, observer, 'onSqlError', (error as { code?: unknown })?.code)
    if (state?.mode === 'deferred' && sqliteIsBusy(organization, error))
      throw new SqlitePhysicalBusy(error)
    throw normalizeSqliteFailure(error)
  }
}
/** A transaction cursor owns buffered native rows while canonical scope admission owns activity. */
class SqliteTransactionCursor<TValue> {
  /** Fixed organization execution and codecs remain owned by their installed store. */
  readonly #organization: ISqliteOrganizationContext<TValue>
  /** Every next call is authorized against this cursor's original authentic scope. */
  readonly #scope: ISqliteTransactionScope<TValue>
  /** Revision observations stay on the native attempt that created this cursor. */
  readonly #state: INativeState
  /** The original range is admitted when the first native page is read. */
  readonly #range: IKeyRange | undefined
  /** One detached native snapshot is shared by subsequent admitted advances. */
  #rows: readonly ISqliteRow[] | undefined
  /** The next physical row may be skipped if it has expired. */
  #position = 0
  /** Observation counts only values actually returned to the caller. */
  #returnedCount = 0
  /** Authenticate at cursor creation without reading native rows eagerly. */
  constructor(
    organization: ISqliteOrganizationContext<TValue>,
    scope: ISqliteTransactionScope<TValue>,
    range: IKeyRange | undefined
  ) {
    this.#organization = organization
    this.#scope = scope
    this.#range = range
    this.#state = sqliteNativeFor(organization, scope)
  }
  /** Advance using the current short-lived operation view and the original snapshot position. */
  #advance(
    actual: INativeState,
    current: ISqliteTransactionScope<TValue>
  ): IteratorResult<[IStorageKey, TValue]> {
    if (this.#rows === undefined)
      this.#rows = sqliteRecordRows(this.#organization, actual.orgId, this.#range, actual)
    while (this.#position < this.#rows.length) {
      const row = this.#rows[this.#position++]!
      const key = decodeKey(row.key as Uint8Array)
      if (!sqliteLiveExpiration(this.#organization, 'record', key, row.expires_at, actual)) {
        sqlitePrune(this.#organization, 'record', key, actual)
        continue
      }
      sqliteRevision(this.#organization, this.#state, 'record', key)
      this.#returnedCount++
      return {
        done: false,
        value: [
          key,
          sqliteConvert(this.#organization, 'record', 'decode', row.value, current) as TValue
        ]
      }
    }
    return { done: true, value: undefined }
  }
  /** Release the detached buffer and report the original actual return count. */
  #close(): void {
    this.#rows = []
    sqliteObserve(
      this.#organization,
      this.#organization.operationStages,
      'onStorageIterationClose',
      this.#returnedCount
    )
  }
  /** Canonical iterator registration owns new operation views and close order. */
  open(): IStorageIterator<[IStorageKey, TValue]> {
    return this.#organization.transactionOwner.registerIterator<
      ISqliteTransactionScope<TValue>,
      [IStorageKey, TValue]
    >(this.#scope, {
      next: (current) =>
        sqliteScoped(
          this.#organization,
          current,
          SqliteOperation.next,
          { range: this.#range },
          (actual, currentScope) => this.#advance(actual, currentScope)
        ),
      close: () => this.#close()
    })
  }
}
/** Register one named cursor with the existing transaction owner. */
export function sqliteTransactionIterator<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  scope: ISqliteTransactionScope<TValue>,
  range?: IKeyRange
): IStorageIterator<[IStorageKey, TValue]> {
  return new SqliteTransactionCursor(organization, scope, range).open()
}
