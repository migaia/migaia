import { createBackendChangeIterator } from '@migaia/storage-host/authoring/change-iterator'
import { createBackendChangeController } from '@migaia/storage-host/authoring/change-controller'
import type { IPgQuantizedOptions } from './features/quantized.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  readTransactionConflictPolicy,
  implement,
  kv,
  records,
  ttl,
  counter,
  sql,
  vector,
  durableChangeFeed,
  assertStorageTtlDuration,
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
import {
  snapshotStorageKey,
  snapshotStorageBatchKeys,
  createStorageBatchKeyCapture
} from '@migaia/storage-host/authoring/key'
import {
  runTransactionOperation,
  assertTransactionOwner,
  useTransactionCapability,
  createTransactionBuilder
} from '@migaia/storage-host/authoring/transaction'
import { runWithConcurrency } from '@migaia/storage-host/authoring/concurrency'
import { createStorageIteratorLifetime } from '@migaia/storage-host/authoring/resource'
import { createSqlTag } from '@migaia/storage-host/authoring/sql'
import { createRecordQuery } from '@migaia/storage-host/authoring/query'
import { provideCapabilities } from '@migaia/storage-host/authoring/capability'
import { snapshotStorageTtlTarget } from '@migaia/storage-host/authoring/ttl'
import { snapshotStorageCounterIncrement } from '@migaia/storage-host/authoring/counter'
import type {
  IStoragePluginCore,
  IStorageBackendOrgContext,
  IStorageOrgBinding,
  IStorageJournalBackendBinding
} from '@migaia/storage-host'
import {
  asyncDisposeKey,
  snapshotKeyRange,
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
import { createPgJournalImages, createPgJournalBinding } from './journal.js'
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
import { invalidArgument, normalizePostgresError } from './errors.js'
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
  readonly journalBinding: IStorageJournalBackendBinding
  readonly runNative: IPgNativeOperation
  createVectorApi(): import('@migaia/storage-contract').IVectorApi<true>
  createDurableApi(): import('@migaia/storage-contract').IDurableChangeFeedApi
  dropVectorOrg(client: IPgConnection, orgId: string): Promise<void>
  reportReplication(facts: import('./types.js').IPgReplicationHealth): void
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
/** Capture batch membership and scalar entries before awaited native admission can observe mutation. */
function textEntries(entries: Parameters<IKeyValueApi['setMany']>[0]) {
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
  return result
}
/** A TTL target may reach vector only after the selected Feature supplies its original table port. */
/** Shared physical PostgreSQL resources; organization modules only borrow this owner. */
type IPgStoreEnvironment = {
  readonly configuration: IPgConfiguration
  readonly core: IStoragePluginCore
  readonly probe: Awaited<ReturnType<typeof probePostgres>>
  readonly tables: IPgTables
  readonly report: ReturnType<typeof createStorageOperationReporter>
  readonly states: WeakMap<object, { readonly store: IStorageStore; readonly state: IPgState }>
  readonly controller: IBackendChangeController
  readonly changes: Awaited<ReturnType<typeof createPgChanges>> | undefined
  readonly vectorSelected: () => boolean
  readonly replicationSelected: () => IPgReplicationSelection | undefined
  readonly quantizedSelected: () => IPgQuantizedOptions['mode'] | undefined
}
/** Fixed organization state is passed explicitly to SQL, record, vector and transaction jobs. */
type IPgOrganizationContext<T> = {
  readonly environment: IPgStoreEnvironment
  readonly runtime: IStorageBackendOrgContext
  readonly orgView: boolean
  /** The public organization view keeps capability and operation identity stable. */
  store: IPostgresStore<IPgServer, T>
  /** Capabilities are installed on this exact organization view. */
  installer: ICapabilityInstallPort | undefined
  /** The canonical transaction adapter owns every authentic scope for this organization. */
  engine: ReturnType<typeof createPgTransactions<IPgScope<T>>>
  /** Symbolic disposal returns one report-only settlement promise. */
  symbolic: Promise<void> | undefined
  /** A selected organization lazily creates one native vector owner. */
  vectors: ReturnType<typeof createPgVectors> | undefined
  /** The organization releases its original vector publication at disposal. */
  vectorPublication: ICapabilityPublication | undefined
  /** The organization releases its original feed publication at disposal. */
  durablePublication: ICapabilityPublication | undefined
  /** A selected organization lazily creates one durable feed view. */
  durableApi: import('@migaia/storage-contract').IDurableChangeFeedApi | undefined
  /** The public operation table delegates native work through this organization context. */
  base: ReturnType<typeof createPgOrgBase<T>>
  /** TTL operations share the native revision and deadline owner. */
  ttlApi: ITtlApi
  /** Counters share native transaction admission and conflict policy. */
  counterApi: ICounterApi
  /** Record query construction reuses the canonical query runtime. */
  recordsApi: IRecordsApi<T>
  /** Image encoding and capture share this organization native layout. */
  journalImages: ReturnType<typeof createPgJournalImages>
  /** The private journal binding borrows only authentic organization scopes. */
  journal: ReturnType<typeof createPgJournalBinding>
}

/** Detach a caller target because TTL pruning and guarded writes await native I/O. */
function pgOrgTtlTarget<T>(organization: IPgOrganizationContext<T>, input: ITtlTarget): ITtlTarget {
  /** The target key must stay stable while pruning, locking and applying the deadline await. */
  const target = snapshotStorageTtlTarget(input, PgNames.backend)
  if (target.channel === 'vector' && !organization.environment.vectorSelected())
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
  if (target.channel === 'vector') createPgOrgVectorApi(organization)
  return target
}

/** Organization construction uses the explicit PostgreSQL organization context. */
function pgOrgOperationStages<T>(organization: IPgOrganizationContext<T>) {
  return organization.runtime.stageBindings.operationStages(organization.store)
}

/** Observation encloses actual settlement; report-only hooks cannot alter an operation. */
async function observePgOrgOperation<T, R>(
  organization: IPgOrganizationContext<T>,
  operation: string,
  scope: IPgScope<T> | undefined,
  run: () => R,
  count = 1
): Promise<Awaited<R>> {
  const stages = pgOrgOperationStages(organization)
  const observer = scope === undefined ? stages : stages.forTransaction(scope)
  const transactionObserver =
    scope === undefined
      ? undefined
      : organization.runtime.stageBindings
          .transactionStages(organization.store)
          .forTransaction(scope)
  const started = Date.now()
  if (transactionObserver !== undefined)
    observePg(transactionObserver, 'beforeTxOperation', operation)
  observePg(observer, 'beforeStorageOperation', operation, count)
  try {
    const value = await run()
    if (transactionObserver !== undefined)
      observePg(transactionObserver, 'afterTxOperation', operation)
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

/** Scope admission precedes pipeline stages, codecs and native queries. */
function runPgScopeOperation<T, I, R>(
  organization: IPgOrganizationContext<T>,
  scope: IPgScope<T>,
  operation: string,
  prepare: () => I,
  run: (state: IPgState, current: IPgScope<T>, input: I) => R,
  empty?: { readonly when: (input: I) => boolean; readonly value: NoInfer<Awaited<R>> }
): Promise<Awaited<R>> {
  return runTransactionOperation(scope, (current) => {
    const state = organization.engine.stateFor(current)
    const input = prepare()
    if (empty?.when(input)) return empty.value
    return organization.runtime.execution.run(
      { operation, input, ctx: state.ctx, scope: current, internal: true },
      (actual) => {
        throwIfAborted(state.ctx?.signal)
        return observePgOrgOperation(
          organization,
          operation,
          current,
          () =>
            run(
              {
                ...state,
                codecs: createPgCodecs(
                  organization.runtime.stageBindings
                    .codecStages(organization.store)
                    .forTransaction(current)
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
}

/** Root operations use one original concurrency attempt and the same native data functions. */
async function runPgRootOperation<T, I, R>(
  organization: IPgOrganizationContext<T>,
  operation: string,
  ctx: ITransactionOptions | undefined,
  prepare: () => I,
  run: (state: IPgState, input: I) => R,
  lock?: (input: I) => readonly ILockKey[],
  enveloped = false,
  empty?: { readonly when: (input: I) => boolean; readonly value: NoInfer<Awaited<R>> }
): Promise<Awaited<R>> {
  organization.environment.controller.assertLive()
  let input = prepare()
  if (empty?.when(input)) return empty.value
  const invoke = () =>
    organization.engine.run(
      (scope) =>
        run(
          {
            ...organization.engine.stateFor(scope),
            codecs: createPgCodecs(
              organization.runtime.stageBindings.codecStages(organization.store)
            )
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
          observePgOrgOperation(
            organization,
            operation,
            undefined,
            work,
            Array.isArray(input) ? input.length : 1
          )
      },
      !enveloped
    )
  return enveloped ? observePgOrgOperation(organization, operation, undefined, invoke) : invoke()
}

/**
 * Native SQL compiles lazily only after original operation admission and retains its statement
 * port.
 */
function createPgOrgSql<T>(
  organization: IPgOrganizationContext<T>,
  getScope?: () => IPgScope<T>
): ISqlExecutor {
  const execute = async (
    prepare: () => ICompiledStorageSql,
    ctx: IOperationContext | undefined
  ) => {
    const run = async (state: IPgState, current: IPgScope<T> | undefined) => {
      if (organization.orgView || organization.runtime.journal?.active())
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: PgNames.backend
        })
      const compiled = prepare()
      const observer = organization.runtime.stageBindings.sqlStages(organization.store)
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
      ? runPgScopeOperation(
          organization,
          scope,
          PgOperation.sql,
          () => ({}),
          (state, current) => run(state, current)
        )
      : runPgRootOperation(
          organization,
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

/** One record cursor owns its page position while the canonical lifetime owns admission. */
class PgRecordCursor<T> {
  /** The organization retains transaction admission and native table ownership. */
  readonly #organization: IPgOrganizationContext<T>
  /** Callers may mutate their range while deferred pages are read. */
  readonly #range: IKeyRange | undefined
  /** A root cursor uses the original call context for every page. */
  readonly #ctx: IOperationContext | undefined
  /** Transaction cursors borrow the existing scope rather than opening a new transaction. */
  readonly #scope: IPgScope<T> | undefined
  /** Keyset position advances only after returning a native row. */
  #after: Uint8Array | undefined
  /** One bounded native page remains owned until consumed or closed. */
  #page: readonly { readonly key: IStorageKey; readonly bytes: Uint8Array; readonly value: T }[] =
    []
  /** Index into the current page preserves native key order. */
  #position = 0
  /** Exhaustion and explicit close both prevent another native page read. */
  #ended = false

  /** Snapshot only the deferred range; execution and scope keep their original owners. */
  constructor(
    organization: IPgOrganizationContext<T>,
    range: IKeyRange | undefined,
    ctx: IOperationContext | undefined,
    scope?: IPgScope<T>
  ) {
    this.#organization = organization
    this.#range = snapshotKeyRange(range, PgNames.backend)
    this.#ctx = ctx
    this.#scope = scope
  }

  /** Read a bounded page inside the admitted native transaction and return one decoded row. */
  async #advance(state: IPgState): Promise<IteratorResult<[IStorageKey, T]>> {
    if (this.#ended) return { done: true, value: undefined }
    if (this.#position === this.#page.length) {
      this.#page = await scanPgRecords<T>(
        state,
        this.#organization.environment.tables,
        this.#range,
        this.#after,
        128
      )
      this.#position = 0
      if (this.#page.length === 0) {
        this.#ended = true
        return { done: true, value: undefined }
      }
    }
    const row = this.#page[this.#position++]!
    this.#after = row.bytes
    return { done: false, value: [row.key, row.value] }
  }

  /** Release buffered rows without changing the canonical lifetime's terminal semantics. */
  #close(): void {
    this.#ended = true
    this.#page = []
  }

  /** Register one scoped iterator or expose one root iterator with the existing lifetime. */
  open(): IStorageIterator<[IStorageKey, T]> {
    if (this.#scope)
      return this.#organization.engine.registerIterator(this.#scope, {
        next: (current) =>
          this.#organization.runtime.execution.run(
            {
              operation: PgOperation.next,
              input: { range: this.#range },
              ctx: this.#organization.engine.stateFor(current).ctx,
              scope: current,
              internal: true
            },
            () => this.#advance(this.#organization.engine.stateFor(current))
          ),
        close: () => this.#close()
      })
    const lifetime = createStorageIteratorLifetime<[IStorageKey, T]>({
      close: async () => this.#close(),
      report: this.#organization.environment.report
    })
    return {
      next: () =>
        lifetime.advance(() =>
          runPgRootOperation(
            this.#organization,
            PgOperation.next,
            this.#ctx,
            () => this.#range,
            (state) => this.#advance(state)
          )
        ),
      return: (value) => {
        this.#close()
        return lifetime.returned(value)
      },
      dispose: lifetime.dispose,
      [asyncDisposeKey]: lifetime.symbolic,
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }
}

/** Keyset pages retain bounded native buffers and keep every next in the original transaction. */
function createPgRecordIterator<T>(
  organization: IPgOrganizationContext<T>,
  range: IKeyRange | undefined,
  ctx: IOperationContext | undefined,
  scope?: IPgScope<T>
): IStorageIterator<[IStorageKey, T]> {
  return new PgRecordCursor(organization, range, ctx, scope).open()
}

/** Shared query plans own all client predicates, projections, traversal, reductions and patching. */
function createPgRecordSource<T>(
  organization: IPgOrganizationContext<T>,
  scope?: IPgScope<T>
): IRecordQuerySource {
  return {
    pushdown: {
      operators: [],
      operations: [],
      source: PgNames.backend,
      index: organization.environment.tables.record
    },
    asyncDisposeKey,
    tieBreakByKey: { direction: 'next' },
    cursorSource: organization.store,
    execute: (input) => createPgRecordIterator(organization, undefined, input.ctx, scope),
    mutate: (request, run) => {
      const invoke = (state: IPgState, current: IPgScope<T>) =>
        run({
          execute: (input) => createPgRecordIterator(organization, undefined, input.ctx, current),
          accept: async (key, value) => {
            if (request.operation === 'delete')
              return removePg(state, organization.environment.tables, 'record', key)
            await writePg(state, organization.environment.tables, 'record', key, value, 'conflict')
            return true
          }
        })
      return scope
        ? runPgScopeOperation(
            organization,
            scope,
            request.operation,
            () => ({}),
            (state, current) => invoke(state, current)
          )
        : organization.engine.run(
            (current) => invoke(organization.engine.stateFor(current), current),
            {
              ...request.ctx,
              ...(request.concurrency === undefined ? {} : { concurrency: request.concurrency })
            },
            request.operation
          )
    },
    ...(scope === undefined && organization.environment.configuration.server === 'postgres'
      ? {
          watch: (input) =>
            createBackendChangeIterator(organization.environment.controller, {
              orgId: organization.runtime.orgId,
              channel: 'record',
              ctx: input.ctx,
              execute: (advance, context) =>
                organization.runtime.execution.run(
                  { operation: PgOperation.watch, input: {}, ctx: context },
                  advance
                )
            })
        }
      : {})
  }
}

/** These exact targets are native standard tables; no other channel is guessed or emulated. */
async function pgOrgDeadline<T>(
  organization: IPgOrganizationContext<T>,
  state: IPgState,
  input: ITtlTarget,
  ms?: number,
  persist = false
): Promise<number | boolean | undefined> {
  const target = pgOrgTtlTarget(organization, input)
  if (target.channel === 'vector') return organization.vectors!.deadline(state, target, ms, persist)
  const channel = target.channel
  const key = target.key
  await prunePg(state, organization.environment.tables, channel, key)
  const encoded = channel === 'record' ? pgKey(key).bytes : pgKey(key).hex
  if (ms === undefined && !persist) {
    const row = (
      await state.client.query(
        'SELECT CASE WHEN expires_at IS NULL THEN NULL ELSE GREATEST(0,extract(epoch FROM (expires_at-clock_timestamp()))*1000) END AS remaining FROM ' +
          organization.environment.tables[channel] +
          ' WHERE org_id=$1 AND key=$2',
        [organization.runtime.orgId, encoded],
        state.ctx
      )
    ).rows[0]
    return row?.remaining == null ? undefined : Number(row.remaining)
  }
  await state.guardKeys([target])
  const result = await state.client.query(
    'UPDATE ' +
      organization.environment.tables[channel] +
      ' SET expires_at=' +
      (persist ? 'NULL' : "clock_timestamp()+($3::float8*interval '1 millisecond')") +
      ' WHERE org_id=$1 AND key=$2' +
      (persist ? ' AND expires_at IS NOT NULL' : '') +
      ' RETURNING key' +
      (state.journal === undefined ? '' : ',value,expires_at::text AS deadline'),
    [organization.runtime.orgId, encoded, ...(persist ? [] : [ms!])],
    state.ctx
  )
  if (result.rowCount !== 0) markPgChanged(state, channel, key, result.rows[0])
  return result.rowCount !== 0
}

/** Complete original views are built for the user, every accepted operation and commit checks. */
function createPgOrgScope<T>(
  organization: IPgOrganizationContext<T>,
  _state: IPgState
): IPgScope<T> {
  const scope: IPgScope<T> = {
    use: (capability) => useTransactionCapability(scope, capability),
    get: (key) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.get,
        () => textKey(key),
        (state, _current, input) =>
          readPg(state, organization.environment.tables, 'text', input) as Promise<string | null>
      ),
    set: (key, value, options) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.set,
        () => ({
          key: textKey(key),
          value: textValue(value),
          policy: readTransactionConflictPolicy(options, PgNames.backend)
        }),
        (state, _current, input) =>
          writePg(
            state,
            organization.environment.tables,
            'text',
            input.key,
            input.value,
            input.policy
          )
      ),
    remove: (key) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.remove,
        () => textKey(key),
        async (state, _current, input) => {
          await removePg(state, organization.environment.tables, 'text', input)
        }
      ),
    has: (key) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.has,
        () => textKey(key),
        async (state, _current, input) =>
          (await readPg(state, organization.environment.tables, 'text', input)) !== null
      ),
    getMany: (keys) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.getMany,
        () =>
          /** Batch membership must stay fixed while native locks and revision checks await. */
          snapshotStorageBatchKeys(keys, PgNames.backend),
        (state, _current, input) => getManyPg(state, organization.environment.tables, input),
        { when: (input) => input.length === 0, value: [] }
      ),
    setMany: (entries) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.setMany,
        () => textEntries(entries),
        (state, _current, input) => setManyPg(state, organization.environment.tables, input),
        { when: (input) => input.length === 0, value: undefined }
      ),
    removeMany: (keys) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.removeMany,
        () =>
          /** Batch membership must stay fixed while native locks and revision checks await. */
          snapshotStorageBatchKeys(keys, PgNames.backend),
        (state, _current, input) => removeManyPg(state, organization.environment.tables, input),
        { when: (input) => input.length === 0, value: 0 }
      ),
    removeByPrefix: (prefix) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.removeByPrefix,
        () =>
          /** Prefix bounds must not change between awaited native scan and deletion. */
          snapshotStorageKey(prefix, PgNames.backend),
        (state, _current, input) =>
          removePrefixPg(state, organization.environment.tables, 'text', input)
      ),
    getBytes: (key) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.getBytes,
        () => textKey(key),
        (state, _current, input) =>
          readPg(
            state,
            organization.environment.tables,
            'bytes',
            input
          ) as Promise<Uint8Array | null>
      ),
    setBytes: (key, value, options) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.setBytes,
        () => {
          textKey(key)
          if (!(value instanceof Uint8Array)) throw invalidArgument()
          return {
            key,
            /** Native transaction admission and query queues may await before consuming bytes. */
            value: value.slice(),
            policy: readTransactionConflictPolicy(options, PgNames.backend)
          }
        },
        (state, _current, input) =>
          writePg(
            state,
            organization.environment.tables,
            'bytes',
            input.key,
            input.value,
            input.policy
          )
      ),
    removeBytes: (key) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.removeBytes,
        () => textKey(key),
        async (state, _current, input) => {
          await removePg(state, organization.environment.tables, 'bytes', input)
        }
      ),
    getRecord: (key) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.getRecord,
        () =>
          /** Compound keys must stay fixed through awaited revision and native row operations. */
          snapshotStorageKey(key, PgNames.backend),
        (state, _current, input) =>
          readPg(state, organization.environment.tables, 'record', input) as Promise<T | undefined>
      ),
    putRecord: (value, key, options) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.putRecord,
        () => ({
          /** A supplied compound key must survive awaited native operation admission unchanged. */
          key: key === undefined ? undefined : snapshotStorageKey(key, PgNames.backend),
          value: decodePgRecord<T>(encodePgRecord(value)),
          policy: readTransactionConflictPolicy(options, PgNames.backend)
        }),
        async (state, _current, input) => {
          const key =
            input.key ??
            String(
              (await state.client.query('SELECT gen_random_uuid()::text AS key', [], state.ctx))
                .rows[0]?.key
            )
          await writePg(
            state,
            organization.environment.tables,
            'record',
            key,
            input.value,
            input.policy
          )
          return key
        }
      ),
    deleteRecord: (key) =>
      runPgScopeOperation(
        organization,
        scope,
        PgOperation.deleteRecord,
        () =>
          /** Compound keys must stay fixed through awaited revision and native row operations. */
          snapshotStorageKey(key, PgNames.backend),
        async (state, _current, input) => {
          await removePg(state, organization.environment.tables, 'record', input)
        }
      ),
    iterateRecords: (range) => createPgRecordIterator(organization, range, undefined, scope),
    [ttlScope]: {
      expire: (target, ms) =>
        runPgScopeOperation(
          organization,
          scope,
          PgOperation.ttlExpire,
          () => {
            const captured = pgOrgTtlTarget(organization, target)
            assertStorageTtlDuration(ms, PgNames.backend)
            return { target: captured, ms }
          },
          async (state, _current, input) =>
            (await pgOrgDeadline(organization, state, input.target, input.ms)) as boolean
        ),
      remaining: (target) =>
        runPgScopeOperation(
          organization,
          scope,
          PgOperation.ttlRemaining,
          () => pgOrgTtlTarget(organization, target),
          async (state, _current, input) =>
            (await pgOrgDeadline(organization, state, input)) as number | undefined
        ),
      persist: (target) =>
        runPgScopeOperation(
          organization,
          scope,
          PgOperation.ttlPersist,
          () => pgOrgTtlTarget(organization, target),
          async (state, _current, input) =>
            (await pgOrgDeadline(organization, state, input, undefined, true)) as boolean
        )
    },
    [counterScope]: {
      increment: (key, by) =>
        runPgScopeOperation(
          organization,
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
              (await readPg(state, organization.environment.tables, 'text', input.key)) as
                | string
                | null
            )
            await writePg(
              state,
              organization.environment.tables,
              'text',
              input.key,
              String(result),
              'conflict'
            )
            return result
          }
        )
    },
    [recordsScope]: {
      query: <R = T>() =>
        createRecordQuery<R, undefined>(
          createPgRecordSource(organization, scope),
          organization.environment.core.getChainMethods('query')
        ),
      removeByPrefix: (prefix) =>
        runPgScopeOperation(
          organization,
          scope,
          PgOperation.removeByPrefix,
          () =>
            /** Prefix bounds must not change between awaited native scan and deletion. */
            snapshotStorageKey(prefix, PgNames.backend),
          (state, _current, input) =>
            removePrefixPg(state, organization.environment.tables, 'record', input)
        )
    },
    ...createPgOrgSql(organization, () => scope)
  }
  const api = organization.orgView
    ? organization.runtime.createTransactionApi(scope)
    : organization.environment.core.createTransactionApi(scope)
  if (api !== undefined) Object.defineProperty(scope, 'api', { value: api, enumerable: true })
  return scope
}

