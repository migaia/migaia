import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  snapshotStorageKey,
  snapshotStorageBatchKeys,
  createStorageBatchKeyCapture,
  readTransactionConflictPolicy,
  runTransactionOperation,
  assertTransactionOwner,
  useTransactionCapability,
  createTransactionBuilder,
  createStorageIteratorLifetime,
  createSqlTag,
  createRecordQuery,
  provideCapabilities,
  implement,
  kv,
  records,
  ttl,
  counter,
  sql,
  vector,
  durableChangeFeed,
  snapshotStorageTtlTarget,
  assertStorageTtlDuration,
  snapshotStorageCounterIncrement,
  type IStorageKey,
  type IStorageIterator,
  type IOperationContext,
  type ITransactionOptions,
  type IWriteOptions,
  type IKeyRange,
  type IKeyValueApi,
  type IRecordsApi,
  type ITransactionRecordsApi,
  type ITtlApi,
  type ITtlTarget,
  type ITransactionTtlApi,
  type ICounterApi,
  type ITransactionCounterApi,
  type ICapabilityInstallPort,
  type ICapabilityPublication,
  type IRecordQuerySource,
  type ISqlExecutor,
  type ICompiledStorageSql,
  type ILockKey,
  type IStorageChange,
  type IStorageStore
} from '@migaia/storage-contract'
import { asyncDisposeKey } from '@migaia/plugin-host'
import type {
  IStoragePluginCore,
  IStorageBackendOrgContext,
  IStorageOrgBinding
} from '@migaia/storage-host'
import {
  snapshotKeyRange,
  createBackendChangeIterator,
  createStorageOperationReporter,
  reportCleanupError,
  throwIfAborted,
  type IBackendChangeController
} from '@migaia/storage-host/authoring/backend'
import {
  snapshotPostgresOptions,
  postgresTables,
  ensurePostgresTables,
  type IPgConfiguration,
  type IPgTables
} from './schema.js'
import { probePostgres } from './probe.js'
import { createPgTransactions, observePg } from './transaction.js'
import { createPgChanges } from './changes.js'
import { createPgVectors } from './vector.js'
import { createPgDurableApi, type IPgReplicationSelection } from './logical-replication.js'
import { inspectPgLocks } from './locks.js'
import {
  readPg,
  writePg,
  removePg,
  clearPg,
  scanPgRecords,
  prunePg,
  markPgChanged,
  observePgRange,
  pgLockKey,
  getManyPg,
  setManyPg,
  removeManyPg,
  removePrefixPg,
  type IPgState
} from './native.js'
import { pgKey, pgTextKey, encodePgRecord, decodePgRecord, createPgCodecs } from './codec.js'
import { PgNames, PgOperation } from './constants.js'
import { invalidArgument, capture, normalizePostgresError } from './errors.js'
import { PostgresErrorText } from './error-text.js'
import type {
  IPostgresStore,
  IPostgresOptions,
  IPostgresTransactionScope,
  IPgServer,
  IPgConnection,
  IPgNativeOperation
} from './types.js'
/** These original scope extensions bind standard tokens to exactly one native transaction. */
const ttlScope = Symbol('postgres-ttl')
/** Counter binds the same text draft and never opens a nested root transaction. */
const counterScope = Symbol('postgres-counter')
/** Original complete views retain their actual record query source until owner invalidation. */
const recordsScope = Symbol('postgres-records')
/** Private method facts hold no separate admission or lifecycle authority. */
type IPgScope<T> = IPostgresTransactionScope<T> & {
  readonly [ttlScope]: ITransactionTtlApi
  readonly [counterScope]: ITransactionCounterApi
  readonly [recordsScope]: ITransactionRecordsApi<T>
}
/** The installation window receives only original provider/controller/native borrowing ports. */
export type IPostgresConstruction<T> = {
  readonly store: IPostgresStore<IPgServer, T>
  readonly installer: ICapabilityInstallPort
  readonly controller: IBackendChangeController
  readonly configuration: IPgConfiguration
  readonly tables: IPgTables
  readonly orgBinding: IStorageOrgBinding
  readonly runNative: IPgNativeOperation
  createVectorApi(): import('@migaia/storage-contract').IVectorApi<true>
  createDurableApi(): import('@migaia/storage-contract').IDurableChangeFeedApi
  reportReplication(maxSlotWalKeepSize: string): void
  releaseOrgCapabilities(): void
  getTransactionClient(scope: IPostgresTransactionScope): IPgConnection
  assertNativeRoot(value: object): void
}
/** String-only channels use the original public key assertion before canonical byte capture. */
function textKey(key: string): string {
  assertStringStorageKey(key, PgNames.backend)
  return key
}
/** Input strings are detached scalar payloads; unsupported runtime values fail before native work. */
function textValue(value: string): string {
  if (typeof value !== 'string')
    throw invalidArgument(new TypeError(PostgresErrorText.invalidArgument))
  return value
}
/** Cross-channel writes acquire the original finite key set before reading their first baseline. */
function pointLocks(key: IStorageKey | undefined): readonly ILockKey[] {
  if (key === undefined) return []
  return [
    pgLockKey('text', key),
    ...(typeof key === 'string' ? [pgLockKey('bytes', key)] : []),
    pgLockKey('record', key)
  ]
}
/** Fully capture one atomic batch in original getter order before a native connection is borrowed. */
function textEntries(entries: Parameters<IKeyValueApi['setMany']>[0]) {
  return capture(() => {
    if (!Array.isArray(entries)) throw invalidArgument()
    const keyCapture = createStorageBatchKeyCapture(PgNames.backend)
    const length = entries.length
    const result: {
      readonly key: IStorageKey
      readonly identity: string
      readonly value: string
      readonly ttlMs: number | undefined
    }[] = []
    for (let index = 0; index < length; index += 1) {
      const entry = entries[index]!
      const captured = keyCapture(entry.key)
      const value = textValue(entry.value)
      const ttlMs = entry.ttlMs
      if (captured.firstIndex !== index) throw invalidArgument()
      if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, PgNames.backend)
      result.push({
        key: captured.key,
        identity: captured.identity,
        value,
        ttlMs
      })
    }
    return Object.freeze(result)
  })
}
/** A TTL target may reach vector only after the selected Feature supplies its original table port. */
/** Backend construction probes actual facts before native DDL and borrows its injected driver. */
export async function createPostgresStore<T>(
  options: IPostgresOptions<IPgServer>,
  core: IStoragePluginCore,
  vectorSelected: () => boolean,
  replicationSelected: () => IPgReplicationSelection | undefined
): Promise<IPostgresConstruction<T>> {
  const configuration = snapshotPostgresOptions(options)
  const probe = await probePostgres(configuration)
  const tables = postgresTables(configuration, probe.maxIdentifierBytes)
  await ensurePostgresTables(configuration, tables)
  const report = createStorageOperationReporter()
  /**
   * Original native scope bindings share physical organization ownership without granting
   * authority.
   */
  const states = new WeakMap<object, { readonly store: IStorageStore; readonly state: IPgState }>()
  let changes: Awaited<ReturnType<typeof createPgChanges>> | undefined
  /** Logical organization closures release together with the original physical controller. */
  let releaseOrganizations = () => {}
  const controller = core.createChangeController({
    backend: PgNames.backend,
    origin:
      PgNames.backend +
      ':' +
      String(
        (await configuration.driver.query('SELECT gen_random_uuid()::text AS origin', [])).rows[0]
          ?.origin
      ),
    finalize: async () => {
      try {
        await changes?.resource?.dispose()
      } finally {
        releaseOrganizations()
      }
    }
  })
  try {
    if (configuration.server === 'postgres' && configuration.driver.listen === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: PgNames.backend
      })
    changes = await createPgChanges(configuration, controller)
    /** Every org shares the same physical layout/controller and receives an immutable host context. */
    const bind = (
      runtime: IStorageBackendOrgContext,
      orgView: boolean
    ): Omit<IPostgresConstruction<T>, 'configuration' | 'tables' | 'orgBinding'> => {
      let store: IPostgresStore<IPgServer, T>
      let installer: ICapabilityInstallPort | undefined
      let engine: ReturnType<typeof createPgTransactions<IPgScope<T>>>
      let symbolic: Promise<void> | undefined
      /** Selected native vectors share this exact bound organization's original transaction owner. */
      let vectors: ReturnType<typeof createPgVectors> | undefined
      /** Only this child's original installer owns its selected publication. */
      let vectorPublication: ICapabilityPublication | undefined
      /** Durable publication uses the same child's provider table and original physical lifetime. */
      let durablePublication: ICapabilityPublication | undefined
      /** Native route is captured from this bound org, never borrowed from the root API. */
      let durableApi: import('@migaia/storage-contract').IDurableChangeFeedApi | undefined
      const ttlTarget = (input: ITtlTarget): ITtlTarget => {
        const target = snapshotStorageTtlTarget(input, PgNames.backend)
        if (target.channel === 'vector' && !vectorSelected())
          throw new StorageContractError(StorageContractErrorCode.unsupported, {
            backend: PgNames.backend
          })
        if (target.channel === 'vector') createVectorApi()
        return target
      }
      const operationStages = () => runtime.stageBindings.operationStages(store)
      /** Observation encloses actual settlement; report-only hooks cannot alter an operation. */
      const observed = async <R>(
        operation: string,
        scope: IPgScope<T> | undefined,
        run: () => R,
        count = 1
      ): Promise<Awaited<R>> => {
        const stages = operationStages()
        const observer = scope === undefined ? stages : stages.forTransaction(scope)
        const started = Date.now()
        observePg(observer, 'beforeStorageOperation', operation, count)
        try {
          const value = await run()
          observePg(observer, 'afterStorageOperation', operation, Date.now() - started, count)
          return value
        } catch (cause) {
          observePg(
            observer,
            'onStorageOperationError',
            operation,
            typeof cause === 'object' && cause !== null && 'code' in cause
              ? String(cause.code)
              : undefined
          )
          throw cause
        }
      }
      /** Scope admission always precedes getter capture, pipeline stages, codecs and native queries. */
      const scoped = <I, R>(
        scope: IPgScope<T>,
        operation: string,
        prepare: () => I,
        run: (state: IPgState, current: IPgScope<T>, input: I) => R,
        empty?: { readonly when: (input: I) => boolean; readonly value: NoInfer<Awaited<R>> }
      ): Promise<Awaited<R>> =>
        runTransactionOperation(scope, (current) => {
          const state = engine.stateFor(current)
          const input = prepare()
          if (empty?.when(input)) return empty.value
          return runtime.execution.run(
            { operation, input, ctx: state.ctx, scope: current },
            (actual) => {
              throwIfAborted(state.ctx?.signal)
              return observed(
                operation,
                current,
                () =>
                  run(
                    {
                      ...state,
                      codecs: createPgCodecs(
                        runtime.stageBindings.codecStages(store).forTransaction(current)
                      )
                    },
                    current,
                    actual
                  ),
                Array.isArray(actual) ? actual.length : 1
              )
            }
          )
        })
      /** Root operations use one original concurrency attempt and the same native data functions. */
      const root = async <I, R>(
        operation: string,
        ctx: ITransactionOptions | undefined,
        prepare: () => I,
        run: (state: IPgState, input: I) => R,
        lock?: (input: I) => readonly ILockKey[],
        enveloped = false,
        empty?: { readonly when: (input: I) => boolean; readonly value: NoInfer<Awaited<R>> }
      ): Promise<Awaited<R>> => {
        controller.assertLive()
        let input = prepare()
        if (empty?.when(input)) return empty.value
        const invoke = () =>
          engine.run(
            (scope) =>
              run(
                {
                  ...engine.stateFor(scope),
                  codecs: createPgCodecs(runtime.stageBindings.codecStages(store))
                },
                input
              ),
            ctx,
            operation,
            {
              input,
              ...(lock === undefined ? {} : { lock: () => lock(input) }),
              capture: (actual) => {
                input = actual as I
              },
              observe: (work) =>
                observed(operation, undefined, work, Array.isArray(input) ? input.length : 1)
            },
            !enveloped
          )
        return enveloped ? observed(operation, undefined, invoke) : invoke()
      }
      /**
       * Native SQL compiles lazily only after original operation admission and retains its
       * statement port.
       */
      const executor = (getScope?: () => IPgScope<T>): ISqlExecutor => {
        const execute = async (
          prepare: () => ICompiledStorageSql,
          ctx: IOperationContext | undefined
        ) => {
          const run = async (state: IPgState, current: IPgScope<T> | undefined) => {
            if (orgView)
              throw new StorageContractError(StorageContractErrorCode.unsupported, {
                backend: PgNames.backend
              })
            const compiled = prepare()
            const observer = runtime.stageBindings.sqlStages(store)
            const bound = current ? observer.forTransaction(current) : observer
            const started = Date.now()
            observePg(
              bound,
              'beforeSql',
              compiled.values.length,
              new TextEncoder().encode(compiled.text).length
            )
            try {
              const result = await state.client.query(compiled.text, compiled.values, state.ctx)
              observePg(bound, 'afterSql', Date.now() - started, result.rowCount)
              return result
            } catch (cause) {
              observePg(
                bound,
                'onSqlError',
                typeof cause === 'object' && cause !== null && 'code' in cause
                  ? String(cause.code)
                  : undefined
              )
              throw cause
            }
          }
          const scope = getScope?.()
          return scope
            ? scoped(
                scope,
                PgOperation.sql,
                () => ({}),
                (state, current) => run(state, current)
              )
            : root(
                PgOperation.sql,
                ctx,
                () => ({}),
                (state) => run(state, undefined)
              )
        }
        return {
          sql: createSqlTag({
            dialect: 'postgres',
            all: async (prepare, ctx) => (await execute(prepare, ctx)).rows,
            get: async (prepare, ctx) => (await execute(prepare, ctx)).rows[0],
            run: async (prepare, ctx) => ({ changes: (await execute(prepare, ctx)).rowCount })
          })
        }
      }
      /** Keyset pages retain bounded native buffers and keep every next in the original transaction. */
      const iterator = (
        range: IKeyRange | undefined,
        ctx: IOperationContext | undefined,
        scope?: IPgScope<T>
      ): IStorageIterator<[IStorageKey, T]> => {
        const captured = snapshotKeyRange(range, PgNames.backend)
        let after: Uint8Array | undefined
        let page: readonly {
          readonly key: IStorageKey
          readonly bytes: Uint8Array
          readonly value: T
        }[] = []
        let position = 0
        let ended = false
        const advance = async (state: IPgState): Promise<IteratorResult<[IStorageKey, T]>> => {
          if (ended) return { done: true, value: undefined }
          if (position === page.length) {
            page = await scanPgRecords<T>(state, tables, captured, after, 128)
            position = 0
            if (page.length === 0) {
              ended = true
              return { done: true, value: undefined }
            }
          }
          const row = page[position++]!
          after = row.bytes
          return { done: false, value: [row.key, row.value] }
        }
        const close = () => {
          ended = true
          page = []
        }
        if (scope)
          return engine.registerIterator(scope, {
            next: (current) =>
              runtime.execution.run(
                {
                  operation: PgOperation.next,
                  input: { range: captured },
                  ctx: engine.stateFor(current).ctx,
                  scope: current
                },
                () => advance(engine.stateFor(current))
              ),
            close
          })
        const lifetime = createStorageIteratorLifetime<[IStorageKey, T]>({
          close: async () => {
            close()
          },
          report
        })
        return {
          next: () =>
            lifetime.advance(() =>
              root(
                PgOperation.next,
                ctx,
                () => captured,
                (state) => advance(state)
              )
            ),
          return: (value) => {
            close()
            return lifetime.returned(value)
          },
          dispose: lifetime.dispose,
          [asyncDisposeKey]: lifetime.symbolic,
          [Symbol.asyncIterator]() {
            return this
          }
        }
      }
      /**
       * Shared query plans own all client predicates, projections, traversal, reductions and
       * patching.
       */
      const querySource = (scope?: IPgScope<T>): IRecordQuerySource => ({
        pushdown: { operators: [], operations: [], source: PgNames.backend, index: tables.record },
        asyncDisposeKey,
        tieBreakByKey: { direction: 'next' },
        cursorSource: store,
        execute: (input) => iterator(undefined, input.ctx, scope),
        mutate: (request, run) => {
          const invoke = (state: IPgState, current: IPgScope<T>) =>
            run({
              execute: (input) => iterator(undefined, input.ctx, current),
              accept: async (key, value) => {
                if (request.operation === 'delete') return removePg(state, tables, 'record', key)
                await writePg(state, tables, 'record', key, value, 'conflict')
                return true
              }
            })
          return scope
            ? scoped(
                scope,
                request.operation,
                () => ({}),
                (state, current) => invoke(state, current)
              )
            : engine.run(
                (current) => invoke(engine.stateFor(current), current),
                {
                  ...request.ctx,
                  ...(request.concurrency === undefined ? {} : { concurrency: request.concurrency })
                },
                request.operation
              )
        },
        ...(scope === undefined && configuration.server === 'postgres'
          ? {
              watch: (input) =>
                createBackendChangeIterator(controller, {
                  orgId: runtime.orgId,
                  channel: 'record',
                  ctx: input.ctx,
                  execute: (advance, context) =>
                    runtime.execution.run(
                      { operation: PgOperation.watch, input: {}, ctx: context },
                      advance
                    )
                })
            }
          : {})
      })
      /** These exact targets are native standard tables; no other channel is guessed or emulated. */
      const deadline = async (
        state: IPgState,
        input: ITtlTarget,
        ms?: number,
        persist = false
      ): Promise<number | boolean | undefined> => {
        const target = ttlTarget(input)
        if (target.channel === 'vector') return vectors!.deadline(state, target, ms, persist)
        const channel = target.channel
        const key = target.key
        await prunePg(state, tables, channel, key)
        const encoded = channel === 'record' ? pgKey(key).bytes : pgKey(key).hex
        if (ms === undefined && !persist) {
          const row = (
            await state.client.query(
              'SELECT CASE WHEN expires_at IS NULL THEN NULL ELSE GREATEST(0,extract(epoch FROM (expires_at-clock_timestamp()))*1000) END AS remaining FROM ' +
                tables[channel] +
                ' WHERE org_id=$1 AND key=$2',
              [runtime.orgId, encoded],
              state.ctx
            )
          ).rows[0]
          return row?.remaining == null ? undefined : Number(row.remaining)
        }
        await state.guardKeys([target])
        const result = await state.client.query(
          'UPDATE ' +
            tables[channel] +
            ' SET expires_at=' +
            (persist ? 'NULL' : "clock_timestamp()+($3::float8*interval '1 millisecond')") +
            ' WHERE org_id=$1 AND key=$2' +
            (persist ? ' AND expires_at IS NOT NULL' : '') +
            ' RETURNING key',
          [runtime.orgId, encoded, ...(persist ? [] : [ms!])],
          state.ctx
        )
        if (result.rowCount !== 0) markPgChanged(state, channel, key)
        return result.rowCount !== 0
      }
      /** Complete original views are built for the user, every accepted operation and commit checks. */
      const createScope = (_state: IPgState): IPgScope<T> => {
        const scope: IPgScope<T> = {
          use: (capability) => useTransactionCapability(scope, capability),
          get: (key) =>
            scoped(
              scope,
              PgOperation.get,
              () => textKey(key),
              (state) => readPg(state, tables, 'text', key) as Promise<string | null>
            ),
          set: (key, value, options) =>
            scoped(
              scope,
              PgOperation.set,
              () => ({
                key: textKey(key),
                value: textValue(value),
                policy: readTransactionConflictPolicy(options, PgNames.backend)
              }),
              (state, _current, input) =>
                writePg(state, tables, 'text', input.key, input.value, input.policy)
            ),
          remove: (key) =>
            scoped(
              scope,
              PgOperation.remove,
              () => textKey(key),
              async (state, _current, input) => {
                await removePg(state, tables, 'text', input)
              }
            ),
          has: (key) =>
            scoped(
              scope,
              PgOperation.has,
              () => textKey(key),
              async (state, _current, input) =>
                (await readPg(state, tables, 'text', input)) !== null
            ),
          getMany: (keys) =>
            scoped(
              scope,
              PgOperation.getMany,
              () => snapshotStorageBatchKeys(keys, PgNames.backend),
              (state, _current, input) => getManyPg(state, tables, input),
              { when: (input) => input.length === 0, value: [] }
            ),
          setMany: (entries) =>
            scoped(
              scope,
              PgOperation.setMany,
              () => textEntries(entries),
              (state, _current, input) => setManyPg(state, tables, input),
              { when: (input) => input.length === 0, value: undefined }
            ),
          removeMany: (keys) =>
            scoped(
              scope,
              PgOperation.removeMany,
              () => snapshotStorageBatchKeys(keys, PgNames.backend),
              (state, _current, input) => removeManyPg(state, tables, input),
              { when: (input) => input.length === 0, value: 0 }
            ),
          removeByPrefix: (prefix) =>
            scoped(
              scope,
              PgOperation.removeByPrefix,
              () => snapshotStorageKey(prefix, PgNames.backend),
              (state, _current, input) => removePrefixPg(state, tables, 'text', input)
            ),
          getBytes: (key) =>
            scoped(
              scope,
              PgOperation.getBytes,
              () => textKey(key),
              (state, _current, input) =>
                readPg(state, tables, 'bytes', input) as Promise<Uint8Array | null>
            ),
          setBytes: (key, value, options) =>
            scoped(
              scope,
              PgOperation.setBytes,
              () => {
                textKey(key)
                if (!(value instanceof Uint8Array)) throw invalidArgument()
                return {
                  key,
                  value: value.slice(),
                  policy: readTransactionConflictPolicy(options, PgNames.backend)
                }
              },
              (state, _current, input) =>
                writePg(state, tables, 'bytes', input.key, input.value, input.policy)
            ),
          removeBytes: (key) =>
            scoped(
              scope,
              PgOperation.removeBytes,
              () => textKey(key),
              async (state, _current, input) => {
                await removePg(state, tables, 'bytes', input)
              }
            ),
          getRecord: (key) =>
            scoped(
              scope,
              PgOperation.getRecord,
              () => snapshotStorageKey(key, PgNames.backend),
              (state, _current, input) =>
                readPg(state, tables, 'record', input) as Promise<T | undefined>
            ),
          putRecord: (value, key, options) =>
            scoped(
              scope,
              PgOperation.putRecord,
              () => ({
                key: key === undefined ? undefined : snapshotStorageKey(key, PgNames.backend),
                value: decodePgRecord<T>(encodePgRecord(value)),
                policy: readTransactionConflictPolicy(options, PgNames.backend)
              }),
              async (state, _current, input) => {
                const key =
                  input.key ??
                  String(
                    (
                      await state.client.query(
                        'SELECT gen_random_uuid()::text AS key',
                        [],
                        state.ctx
                      )
                    ).rows[0]?.key
                  )
                await writePg(state, tables, 'record', key, input.value, input.policy)
                return key
              }
            ),
          deleteRecord: (key) =>
            scoped(
              scope,
              PgOperation.deleteRecord,
              () => snapshotStorageKey(key, PgNames.backend),
              async (state, _current, input) => {
                await removePg(state, tables, 'record', input)
              }
            ),
          iterateRecords: (range) => iterator(range, undefined, scope),
          [ttlScope]: {
            expire: (target, ms) =>
              scoped(
                scope,
                PgOperation.ttlExpire,
                () => {
                  const captured = ttlTarget(target)
                  assertStorageTtlDuration(ms, PgNames.backend)
                  return { target: captured, ms }
                },
                async (state, _current, input) =>
                  (await deadline(state, input.target, input.ms)) as boolean
              ),
            remaining: (target) =>
              scoped(
                scope,
                PgOperation.ttlRemaining,
                () => ttlTarget(target),
                async (state, _current, input) =>
                  (await deadline(state, input)) as number | undefined
              ),
            persist: (target) =>
              scoped(
                scope,
                PgOperation.ttlPersist,
                () => ttlTarget(target),
                async (state, _current, input) =>
                  (await deadline(state, input, undefined, true)) as boolean
              )
          },
          [counterScope]: {
            increment: (key, by) =>
              scoped(
                scope,
                PgOperation.counterIncrement,
                () => ({
                  key: textKey(key),
                  increment: snapshotStorageCounterIncrement(by, PgNames.backend)
                }),
                async (state, _current, input) => {
                  await state.guardKeys([
                    pgLockKey('text', input.key),
                    pgLockKey('bytes', input.key),
                    pgLockKey('record', input.key)
                  ])
                  const result = input.increment(
                    (await readPg(state, tables, 'text', input.key)) as string | null
                  )
                  await writePg(state, tables, 'text', input.key, String(result), 'conflict')
                  return result
                }
              )
          },
          [recordsScope]: {
            query: <R = T>() =>
              createRecordQuery<R, undefined>(querySource(scope), core.getChainMethods('query')),
            removeByPrefix: (prefix) =>
              scoped(
                scope,
                PgOperation.removeByPrefix,
                () => snapshotStorageKey(prefix, PgNames.backend),
                (state, _current, input) => removePrefixPg(state, tables, 'record', input)
              )
          },
          ...executor(() => scope)
        }
        const api = orgView ? runtime.createTransactionApi(scope) : core.createTransactionApi(scope)
        if (api !== undefined) Object.defineProperty(scope, 'api', { value: api, enumerable: true })
        return Object.freeze(scope)
      }
      /** Flat KV methods and its token reference one exact original native base object. */
      const base = {
        backend: PgNames.backend,
        capabilities: {
          syncRead: false,
          binary: true,
          records: true,
          transactions: true,
          iteration: true,
          secondaryIndexes: false,
          changeFeed: configuration.server === 'postgres',
          maxValueBytes: undefined,
          opaqueEntries: false
        } as const,
        get: (key: string, ctx?: IOperationContext) =>
          root(
            PgOperation.get,
            ctx,
            () => textKey(key),
            (state, input) => readPg(state, tables, 'text', input) as Promise<string | null>
          ),
        set: (key: string, value: string, ctx?: IWriteOptions) =>
          root(
            PgOperation.set,
            ctx,
            () => ({ key: textKey(key), value: textValue(value) }),
            (state, input) =>
              writePg(
                state,
                tables,
                'text',
                input.key,
                input.value,
                readTransactionConflictPolicy(state.ctx, PgNames.backend)
              ),
            (input) => pointLocks(input.key)
          ),
        remove: (key: string, ctx?: ITransactionOptions) =>
          root(
            PgOperation.remove,
            ctx,
            () => textKey(key),
            async (state, input) => {
              await removePg(state, tables, 'text', input)
            },
            (input) => pointLocks(input)
          ),
        has: (key: string, ctx?: IOperationContext) =>
          root(
            PgOperation.has,
            ctx,
            () => textKey(key),
            async (state, input) => (await readPg(state, tables, 'text', input)) !== null
          ),
        keys: (ctx?: IOperationContext) =>
          root(
            PgOperation.keys,
            ctx,
            () => ({}),
            async (state) => {
              await observePgRange(state, tables, 'text')
              const expired = (
                await state.client.query(
                  'SELECT key FROM ' +
                    tables.text +
                    ' WHERE org_id=$1 AND expires_at<=clock_timestamp()',
                  [runtime.orgId],
                  state.ctx
                )
              ).rows
              for (const row of expired) await prunePg(state, tables, 'text', pgTextKey(row.key))
              const rows = (
                await state.client.query(
                  'SELECT key FROM ' + tables.text + ' WHERE org_id=$1 ORDER BY key',
                  [runtime.orgId],
                  state.ctx
                )
              ).rows
              return rows
                .map((row) => pgTextKey(row.key))
                .filter((key): key is string => typeof key === 'string')
            }
          ),
        clearValues: (ctx?: ITransactionOptions) =>
          root(
            PgOperation.clearValues,
            ctx,
            () => ({}),
            (state) => clearPg(state, tables, 'text')
          ),
        clearAll: (ctx?: ITransactionOptions) =>
          root(
            PgOperation.clearAll,
            ctx,
            () => ({}),
            async (state) => {
              for (const channel of ['text', 'bytes', 'record'] as const)
                await clearPg(state, tables, channel)
            }
          ),
        getBytes: (key: string, ctx?: IOperationContext) =>
          root(
            PgOperation.getBytes,
            ctx,
            () => textKey(key),
            (state, input) => readPg(state, tables, 'bytes', input) as Promise<Uint8Array | null>
          ),
        setBytes: (key: string, value: Uint8Array, ctx?: IWriteOptions) =>
          root(
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
                tables,
                'bytes',
                input.key,
                input.value,
                readTransactionConflictPolicy(state.ctx, PgNames.backend)
              ),
            (input) => pointLocks(input.key)
          ),
        removeBytes: (key: string, ctx?: ITransactionOptions) =>
          root(
            PgOperation.removeBytes,
            ctx,
            () => textKey(key),
            async (state, input) => {
              await removePg(state, tables, 'bytes', input)
            },
            (input) => pointLocks(input)
          ),
        clearBytes: (ctx?: ITransactionOptions) =>
          root(
            PgOperation.clearBytes,
            ctx,
            () => ({}),
            (state) => clearPg(state, tables, 'bytes')
          ),
        getRecord: (key: IStorageKey, ctx?: IOperationContext) =>
          root(
            PgOperation.getRecord,
            ctx,
            () => snapshotStorageKey(key, PgNames.backend),
            (state, input) => readPg(state, tables, 'record', input) as Promise<T | undefined>
          ),
        putRecord: (value: T, key?: IStorageKey, ctx?: IWriteOptions) =>
          root(
            PgOperation.putRecord,
            ctx,
            () => ({
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
                tables,
                'record',
                actual,
                input.value,
                readTransactionConflictPolicy(state.ctx, PgNames.backend)
              )
              return actual
            },
            (input) => pointLocks(input.key)
          ),
        deleteRecord: (key: IStorageKey, ctx?: ITransactionOptions) =>
          root(
            PgOperation.deleteRecord,
            ctx,
            () => snapshotStorageKey(key, PgNames.backend),
            async (state, input) => {
              await removePg(state, tables, 'record', input)
            },
            (input) => pointLocks(input)
          ),
        clearRecords: (ctx?: ITransactionOptions) =>
          root(
            PgOperation.clearRecords,
            ctx,
            () => ({}),
            (state) => clearPg(state, tables, 'record')
          ),
        metadata: {
          get: (key: string, ctx?: IOperationContext) =>
            root(
              PgOperation.metadataGet,
              ctx,
              () => textKey(key),
              (state, input) => readPg(state, tables, 'metadata', input)
            ),
          set: (key: string, value: unknown, ctx?: IWriteOptions) =>
            root(
              PgOperation.metadataSet,
              ctx,
              () => ({ key: textKey(key), value: decodePgRecord(encodePgRecord(value)) }),
              (state, input) =>
                writePg(state, tables, 'metadata', input.key, input.value, 'replace')
            ),
          delete: (key: string, ctx?: IOperationContext) =>
            root(
              PgOperation.metadataDelete,
              ctx,
              () => textKey(key),
              async (state, input) => {
                await removePg(state, tables, 'metadata', input)
              }
            )
        },
        iterateRecords: (range?: IKeyRange, ctx?: IOperationContext) => iterator(range, ctx),
        transaction: <R>(
          run: (scope: IPostgresTransactionScope<T>) => R,
          options?: ITransactionOptions
        ) => engine.run(run, options, PgOperation.transaction),
        tx: () => createTransactionBuilder(store, undefined, core.getChainMethods('tx')),
        inspectLocks: (ctx?: IOperationContext) => {
          controller.assertLive()
          return runtime.execution.run(
            { operation: PgOperation.inspectLocks, input: {}, ctx },
            () => inspectPgLocks(configuration, tables, runtime.orgId, controller.origin)
          )
        },
        getMany: (keys: readonly IStorageKey[], ctx?: IOperationContext) =>
          root(
            PgOperation.getMany,
            ctx,
            () => snapshotStorageBatchKeys(keys, PgNames.backend),
            (state, input) => getManyPg(state, tables, input),
            undefined,
            false,
            { when: (input) => input.length === 0, value: [] }
          ),
        setMany: (entries: Parameters<IKeyValueApi['setMany']>[0], ctx?: ITransactionOptions) =>
          root(
            PgOperation.setMany,
            ctx,
            () => textEntries(entries),
            (state, input) => setManyPg(state, tables, input),
            (input) => input.flatMap((entry) => pointLocks(entry.key)),
            false,
            { when: (input) => input.length === 0, value: undefined }
          ),
        removeMany: (keys: readonly IStorageKey[], ctx?: ITransactionOptions) =>
          root(
            PgOperation.removeMany,
            ctx,
            () => snapshotStorageBatchKeys(keys, PgNames.backend),
            (state, input) => removeManyPg(state, tables, input),
            (input) => input.flatMap((entry) => pointLocks(entry.key)),
            false,
            { when: (input) => input.length === 0, value: 0 }
          ),
        removeByPrefix: (prefix: IStorageKey, ctx?: ITransactionOptions) =>
          root(
            PgOperation.removeByPrefix,
            ctx,
            () => snapshotStorageKey(prefix, PgNames.backend),
            (state, input) => removePrefixPg(state, tables, 'text', input)
          ),
        dispose: () => controller.dispose(),
        [asyncDisposeKey]: () =>
          (symbolic ??= controller.dispose().catch((cause) => reportCleanupError(report, cause))),
        ...executor(),
        ...(configuration.server === 'postgres'
          ? {
              subscribeChanges: (listener: (change: IStorageChange) => void) => {
                controller.assertLive()
                return controller.subscribe((change) => {
                  if (change.orgId === runtime.orgId) return listener(change)
                })
              },
              watch: (key: string, ctx?: IOperationContext) =>
                createBackendChangeIterator(controller, {
                  orgId: runtime.orgId,
                  channel: 'value',
                  key,
                  ctx,
                  execute: (advance, context) =>
                    runtime.execution.run(
                      { operation: PgOperation.watch, input: { key }, ctx: context },
                      advance
                    )
                })
            }
          : {})
      }
      const ttlApi: ITtlApi = {
        expire: (target, ms, ctx) =>
          root(
            PgOperation.ttlExpire,
            ctx,
            () => {
              const captured = ttlTarget(target)
              assertStorageTtlDuration(ms, PgNames.backend)
              return { target: captured, ms }
            },
            async (state, input) => (await deadline(state, input.target, input.ms)) as boolean
          ),
        remaining: (target, ctx) =>
          root(
            PgOperation.ttlRemaining,
            ctx,
            () => ttlTarget(target),
            async (state, input) => (await deadline(state, input)) as number | undefined
          ),
        persist: (target, ctx) =>
          root(
            PgOperation.ttlPersist,
            ctx,
            () => ttlTarget(target),
            async (state, input) => (await deadline(state, input, undefined, true)) as boolean
          )
      }
      const counterApi: ICounterApi = {
        increment: (key, by, ctx) =>
          root(
            PgOperation.counterIncrement,
            ctx,
            () => ({
              key: textKey(key),
              increment: snapshotStorageCounterIncrement(by, PgNames.backend)
            }),
            async (state, input) => {
              await state.guardKeys([
                pgLockKey('text', input.key),
                pgLockKey('bytes', input.key),
                pgLockKey('record', input.key)
              ])
              const result = input.increment(
                (await readPg(state, tables, 'text', input.key)) as string | null
              )
              await writePg(state, tables, 'text', input.key, String(result), 'conflict')
              return result
            },
            (input) => pointLocks(input.key)
          )
      }
      const recordsApi: IRecordsApi<T> = {
        query: <R = T>() => createRecordQuery<R>(querySource(), core.getChainMethods('query')),
        removeByPrefix: (prefix, ctx) =>
          root(
            PgOperation.removeByPrefix,
            ctx,
            () => snapshotStorageKey(prefix, PgNames.backend),
            (state, input) => removePrefixPg(state, tables, 'record', input)
          )
      }
      /** Each organization constructs its own native vector API from the immutable child context. */
      const createVectorApi = () => {
        controller.assertLive()
        if (configuration.server === 'cockroach')
          throw new StorageContractError(StorageContractErrorCode.unsupported, {
            backend: PgNames.backend
          })
        vectors ??= createPgVectors({
          configuration,
          tables,
          defaultOrgId: core.defaultOrgId,
          orgId: runtime.orgId,
          assertLive: () => controller.assertLive(),
          run: (operation, ctx, work) =>
            root(
              operation,
              ctx,
              () => ({}),
              (state) => work(state)
            ),
          methods: () => core.getChainMethods('vector'),
          watch: (ctx) =>
            createBackendChangeIterator(controller, {
              orgId: runtime.orgId,
              channel: 'all',
              ctx,
              execute: (advance, context) =>
                runtime.execution.run(
                  { operation: PgOperation.watch, input: {}, ctx: context },
                  advance
                )
            })
        })
        return vectors.standard
      }
      /** The selected peer and native route remain under the original capability/operation owners. */
      const createDurableApi = () => {
        controller.assertLive()
        const selection = replicationSelected()
        if (configuration.server !== 'postgres' || selection === undefined)
          throw new StorageContractError(StorageContractErrorCode.unsupported, {
            backend: PgNames.backend
          })
        durableApi ??= createPgDurableApi({
          driver: configuration.driver,
          route: {
            schema: configuration.schema,
            prefix: configuration.prefix,
            ...(orgView ? { orgId: runtime.orgId } : {})
          },
          selection,
          execute: async (operation, ctx, run) => {
            controller.assertLive()
            const release = controller.beginMutation()
            try {
              return await runtime.execution.run({ operation, input: {}, ctx }, () =>
                observed(operation, undefined, run)
              )
            } finally {
              release()
            }
          }
        })
        return durableApi
      }
      store = provideCapabilities(
        base,
        [
          implement(kv, base, { forTransaction: (scope) => scope }),
          implement(records, recordsApi, {
            forTransaction: (scope) => (scope as IPgScope<T>)[recordsScope]
          }),
          implement(ttl, ttlApi, { forTransaction: (scope) => (scope as IPgScope<T>)[ttlScope] }),
          implement(counter, counterApi, {
            forTransaction: (scope) => (scope as IPgScope<T>)[counterScope]
          }),
          implement(
            sql,
            { sql: base.sql },
            { forTransaction: (scope) => ({ sql: (scope as IPgScope<T>).sql }) }
          )
        ] as const,
        {
          onInstaller: (value) => {
            installer = value
          }
        }
      ) as IPostgresStore<IPgServer, T>
      engine = createPgTransactions({
        states,
        store,
        configuration,
        tables,
        runtime,
        controller,
        createScope,
        publish: (state) => changes!.publish(state),
        beforeCommit: (state) => changes!.beforeCommit(state),
        onIsolation: (isolationLevel) =>
          core.emit('onCapabilityProbe', () => ({
            backend: PgNames.backend,
            backendId: core.getBackendId(),
            orgId: runtime.orgId,
            version: probe.version,
            isolationLevel,
            capabilities: store.capabilities
          }))
      })
      if (orgView && vectorSelected()) {
        vectorPublication = installer!.prepare([implement(vector, createVectorApi())])
        vectorPublication.publish()
      }
      if (orgView && replicationSelected() !== undefined) {
        durablePublication = installer!.prepare([implement(durableChangeFeed, createDurableApi())])
        durablePublication.publish()
      }
      return {
        store,
        installer: installer!,
        controller,
        createVectorApi,
        createDurableApi,
        reportReplication: (maxSlotWalKeepSize) =>
          core.emit('onCapabilityProbe', () => ({
            backend: PgNames.backend,
            backendId: core.getBackendId(),
            orgId: runtime.orgId,
            version: probe.version,
            isolationLevel: probe.isolationLevel,
            capabilities: store.capabilities,
            maxSlotWalKeepSize
          })),
        releaseOrgCapabilities: () => {
          vectorPublication?.release()
          durablePublication?.release()
        },
        runNative: (scope, operation, ctx, run) =>
          scope === undefined
            ? root(
                operation,
                ctx,
                () => ({}),
                (state) => {
                  if (orgView)
                    throw new StorageContractError(StorageContractErrorCode.unsupported, {
                      backend: PgNames.backend
                    })
                  return run(state.client, state.ctx)
                },
                undefined,
                true
              )
            : runTransactionOperation(scope as IPgScope<T>, (current) => {
                const state = engine.stateFor(current)
                return observed(operation, current, () => {
                  if (orgView)
                    throw new StorageContractError(StorageContractErrorCode.unsupported, {
                      backend: PgNames.backend
                    })
                  return run(state.client, state.ctx)
                })
              }),
        getTransactionClient: (scope) => {
          const binding = states.get(scope)
          assertTransactionOwner(binding?.store ?? store, scope)
          return binding!.state.client
        },
        assertNativeRoot: (value) => {
          if (!orgView && value === store) return
          const binding = states.get(value)
          if (binding !== undefined) {
            assertTransactionOwner(binding.store, value)
            if (!orgView && binding.store === store) return
          }
          throw new StorageContractError(StorageContractErrorCode.unsupported, {
            backend: PgNames.backend
          })
        }
      }
    }
    const root = bind(core.getOrgContext(core.defaultOrgId), false)
    core.emit('onCapabilityProbe', () => ({
      backend: PgNames.backend,
      backendId: core.getBackendId(),
      orgId: core.defaultOrgId,
      version: probe.version,
      isolationLevel: probe.isolationLevel,
      capabilities: root.store.capabilities
    }))
    /** Native organization objects share the physical lifetime without organization DDL. */
    const organizations = new Map<string, ReturnType<typeof bind>>()
    releaseOrganizations = () => {
      for (const organization of organizations.values()) organization.releaseOrgCapabilities()
      organizations.clear()
    }
    const orgBinding: IStorageOrgBinding = {
      backend: (orgId) => {
        controller.assertLive()
        let current = organizations.get(orgId)
        if (current === undefined) {
          current = bind(core.getOrgContext(orgId), true)
          organizations.set(orgId, current)
        }
        return current.store
      },
      drop: async (orgId) => {
        const client = await configuration.driver.connect()
        try {
          await client.query('BEGIN', [])
          for (const table of Object.values(tables))
            await client.query('DELETE FROM ' + table + ' WHERE org_id=$1', [orgId])
          await client.query('COMMIT', [])
        } catch (cause) {
          try {
            await client.query('ROLLBACK', [])
          } catch (secondary) {
            throw normalizePostgresError(
              new AggregateError([cause, secondary], PostgresErrorText.sqlFailed)
            )
          }
          throw cause
        } finally {
          await client.dispose()
        }
      }
    }
    return { ...root, configuration, tables, orgBinding }
  } catch (cause) {
    try {
      await controller.dispose()
    } catch (secondary) {
      throw normalizePostgresError(
        new AggregateError([cause, secondary], PostgresErrorText.sqlFailed)
      )
    }
    throw cause
  }
}
