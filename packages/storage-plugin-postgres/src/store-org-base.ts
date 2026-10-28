// Per-organization native store class for the PostgreSQL store (see ./store.ts).
import type { IStorageCapabilities } from '@migaia/storage-contract'
import {
  createBackendChangeIterator,
  snapshotStorageKey,
  snapshotStorageBatchKeys,
  createTransactionBuilder,
  runWithConcurrency,
  asyncDisposeKey,
  reportCleanupError
} from '@migaia/storage-host/sdk'
import {
  readTransactionConflictPolicy,
  type IStorageKey,
  type IOperationContext,
  type ITransactionOptions,
  type IWriteOptions,
  type IKeyRange,
  type IKeyValueApi,
  type IStorageChange
} from '@migaia/storage-contract'
import { inspectPgLocks } from './locks.ts'
import {
  readPg,
  writePg,
  removePg,
  clearPg,
  prunePg,
  observePgRange,
  getManyPg,
  setManyPg,
  removeManyPg,
  removePrefixPg
} from './native.ts'
import { pgTextKey, encodePgRecord, decodePgRecord } from './codec.ts'
import { PgNames, PgOperation } from './constants.ts'
import { invalidArgument } from './errors.ts'
import type { IPostgresTransactionScope } from './types.ts'
import type { ITransactionBuilder } from '@migaia/storage-contract'
import { createPgOrgSql, createPgRecordIterator } from './store-records.ts'
import { runPgRootOperation, textKey, textValue, pointLocks, textEntries } from './store-state.ts'
import type { IPgOrganizationContext } from './store-state.ts'

/**
 * One organization's native PostgreSQL store: text, bytes, record and RDF channels over the shared
 * pool.
 */
class PgOrgBase<T> {
  /** Owner state passed in by the constructor caller; read by the members below. */
  readonly #organization: IPgOrganizationContext<T>

  /** Installed by a spread in the constructor; declared so the class carries the store type. */
  declare readonly sql: ReturnType<typeof createPgOrgSql<T>>['sql']

  backend = PgNames.backend

  capabilities: IStorageCapabilities

  get = (key: string, ctx?: IOperationContext) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.get,
      ctx,
      () => textKey(key),
      (state, input) =>
        readPg(state, this.#organization.environment.tables, 'text', input) as Promise<
          string | null
        >
    )

  set = (key: string, value: string, ctx?: IWriteOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.set,
      ctx,
      () => ({ key: textKey(key), value: textValue(value) }),
      (state, input) =>
        writePg(
          state,
          this.#organization.environment.tables,
          'text',
          input.key,
          input.value,
          readTransactionConflictPolicy(state.ctx, PgNames.backend)
        ),
      (input) => pointLocks(input.key)
    )