/** Flat KV methods and its token reference one exact original native base object. */
function createPgOrgBase<T>(organization: IPgOrganizationContext<T>) {
  return {
    backend: PgNames.backend,
    capabilities: {
      batch: true,
      syncRead: false,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: organization.environment.configuration.server === 'postgres',
      maxValueBytes: undefined,
      opaqueEntries: false
    } as const,
    get: (key: string, ctx?: IOperationContext) =>
      runPgRootOperation(
        organization,
        PgOperation.get,
        ctx,
        () => textKey(key),
        (state, input) =>
          readPg(state, organization.environment.tables, 'text', input) as Promise<string | null>
      ),
    set: (key: string, value: string, ctx?: IWriteOptions) =>
      runPgRootOperation(
        organization,
        PgOperation.set,
        ctx,
        () => ({ key: textKey(key), value: textValue(value) }),
        (state, input) =>
          writePg(
            state,
            organization.environment.tables,
            'text',
            input.key,
            input.value,
            readTransactionConflictPolicy(state.ctx, PgNames.backend)
          ),
        (input) => pointLocks(input.key)
      ),
    remove: (key: string, ctx?: ITransactionOptions) =>
      runPgRootOperation(
        organization,
        PgOperation.remove,
        ctx,
        () => textKey(key),
        async (state, input) => {
          await removePg(state, organization.environment.tables, 'text', input)
        },
        (input) => pointLocks(input)
      ),
    has: (key: string, ctx?: IOperationContext) =>
      runPgRootOperation(
        organization,
        PgOperation.has,
        ctx,
        () => textKey(key),
        async (state, input) =>
          (await readPg(state, organization.environment.tables, 'text', input)) !== null
      ),
    keys: (ctx?: IOperationContext) =>
      runPgRootOperation(
        organization,
        PgOperation.keys,
        ctx,
        () => ({}),
        async (state) => {
          await observePgRange(state, organization.environment.tables, 'text')
          const expired = (
            await state.client.query(
              'SELECT key FROM ' +
                organization.environment.tables.text +
                ' WHERE org_id=$1 AND expires_at<=clock_timestamp()',
              [organization.runtime.orgId],
              state.ctx
            )
          ).rows
          for (const row of expired)
            await prunePg(state, organization.environment.tables, 'text', pgTextKey(row.key))
          const rows = (
            await state.client.query(
              'SELECT key FROM ' +
                organization.environment.tables.text +
                ' WHERE org_id=$1 ORDER BY key',
              [organization.runtime.orgId],
              state.ctx
            )
          ).rows
          return rows
            .map((row) => pgTextKey(row.key))
            .filter((key): key is string => typeof key === 'string')
        }
      ),
    clearValues: (ctx?: ITransactionOptions) =>
      runPgRootOperation(
        organization,
        PgOperation.clearValues,
        ctx,
        () => ({}),
        (state) => clearPg(state, organization.environment.tables, 'text')
      ),
    clearAll: (ctx?: ITransactionOptions) =>
      runPgRootOperation(
        organization,
        PgOperation.clearAll,
        ctx,
        () => ({}),
        async (state) => {
          for (const channel of ['text', 'bytes', 'record'] as const)
            await clearPg(state, organization.environment.tables, channel)
        }
      ),
    getBytes: (key: string, ctx?: IOperationContext) =>
      runPgRootOperation(
        organization,
        PgOperation.getBytes,
        ctx,
        () => textKey(key),
        (state, input) =>
          readPg(
            state,
            organization.environment.tables,
            'bytes',
            input
          ) as Promise<Uint8Array | null>
      ),
    setBytes: (key: string, value: Uint8Array, ctx?: IWriteOptions) =>
      runPgRootOperation(
        organization,
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
            organization.environment.tables,
            'bytes',
            input.key,
            input.value,
            readTransactionConflictPolicy(state.ctx, PgNames.backend)
          ),
        (input) => pointLocks(input.key)
      ),
    removeBytes: (key: string, ctx?: ITransactionOptions) =>
      runPgRootOperation(
        organization,
        PgOperation.removeBytes,
        ctx,
        () => textKey(key),
        async (state, input) => {
          await removePg(state, organization.environment.tables, 'bytes', input)
        },
        (input) => pointLocks(input)
      ),
    clearBytes: (ctx?: ITransactionOptions) =>
      runPgRootOperation(
        organization,
        PgOperation.clearBytes,
        ctx,
        () => ({}),
        (state) => clearPg(state, organization.environment.tables, 'bytes')
      ),
    getRecord: (key: IStorageKey, ctx?: IOperationContext) =>
      runPgRootOperation(
        organization,
        PgOperation.getRecord,
        ctx,
        () =>
          /** Compound keys must stay fixed through awaited revision and native row operations. */
          snapshotStorageKey(key, PgNames.backend),
        (state, input) =>
          readPg(state, organization.environment.tables, 'record', input) as Promise<T | undefined>
      ),
    putRecord: (value: T, key?: IStorageKey, ctx?: IWriteOptions) =>
      runPgRootOperation(
        organization,
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
            organization.environment.tables,
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
      runPgRootOperation(
        organization,
        PgOperation.deleteRecord,
        ctx,
        () =>
          /** Compound keys must stay fixed through awaited revision and native row operations. */
          snapshotStorageKey(key, PgNames.backend),
        async (state, input) => {
          await removePg(state, organization.environment.tables, 'record', input)
        },
        (input) => pointLocks(input)
      ),
    clearRecords: (ctx?: ITransactionOptions) =>
      runPgRootOperation(
        organization,
        PgOperation.clearRecords,
        ctx,
        () => ({}),
        (state) => clearPg(state, organization.environment.tables, 'record')
      ),
    metadata: {
      get: (key: string, ctx?: IOperationContext) =>
        runPgRootOperation(
          organization,
          PgOperation.metadataGet,
          ctx,
          () => textKey(key),
          (state, input) => readPg(state, organization.environment.tables, 'metadata', input)
        ),
      set: (key: string, value: unknown, ctx?: IWriteOptions) =>
        runPgRootOperation(
          organization,
          PgOperation.metadataSet,
          ctx,
          () => ({ key: textKey(key), value: decodePgRecord(encodePgRecord(value)) }),
          (state, input) =>
            writePg(
              state,
              organization.environment.tables,
              'metadata',
              input.key,
              input.value,
              'replace'
            )
        ),
      delete: (key: string, ctx?: IOperationContext) =>
        runPgRootOperation(
          organization,
          PgOperation.metadataDelete,
          ctx,
          () => textKey(key),
          async (state, input) => {
            await removePg(state, organization.environment.tables, 'metadata', input)
          }
        )
    },
    iterateRecords: (range?: IKeyRange, ctx?: IOperationContext) =>
      createPgRecordIterator(organization, range, ctx),
    transaction: <R>(
      run: (scope: IPostgresTransactionScope<T>) => R,
      options?: ITransactionOptions
    ) => organization.engine.run(run, options, PgOperation.transaction),
    tx: () =>
      createTransactionBuilder(
        organization.store,
        undefined,
        organization.environment.core.getChainMethods('tx')
      ),
    /** Only the original bound native store publishes undo through the shared journal owner. */
    ...(organization.runtime.journal === undefined
      ? {}
      : {
          undo: async (txId: string, ctx?: IOperationContext) => {
            organization.environment.controller.assertLive()
            const release = organization.environment.controller.beginMutation()
            return runWithConcurrency<{ readonly txId: string }>(
              {
                store: organization.store,
                options: ctx === undefined ? {} : ctx,
                prepare: () => organization.runtime.journal!.prepare()
              },
              {
                attempt: async (context) => ({
                  status: 'committed',
                  value: await organization.runtime.journal!.undo(txId, (keys, work) =>
                    createTransactionBuilder(
                      organization.store,
                      context,
                      organization.environment.core.getChainMethods('tx')
                    )
                      .lock(keys[0]!, ...keys.slice(1))
                      .run(work)
                  )
                })
              }
            ).finally(release)
          }
        }),
    inspectLocks: (ctx?: IOperationContext) => {
      organization.environment.controller.assertLive()
      return organization.runtime.execution.run(
        { operation: PgOperation.inspectLocks, input: {}, ctx },
        () =>
          inspectPgLocks(
            organization.environment.configuration,
            organization.environment.tables,
            organization.runtime.orgId,
            organization.environment.controller.origin
          )
      )
    },
    getMany: (keys: readonly IStorageKey[], ctx?: IOperationContext) =>
      runPgRootOperation(
        organization,
        PgOperation.getMany,
        ctx,
        () =>
          /** Batch membership must stay fixed while native locks and revision checks await. */
          snapshotStorageBatchKeys(keys, PgNames.backend),
        (state, input) => getManyPg(state, organization.environment.tables, input),
        undefined,
        false,
        { when: (input) => input.length === 0, value: [] }
      ),
    setMany: (entries: Parameters<IKeyValueApi['setMany']>[0], ctx?: ITransactionOptions) =>
      runPgRootOperation(
        organization,
        PgOperation.setMany,
        ctx,
        () => textEntries(entries),
        (state, input) => setManyPg(state, organization.environment.tables, input),
        (input) => input.flatMap((entry) => pointLocks(entry.key)),
        false,
        { when: (input) => input.length === 0, value: undefined }
      ),
    removeMany: (keys: readonly IStorageKey[], ctx?: ITransactionOptions) =>
      runPgRootOperation(
        organization,
        PgOperation.removeMany,
        ctx,
        () =>
          /** Batch membership must stay fixed while native locks and revision checks await. */
          snapshotStorageBatchKeys(keys, PgNames.backend),
        (state, input) => removeManyPg(state, organization.environment.tables, input),
        (input) => input.flatMap((entry) => pointLocks(entry.key)),
        false,
        { when: (input) => input.length === 0, value: 0 }
      ),
    removeByPrefix: (prefix: IStorageKey, ctx?: ITransactionOptions) =>
      runPgRootOperation(
        organization,
        PgOperation.removeByPrefix,
        ctx,
        () =>
          /** Prefix bounds must not change between awaited native scan and deletion. */
          snapshotStorageKey(prefix, PgNames.backend),
        (state, input) => removePrefixPg(state, organization.environment.tables, 'text', input)
      ),
    dispose: () => organization.environment.controller.dispose(),
    [asyncDisposeKey]: () =>
      (organization.symbolic ??= organization.environment.controller
        .dispose()
        .catch((cause) => reportCleanupError(organization.environment.report, cause))),
    ...createPgOrgSql(organization),
    ...(organization.environment.configuration.server === 'postgres'
      ? {
          subscribeChanges: (listener: (change: IStorageChange) => void) => {
            organization.environment.controller.assertLive()
            return organization.environment.controller.subscribe((change) => {
              if (
                change.orgId === organization.runtime.orgId ||
                (change.kind === 'reset' && change.orgId === undefined)
              )
                return listener(change)
            })
          },
          watch: (key: string, ctx?: IOperationContext) =>
            createBackendChangeIterator(organization.environment.controller, {
              orgId: organization.runtime.orgId,
              channel: 'value',
              key,
              ctx,
              execute: (advance, context) =>
                organization.runtime.execution.run(
                  { operation: PgOperation.watch, input: { key }, ctx: context },
                  advance
                )
            })
        }
      : {})
  }
}

/** Organization construction uses the explicit PostgreSQL organization context. */
function createPgOrgTtlApi<T>(organization: IPgOrganizationContext<T>): ITtlApi {
  return {
    expire: (target, ms, ctx) =>
      runPgRootOperation(
        organization,
        PgOperation.ttlExpire,
        ctx,
        () => {
          const captured = pgOrgTtlTarget(organization, target)
          assertStorageTtlDuration(ms, PgNames.backend)
          return { target: captured, ms }
        },
        async (state, input) =>
          (await pgOrgDeadline(organization, state, input.target, input.ms)) as boolean
      ),
    remaining: (target, ctx) =>
      runPgRootOperation(
        organization,
        PgOperation.ttlRemaining,
        ctx,
        () => pgOrgTtlTarget(organization, target),
        async (state, input) =>
          (await pgOrgDeadline(organization, state, input)) as number | undefined
      ),
    persist: (target, ctx) =>
      runPgRootOperation(
        organization,
        PgOperation.ttlPersist,
        ctx,
        () => pgOrgTtlTarget(organization, target),
        async (state, input) =>
          (await pgOrgDeadline(organization, state, input, undefined, true)) as boolean
      )
  }
}

/** Organization construction uses the explicit PostgreSQL organization context. */
function createPgOrgCounterApi<T>(organization: IPgOrganizationContext<T>): ICounterApi {
  return {
    increment: (key, by, ctx) =>
      runPgRootOperation(
        organization,
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
            (await readPg(state, organization.environment.tables, 'text', input.key)) as
              | string
              | null
          )
          await writePg(
            state,
            organization.environment.tables,
            'text',
            input.key,
            String(result),
            'conflict'
          )
          return result
        },
        (input) => pointLocks(input.key)
      )
  }
}