  remove = (key: string, ctx?: ITransactionOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.remove,
      ctx,
      () => textKey(key),
      async (state, input) => {
        await removePg(state, this.#organization.environment.tables, 'text', input)
      },
      (input) => pointLocks(input)
    )

  has = (key: string, ctx?: IOperationContext) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.has,
      ctx,
      () => textKey(key),
      async (state, input) =>
        (await readPg(state, this.#organization.environment.tables, 'text', input)) !== null
    )

  keys = (ctx?: IOperationContext) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.keys,
      ctx,
      () => ({}),
      async (state) => {
        await observePgRange(state, this.#organization.environment.tables, 'text')
        const expired = (
          await state.client.query(
            'SELECT key FROM ' +
              this.#organization.environment.tables.text +
              ' WHERE org_id=$1 AND expires_at<=clock_timestamp()',
            [this.#organization.runtime.orgId],
            state.ctx
          )
        ).rows
        for (const row of expired)
          await prunePg(state, this.#organization.environment.tables, 'text', pgTextKey(row.key))
        const rows = (
          await state.client.query(
            'SELECT key FROM ' +
              this.#organization.environment.tables.text +
              ' WHERE org_id=$1 ORDER BY key',
            [this.#organization.runtime.orgId],
            state.ctx
          )
        ).rows
        return rows
          .map((row) => pgTextKey(row.key))
          .filter((key): key is string => typeof key === 'string')
      }
    )

  clearValues = (ctx?: ITransactionOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.clearValues,
      ctx,
      () => ({}),
      (state) => clearPg(state, this.#organization.environment.tables, 'text')
    )

  clearAll = (ctx?: ITransactionOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.clearAll,
      ctx,
      () => ({}),
      async (state) => {
        for (const channel of ['text', 'bytes', 'record'] as const)
          await clearPg(state, this.#organization.environment.tables, channel)
      }
    )

  getBytes = (key: string, ctx?: IOperationContext) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.getBytes,
      ctx,
      () => textKey(key),
      (state, input) =>
        readPg(
          state,
          this.#organization.environment.tables,
          'bytes',
          input
        ) as Promise<Uint8Array | null>
    )

  setBytes = (key: string, value: Uint8Array, ctx?: IWriteOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.setBytes,
      ctx,
      () => {
        textKey(key)
        if (!(value instanceof Uint8Array)) throw invalidArgument()
        return { key, value: value.slice() }
      },
      (state, input) =>
        writePg(
          state,
          this.#organization.environment.tables,
          'bytes',
          input.key,
          input.value,
          readTransactionConflictPolicy(state.ctx, PgNames.backend)
        ),
      (input) => pointLocks(input.key)
    )

  removeBytes = (key: string, ctx?: ITransactionOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.removeBytes,
      ctx,
      () => textKey(key),
      async (state, input) => {
        await removePg(state, this.#organization.environment.tables, 'bytes', input)
      },
      (input) => pointLocks(input)
    )

  clearBytes = (ctx?: ITransactionOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.clearBytes,
      ctx,
      () => ({}),
      (state) => clearPg(state, this.#organization.environment.tables, 'bytes')
    )

  getRecord = (key: IStorageKey, ctx?: IOperationContext) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.getRecord,
      ctx,
      () =>
        /** Compound keys must stay fixed through awaited revision and native row operations. */
        snapshotStorageKey(key, PgNames.backend),
      (state, input) =>
        readPg(state, this.#organization.environment.tables, 'record', input) as Promise<
          T | undefined
        >
    )

  putRecord = (value: T, key?: IStorageKey, ctx?: IWriteOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.putRecord,
      ctx,
      () => ({
        /** A supplied compound key must survive awaited native operation admission unchanged. */
        key: key === undefined ? undefined : snapshotStorageKey(key, PgNames.backend),
        value: decodePgRecord<T>(encodePgRecord(value))
      }),
      async (state, input) => {
        const actual =
          input.key ??
          String(
            (await state.client.query('SELECT gen_random_uuid()::text AS key', [], state.ctx))
              .rows[0]?.key
          )
        await writePg(
          state,
          this.#organization.environment.tables,
          'record',
          actual,
          input.value,
          readTransactionConflictPolicy(state.ctx, PgNames.backend)
        )
        return actual
      },
      (input) => pointLocks(input.key)
    )

  deleteRecord = (key: IStorageKey, ctx?: ITransactionOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.deleteRecord,
      ctx,
      () =>
        /** Compound keys must stay fixed through awaited revision and native row operations. */
        snapshotStorageKey(key, PgNames.backend),
      async (state, input) => {
        await removePg(state, this.#organization.environment.tables, 'record', input)
      },
      (input) => pointLocks(input)
    )

  clearRecords = (ctx?: ITransactionOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.clearRecords,
      ctx,
      () => ({}),
      (state) => clearPg(state, this.#organization.environment.tables, 'record')
    )

  metadata = {
    get: (key: string, ctx?: IOperationContext) =>
      runPgRootOperation(
        this.#organization,
        PgOperation.metadataGet,
        ctx,
        () => textKey(key),
        (state, input) => readPg(state, this.#organization.environment.tables, 'metadata', input)
      ),
    set: (key: string, value: unknown, ctx?: IWriteOptions) =>
      runPgRootOperation(
        this.#organization,
        PgOperation.metadataSet,
        ctx,
        () => ({ key: textKey(key), value: decodePgRecord(encodePgRecord(value)) }),
        (state, input) =>
          writePg(
            state,
            this.#organization.environment.tables,
            'metadata',
            input.key,
            input.value,
            'replace'
          )
      ),
    delete: (key: string, ctx?: IOperationContext) =>
      runPgRootOperation(
        this.#organization,
        PgOperation.metadataDelete,
        ctx,
        () => textKey(key),
        async (state, input) => {
          await removePg(state, this.#organization.environment.tables, 'metadata', input)
        }
      )
  }

  iterateRecords = (range?: IKeyRange, ctx?: IOperationContext) =>
    createPgRecordIterator(this.#organization, range, ctx)

  transaction = <R>(
    run: (scope: IPostgresTransactionScope<T>) => R,
    options?: ITransactionOptions
  ) => this.#organization.engine.run(run, options, PgOperation.transaction)

  tx = (): ITransactionBuilder<IPostgresTransactionScope<T>> =>
    createTransactionBuilder(
      this.#organization.store,
      undefined,
      this.#organization.environment.core.getChainMethods('tx')
    )

  inspectLocks = (ctx?: IOperationContext) => {
    this.#organization.environment.controller.assertLive()
    return this.#organization.runtime.execution.run(
      { operation: PgOperation.inspectLocks, input: {}, ctx },
      () =>
        inspectPgLocks(
          this.#organization.environment.configuration,
          this.#organization.environment.tables,
          this.#organization.runtime.orgId,
          this.#organization.environment.controller.origin
        )
    )
  }

  getMany = (keys: readonly IStorageKey[], ctx?: IOperationContext) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.getMany,
      ctx,
      () =>
        /** Batch membership must stay fixed while native locks and revision checks await. */
        snapshotStorageBatchKeys(keys, PgNames.backend),
      (state, input) => getManyPg(state, this.#organization.environment.tables, input),
      undefined,
      false,
      { when: (input) => input.length === 0, value: [] }
    )

  setMany = (entries: Parameters<IKeyValueApi['setMany']>[0], ctx?: ITransactionOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.setMany,
      ctx,
      () => textEntries(entries),
      (state, input) => setManyPg(state, this.#organization.environment.tables, input),
      (input) => input.flatMap((entry) => pointLocks(entry.key)),
      false,
      { when: (input) => input.length === 0, value: undefined }
    )

  removeMany = (keys: readonly IStorageKey[], ctx?: ITransactionOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.removeMany,
      ctx,
      () =>
        /** Batch membership must stay fixed while native locks and revision checks await. */
        snapshotStorageBatchKeys(keys, PgNames.backend),
      (state, input) => removeManyPg(state, this.#organization.environment.tables, input),
      (input) => input.flatMap((entry) => pointLocks(entry.key)),
      false,
      { when: (input) => input.length === 0, value: 0 }
    )

  removeByPrefix = (prefix: IStorageKey, ctx?: ITransactionOptions) =>
    runPgRootOperation(
      this.#organization,
      PgOperation.removeByPrefix,
      ctx,
      () =>
        /** Prefix bounds must not change between awaited native scan and deletion. */
        snapshotStorageKey(prefix, PgNames.backend),
      (state, input) => removePrefixPg(state, this.#organization.environment.tables, 'text', input)
    )

  dispose = () => this.#organization.environment.controller.dispose();

  [asyncDisposeKey] = () =>
    (this.#organization.symbolic ??= this.#organization.environment.controller
      .dispose()
      .catch((cause) => reportCleanupError(this.#organization.environment.report, cause)))

  /** Capture the owner state; members are own-property arrows so the public shape is unchanged. */
  constructor(organization: IPgOrganizationContext<T>) {
    this.#organization = organization
    this.capabilities = {
      batch: true,
      syncRead: false,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: this.#organization.environment.configuration.server === 'postgres',
      maxValueBytes: undefined,
      opaqueEntries: false
    } as const
    /** Only the original bound native store publishes undo through the shared journal owner. */
    Object.assign(
      this,
      this.#organization.runtime.journal === undefined
        ? {}
        : {
            undo: async (txId: string, ctx?: IOperationContext) => {
              this.#organization.environment.controller.assertLive()
              const release = this.#organization.environment.controller.beginMutation()
              return runWithConcurrency<{ readonly txId: string }>(
                {
                  store: this.#organization.store,
                  options: ctx === undefined ? {} : ctx,
                  prepare: () => this.#organization.runtime.journal!.prepare()
                },
                {
                  attempt: async (context) => ({
                    status: 'committed',
                    value: await this.#organization.runtime.journal!.undo(txId, (keys, work) =>
                      createTransactionBuilder(
                        this.#organization.store,
                        context,
                        this.#organization.environment.core.getChainMethods('tx')
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
    Object.assign(this, createPgOrgSql(this.#organization))
    Object.assign(
      this,
      this.#organization.environment.configuration.server === 'postgres'
        ? {
            subscribeChanges: (listener: (change: IStorageChange) => void) => {
              this.#organization.environment.controller.assertLive()
              return this.#organization.environment.controller.subscribe((change) => {
                if (
                  change.orgId === this.#organization.runtime.orgId ||
                  (change.kind === 'reset' && change.orgId === undefined)
                )
                  return listener(change)
              })
            },
            watch: (key: string, ctx?: IOperationContext) =>
              createBackendChangeIterator(this.#organization.environment.controller, {
                orgId: this.#organization.runtime.orgId,
                channel: 'value',
                key,
                ctx,
                execute: (advance, context) =>
                  this.#organization.runtime.execution.run(
                    { operation: PgOperation.watch, input: { key }, ctx: context },
                    advance
                  )
              })
          }
        : {}
    )
  }
}

/** Flat KV methods and its token reference one exact original native base object. */
export function createPgOrgBase<T>(organization: IPgOrganizationContext<T>) {
  return new PgOrgBase<T>(organization)
}