/** Organization construction uses the explicit PostgreSQL organization context. */
function createPgOrgRecordsApi<T>(organization: IPgOrganizationContext<T>): IRecordsApi<T> {
  return {
    query: <R = T>() =>
      createRecordQuery<R>(
        createPgRecordSource(organization),
        organization.environment.core.getChainMethods('query')
      ),
    removeByPrefix: (prefix, ctx) =>
      runPgRootOperation(
        organization,
        PgOperation.removeByPrefix,
        ctx,
        () =>
          /** Prefix bounds must not change between awaited native scan and deletion. */
          snapshotStorageKey(prefix, PgNames.backend),
        (state, input) => removePrefixPg(state, organization.environment.tables, 'record', input)
      )
  }
}

/** Historical managed data remains owned here even when its Feature is not selected. */
function pgOrgVectors<T>(organization: IPgOrganizationContext<T>) {
  organization.vectors ??= createPgVectors({
    configuration: organization.environment.configuration,
    tables: organization.environment.tables,
    quantization: organization.environment.quantizedSelected(),
    orgId: organization.runtime.orgId,
    assertLive: () => organization.environment.controller.assertLive(),
    beginOperation: () => organization.environment.controller.beginMutation(),
    run: (operation, ctx, work) =>
      runPgRootOperation(
        organization,
        operation,
        ctx,
        () => ({}),
        (state) => work(state)
      ),
    methods: () => organization.environment.core.getChainMethods('vector'),
    watch: (ctx) =>
      createBackendChangeIterator(organization.environment.controller, {
        orgId: organization.runtime.orgId,
        channel: 'all',
        ctx,
        execute: (advance, context) =>
          organization.runtime.execution.run(
            { operation: PgOperation.watch, input: {}, ctx: context },
            advance
          )
      })
  })
  return organization.vectors
}

/** Each selected organization publishes only its immutable child context's actual API. */
function createPgOrgVectorApi<T>(organization: IPgOrganizationContext<T>) {
  organization.environment.controller.assertLive()
  if (organization.environment.configuration.server === 'cockroach')
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
  return pgOrgVectors(organization).standard
}

/** The selected peer and native route remain under the original capability/operation owners. */
function createPgOrgDurableApi<T>(organization: IPgOrganizationContext<T>) {
  organization.environment.controller.assertLive()
  const selection = organization.environment.replicationSelected()
  if (organization.environment.configuration.server !== 'postgres' || selection === undefined)
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
  organization.durableApi ??= createPgDurableApi({
    driver: organization.environment.configuration.driver,
    route: {
      schema: organization.environment.configuration.schema,
      prefix: organization.environment.configuration.prefix,
      ...(organization.orgView ? { orgId: organization.runtime.orgId } : {})
    },
    selection,
    execute: async (operation, ctx, run) => {
      organization.environment.controller.assertLive()
      const release = organization.environment.controller.beginMutation()
      try {
        return await organization.runtime.execution.run({ operation, input: {}, ctx }, () =>
          observePgOrgOperation(organization, operation, undefined, run)
        )
      } finally {
        release()
      }
    }
  })
  return organization.durableApi
}

/** Organization construction uses the explicit PostgreSQL organization context. */
function createPgOrgJournalImages<T>(organization: IPgOrganizationContext<T>) {
  return createPgJournalImages(organization.environment.tables, () => {
    if (!organization.environment.vectorSelected()) return undefined
    createPgOrgVectorApi(organization)
    return organization.vectors!.journal
  })
}

/** Root and explicit-default views share only the same authenticated fixed-org native facts. */
function pgOrgJournalState<T>(organization: IPgOrganizationContext<T>, scope: object) {
  const binding = organization.environment.states.get(scope)
  assertTransactionOwner(binding?.store ?? organization.store, scope)
  if (binding === undefined || binding.state.orgId !== organization.runtime.orgId)
    throw invalidArgument()
  return binding.state
}

/** Organization construction uses the explicit PostgreSQL organization context. */
function createPgOrgJournal<T>(organization: IPgOrganizationContext<T>) {
  return createPgJournalBinding({
    orgId: organization.runtime.orgId,
    tables: organization.environment.tables,
    configuration: organization.environment.configuration,
    controller: organization.environment.controller,
    stateFor: (scope: object) => pgOrgJournalState(organization, scope),
    infoFor: (scope) => {
      pgOrgJournalState(organization, scope)
      return assertTransactionOwner(organization.environment.states.get(scope)!.store, scope)
    },
    images: organization.journalImages,
    transaction: (work) =>
      organization.engine.run(work, undefined, 'journal', undefined, false, false)
  })
}

/** Report native WAL facts through existing nonfatal diagnostics and capability observation. */
function reportPgReplication<T>(
  organization: IPgOrganizationContext<T>,
  facts: import('./types.js').IPgReplicationHealth
): void {
  if (facts.maxSlotWalKeepSize === '-1')
    reportCleanupError(organization.environment.report, PostgresErrorText.unlimitedSlotWal)
  organization.environment.core.emit('onCapabilityProbe', () => ({
    backend: PgNames.backend,
    backendId: organization.environment.core.getBackendId(),
    orgId: organization.runtime.orgId,
    version: organization.environment.probe.version,
    isolationLevel: organization.environment.probe.isolationLevel,
    capabilities: organization.store.capabilities,
    ...facts
  }))
}
/** Borrow native execution only for the root route and outside an active journal. */
function runPgNative<T, R>(
  organization: IPgOrganizationContext<T>,
  scope: IPostgresTransactionScope | undefined,
  operation: string,
  ctx: IOperationContext | undefined,
  run: (client: IPgConnection, ctx: IOperationContext | undefined) => Promise<R>
): Promise<R> {
  return scope === undefined
    ? runPgRootOperation(
        organization,
        operation,
        ctx,
        () => ({}),
        (state) => {
          if (organization.orgView || organization.runtime.journal?.active())
            throw new StorageContractError(StorageContractErrorCode.unsupported, {
              backend: PgNames.backend
            })
          return run(state.client, state.ctx)
        },
        undefined,
        true
      )
    : runTransactionOperation(scope as IPgScope<T>, (current) => {
        const state = organization.engine.stateFor(current)
        return observePgOrgOperation(organization, operation, current, () => {
          if (organization.orgView || organization.runtime.journal?.active())
            throw new StorageContractError(StorageContractErrorCode.unsupported, {
              backend: PgNames.backend
            })
          return run(state.client, state.ctx)
        })
      })
}
/** Authenticate the original root store or one of its authentic native scopes. */
function assertPgNativeRoot<T>(organization: IPgOrganizationContext<T>, value: object): void {
  if (!organization.orgView && value === organization.store) return
  const binding = organization.environment.states.get(value)
  if (binding !== undefined) {
    assertTransactionOwner(binding.store, value)
    if (!organization.orgView && binding.store === organization.store) return
  }
  throw new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: PgNames.backend
  })
}

/** Assemble one fixed organization from named jobs without sharing lexical mutable state. */
function createPgOrganization<T>(
  environment: IPgStoreEnvironment,
  runtime: IStorageBackendOrgContext,
  orgView: boolean
): Omit<IPostgresConstruction<T>, 'configuration' | 'tables' | 'orgBinding' | 'journalBinding'> & {
  readonly journal: Omit<IStorageJournalBackendBinding, 'forOrg'>
} {
  const organization: IPgOrganizationContext<T> = {
    environment,
    runtime,
    orgView,
    store: undefined!,
    installer: undefined!,
    engine: undefined!,
    symbolic: undefined!,
    vectors: undefined!,
    vectorPublication: undefined!,
    durablePublication: undefined!,
    durableApi: undefined!,
    base: undefined!,
    ttlApi: undefined!,
    counterApi: undefined!,
    recordsApi: undefined!,
    journalImages: undefined!,
    journal: undefined!
  }
  organization.base = createPgOrgBase(organization)
  organization.ttlApi = createPgOrgTtlApi(organization)
  organization.counterApi = createPgOrgCounterApi(organization)
  organization.recordsApi = createPgOrgRecordsApi(organization)
  organization.journalImages = createPgOrgJournalImages(organization)
  organization.store = provideCapabilities(
    organization.base,
    [
      implement(kv, organization.base, { forTransaction: (scope) => scope }),
      implement(records, organization.recordsApi, {
        forTransaction: (scope) => (scope as IPgScope<T>)[recordsScope]
      }),
      implement(ttl, organization.ttlApi, {
        forTransaction: (scope) => (scope as IPgScope<T>)[ttlScope]
      }),
      implement(counter, organization.counterApi, {
        forTransaction: (scope) => (scope as IPgScope<T>)[counterScope]
      }),
      implement(
        sql,
        { sql: organization.base.sql },
        { forTransaction: (scope) => ({ sql: (scope as IPgScope<T>).sql }) }
      )
    ] as const,
    {
      onInstaller: (value) => {
        organization.installer = value
      }
    }
  ) as IPostgresStore<IPgServer, T>
  organization.engine = createPgTransactions({
    states: organization.environment.states,
    store: organization.store,
    configuration: organization.environment.configuration,
    tables: organization.environment.tables,
    runtime: organization.runtime,
    controller: organization.environment.controller,
    createScope: (_state: IPgState) => createPgOrgScope(organization, _state),
    publish: (state) => organization.environment.changes!.publish(state),
    journalCapture: (state) => organization.journalImages.capture(state),
    beforeCommit: (state) => organization.environment.changes!.beforeCommit(state),
    onIsolation: (isolationLevel) =>
      organization.environment.core.emit('onCapabilityProbe', () => ({
        backend: PgNames.backend,
        backendId: organization.environment.core.getBackendId(),
        orgId: organization.runtime.orgId,
        version: organization.environment.probe.version,
        isolationLevel,
        capabilities: organization.store.capabilities
      }))
  })
  if (organization.orgView && organization.environment.vectorSelected()) {
    organization.vectorPublication = organization.installer!.prepare([
      implement(vector, createPgOrgVectorApi(organization))
    ])
    organization.vectorPublication.publish()
  }
  if (organization.orgView && organization.environment.replicationSelected() !== undefined) {
    organization.durablePublication = organization.installer!.prepare([
      implement(durableChangeFeed, createPgOrgDurableApi(organization))
    ])
    organization.durablePublication.publish()
  }
  organization.journal = createPgOrgJournal(organization)
  return {
    journal: organization.journal,
    store: organization.store,
    installer: organization.installer!,
    controller: organization.environment.controller,
    createVectorApi: () => createPgOrgVectorApi(organization),
    dropVectorOrg: async (client, orgId) => {
      await pgOrgVectors(organization).dropOrg(client, orgId)
    },
    createDurableApi: () => createPgOrgDurableApi(organization),
    reportReplication: (facts) => reportPgReplication(organization, facts),
    releaseOrgCapabilities: () => {
      organization.vectorPublication?.release()
      organization.durablePublication?.release()
    },
    runNative: (scope, operation, ctx, run) =>
      runPgNative(organization, scope, operation, ctx, run),
    getTransactionClient: (scope) => {
      const binding = organization.environment.states.get(scope)
      assertTransactionOwner(binding?.store ?? organization.store, scope)
      return binding!.state.client
    },
    assertNativeRoot: (value) => assertPgNativeRoot(organization, value)
  }
}

/** One physical owner creates stable organization instances without per-org DDL. */
class PgOrganizationRegistry<T> implements IStorageOrgBinding {
  /** Shared layout, native controller and drivers remain owned by their original backend. */
  readonly #environment: IPgStoreEnvironment
  /** The default route is constructed once and shares the host's original installer. */
  readonly #root: ReturnType<typeof createPgOrganization<T>>
  /** Each immutable organization route retains exactly one provider table and transaction owner. */
  readonly #organizations = new Map<string, ReturnType<typeof createPgOrganization<T>>>()

  /** Construct the default organization after physical installation succeeds. */
  constructor(environment: IPgStoreEnvironment) {
    this.#environment = environment
    this.#root = createPgOrganization<T>(
      environment,
      environment.core.getOrgContext(environment.core.defaultOrgId),
      false
    )
  }
  /** Return the original default construction, preserving provider and resource identity. */
  get root(): ReturnType<typeof createPgOrganization<T>> {
    return this.#root
  }
  /** Resolve one host-authenticated org without registering another physical resource. */
  #organization(orgId: string): ReturnType<typeof createPgOrganization<T>> {
    let current = this.#organizations.get(orgId)
    if (current === undefined) {
      current = createPgOrganization<T>(
        this.#environment,
        this.#environment.core.getOrgContext(orgId),
        true
      )
      this.#organizations.set(orgId, current)
    }
    return current
  }
  /** Borrow the fixed org's store only while the original physical controller is live. */
  backend(orgId: string) {
    this.#environment.controller.assertLive()
    return this.#organization(orgId).store
  }
  /** Delete only the selected org using one original native transaction and vector owner. */
  async drop(orgId: string): Promise<void> {
    const client = await this.#environment.configuration.driver.connect()
    try {
      await client.query('BEGIN', [])
      for (const table of Object.values(this.#environment.tables).filter(
        (table) => table !== this.#environment.tables.vectorConfiguration
      ))
        await client.query('DELETE FROM ' + table + ' WHERE org_id=$1', [orgId])
      await this.#organization(orgId).dropVectorOrg(client, orgId)
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
  /** Every journal route resolves the same original org and never caches another index. */
  journalBinding(orgId: string): IStorageJournalBackendBinding {
    return {
      forOrg: (current) => this.journalBinding(current),
      ...(orgId === this.#environment.core.defaultOrgId
        ? this.#root.journal
        : this.#organization(orgId).journal)
    }
  }
  /** Release child provider publications once the physical controller finishes disposal. */
  dispose(): void {
    for (const organization of this.#organizations.values()) organization.releaseOrgCapabilities()
    this.#organizations.clear()
  }
}

/** Backend construction probes actual facts before native DDL and borrows its injected driver. */
export async function createPostgresStore<T>(
  options: IPostgresOptions<IPgServer>,
  core: IStoragePluginCore,
  vectorSelected: () => boolean,
  replicationSelected: () => IPgReplicationSelection | undefined,
  quantizedSelected: () => IPgQuantizedOptions['mode'] | undefined
): Promise<IPostgresConstruction<T>> {
  /** Installation probes and DDL await; deployment metadata must stay fixed across that work. */
  const configuration = snapshotPostgresOptions(options)
  if (
    quantizedSelected() !== undefined &&
    (!vectorSelected() || configuration.server !== 'postgres')
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: PgNames.backend
    })
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
  }, createBackendChangeController)
  try {
    if (configuration.server === 'postgres' && configuration.driver.listen === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: PgNames.backend
      })
    changes = await createPgChanges(configuration, controller)
    /** The registry owns root and child organization instances under this physical controller. */
    const environment: IPgStoreEnvironment = {
      configuration,
      core,
      probe,
      tables,
      report,
      states,
      controller,
      changes,
      vectorSelected,
      replicationSelected,
      quantizedSelected
    }
    const organizations = new PgOrganizationRegistry<T>(environment)
    const root = organizations.root
    releaseOrganizations = () => organizations.dispose()

    core.emit('onCapabilityProbe', () => ({
      backend: PgNames.backend,
      backendId: core.getBackendId(),
      orgId: core.defaultOrgId,
      version: probe.version,
      isolationLevel: probe.isolationLevel,
      capabilities: root.store.capabilities
    }))

    return {
      ...root,
      configuration,
      tables,
      orgBinding: organizations,
      journalBinding: organizations.journalBinding(core.defaultOrgId)
    }
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
