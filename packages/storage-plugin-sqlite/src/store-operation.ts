// Root operations: admission, synchronous and scoped runs, reads, writes and batches for the SQLite store (see ./store.ts).
import {
  createStorageBatchKeyCapture,
  createStorageBatchKeyProjection,
  runTransactionOperation,
  runWithConcurrency,
  readConcurrencyLockIdentities,
  lockKey,
  throwIfAborted,
  withAbort,
  observeStorageBatch
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  assertStorageTtlDuration,
  readTransactionConflictPolicy,
  type IStorageKey,
  type IStorageBatchKey,
  type IStorageBatchKeyCapture,
  type IKeyValueApi,
  type IOperationContext,
  type IConcurrencyAttemptContext,
  type IConcurrencyAttempt,
  type ILockKey
} from '@migaia/storage-contract'
import type { IStorageJournalExecutionPort } from '@migaia/storage-host'
import { sleep } from '@migaia/utils/promise'
import { SqliteNames, SqliteControl, SqliteLimits, SqliteOperation } from './constants.ts'
import { normalizeSqliteFailure } from './errors.ts'
import { SqliteErrorText } from './error-text.ts'
import type { ISqliteTransactionScope, ISqliteRow } from './types.ts'
import { sqliteConvert, sqliteWriteRaw, sqliteLiveExpiration, sqlitePrune } from './store-io.ts'
import { sqliteObserve, sqliteSyncMutation } from './store-mutation.ts'
import { sqliteAdvanceRevisions, sqlitePublishChanges, sqliteRevision } from './store-revision.ts'
import {
  sqliteAssertRoot,
  sqliteNativeFor,
  sqliteOperationOrg,
  sqliteJournalFor,
  sqliteJournalScope,
  sqliteLocalGroup,
  SqliteLogicalConflict,
  sqliteIsBusy,
  sqliteStatement,
  SQLITE_CONTROL_ACTIVE,
  SqlitePhysicalBusy
} from './store-state.ts'
import type {
  ISqliteOrganizationContext,
  IBatchObservation,
  INativeState,
  IRootMutation,
  ITextBatchEntry
} from './store-state.ts'
import {
  sqliteLockRanges,
  sqliteConflictingLock,
  sqliteRangeConflict,
  sqliteHolderOf,
  sqliteNativeAttempt,
  sqlitePhysicalRun,
  sqliteWalAttempt,
  sqliteRollback
} from './store-transaction.ts'

/** SqliteOperation uses explicit organization state and the original native execution owner. */
function sqliteOperation<TValue, I, R>(
  organization: ISqliteOrganizationContext<TValue>,
  name: string,
  input: I,
  context: IOperationContext | undefined,
  scope: object | undefined,
  run: (captured: I) => R,
  batch?: IBatchObservation
): Promise<Awaited<R>> {
  /** The original owner admits scope work synchronously before pipeline or codec work. */
  const execute = (currentScope?: object): Promise<Awaited<R>> => {
    /** The existing executor remains the sole pipeline owner for either observation form. */
    const invoke = (): Promise<Awaited<R>> =>
      organization.core.execution.run<I, Awaited<R>>(
        { operation: name, input, ctx: context, scope: currentScope, internal: true },
        async (captured): Promise<Awaited<R>> => {
          if (batch) return (await run(captured)) as Awaited<R>
          /** Existing single calls retain their original observer binding point after the stage. */
          const observer = currentScope
            ? organization.operationStages.forTransaction(currentScope)
            : organization.operationStages
          const started = Date.now()
          sqliteObserve(organization, observer, 'beforeStorageOperation', name)
          try {
            const result = await run(captured)
            sqliteObserve(
              organization,
              observer,
              'afterStorageOperation',
              name,
              Date.now() - started,
              1
            )
            return result as Awaited<R>
          } catch (error) {
            sqliteObserve(
              organization,
              observer,
              'onStorageOperationError',
              name,
              (error as { code?: unknown })?.code
            )
            throw error
          }
        }
      )
    return batch
      ? observeStorageBatch(
          currentScope
            ? organization.operationStages.forTransaction(currentScope)
            : organization.operationStages,
          organization.scheduler,
          name,
          batch.count,
          invoke
        )
      : invoke()
  }
  return scope ? runTransactionOperation(scope, (current) => execute(current)) : execute()
}
/** Synchronous calls use the original stage list and cannot wait for async middleware. */
export function sqliteSynchronous<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  name: string,
  input: unknown,
  run: () => R
): R {
  sqliteAssertRoot(organization)
  return organization.core.execution.runSync({ operation: name, input }, () => {
    sqliteObserve(organization, organization.operationStages, 'beforeStorageOperation', name)
    const started = Date.now()
    try {
      const result = run()
      sqliteObserve(
        organization,
        organization.operationStages,
        'afterStorageOperation',
        name,
        Date.now() - started,
        1
      )
      return result
    } catch (error) {
      sqliteObserve(
        organization,
        organization.operationStages,
        'onStorageOperationError',
        name,
        (error as { code?: unknown })?.code
      )
      throw error
    }
  })
}
/** Every transaction data entry receives its actual newly authorized operation view. */
export function sqliteScoped<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  scope: object,
  name: string,
  input: unknown,
  run: (state: INativeState, current: ISqliteTransactionScope<TValue>, input: unknown) => R,
  batch?: IBatchObservation
): Promise<Awaited<R>> {
  return runTransactionOperation(scope, (current) => {
    const state = sqliteNativeFor(organization, current)
    /** Capture inside original admission, before an asynchronous pipeline can wait. */
    const capturedInput = typeof input === 'function' ? input() : input
    /** An empty native batch remains admitted but opens no pipeline, hook, or native request. */
    if (batch?.count === 0)
      return run(state, current as ISqliteTransactionScope<TValue>, capturedInput)
    /** Existing scope admission owns one execution; batches only share its observation wrapper. */
    const execute = () =>
      organization.core.execution.run(
        { operation: name, input: capturedInput, scope: current },
        async (preparedInput) => {
          const observer = organization.operationStages.forTransaction(current)
          const transactionObserver = organization.transactionStages.forTransaction(current)
          sqliteObserve(organization, transactionObserver, 'beforeTxOperation', name)
          if (batch)
            return observeStorageBatch(
              observer,
              organization.scheduler,
              name,
              batch.count,
              async () => {
                const result = await run(
                  state,
                  current as ISqliteTransactionScope<TValue>,
                  preparedInput
                )
                sqliteObserve(organization, transactionObserver, 'afterTxOperation', name)
                return result as Awaited<R>
              }
            )
          sqliteObserve(organization, observer, 'beforeStorageOperation', name)
          const started = Date.now()
          try {
            const result = await run(
              state,
              current as ISqliteTransactionScope<TValue>,
              preparedInput
            )
            sqliteObserve(organization, transactionObserver, 'afterTxOperation', name)
            sqliteObserve(
              organization,
              observer,
              'afterStorageOperation',
              name,
              Date.now() - started,
              1
            )
            return result as Awaited<R>
          } catch (error) {
            sqliteObserve(
              organization,
              observer,
              'onStorageOperationError',
              name,
              (error as { code?: unknown })?.code
            )
            throw error
          }
        }
      )
    return execute()
  })
}
/** String inputs use the existing key owner and the channel's narrow value contract. */
export function sqliteTextInput<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  key: string,
  value?: unknown,
  writing = false
): void {
  assertStringStorageKey(key, SqliteNames.backend)
  if (writing && typeof value !== 'string')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend,
      cause: new TypeError(SqliteErrorText.textValue)
    })
}
/** Binary data is captured before asynchronous stages can retain caller-owned views. */
export function sqliteBytesInput<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  key: string,
  value: Uint8Array
): Uint8Array {
  assertStringStorageKey(key, SqliteNames.backend)
  if (!(value instanceof Uint8Array))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend,
      cause: new TypeError(SqliteErrorText.byteValue)
    })
  return value.slice()
}
/** Root reads own a short lease and never join an active callback's connection. */
export function sqliteRootRead<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  name: string,
  input: unknown,
  ctx: IOperationContext | undefined,
  run: (
    orgId: string,
    input: unknown,
    observeKey?: (key: ILockKey) => void,
    state?: INativeState
  ) => R,
  batch?: IBatchObservation
): Promise<Awaited<R>> {
  organization.controller.assertLive()
  if (
    organization.core.journal !== undefined &&
    name !== SqliteOperation.metadataGet &&
    name !== SqliteOperation.metadataSet &&
    name !== SqliteOperation.metadataDelete &&
    name !== SqliteOperation.sql
  ) {
    /** The original loop starts the one budget before preparation or the existing pipeline. */
    try {
      sqliteAssertRoot(organization)
    } catch (error) {
      return Promise.reject(error)
    }
    return sqliteRootWrite(
      organization,
      name,
      input,
      ctx,
      (captured, context) => {
        sqliteAssertRoot(organization)
        const orgId = sqliteOperationOrg(organization, context)
        return {
          keys: [],
          read: (observeKey) => {
            sqliteAssertRoot(organization)
            return run(orgId, captured, observeKey)
          },
          run: (state) => run(orgId, captured, undefined, state)
        }
      },
      batch
    )
  }
  const finish = organization.controller.beginMutation()
  /** Only the enabled observer retains actual synchronous read facts. */
  let keys: ILockKey[] | undefined
  let capturedInput = input
  const execute = () =>
    withAbort<Awaited<R>>(ctx, async (signal, context): Promise<Awaited<R>> => {
      sqliteAssertRoot(organization)
      throwIfAborted(signal)
      const selectedJournal = sqliteJournalFor(organization, context)
      if (selectedJournal !== undefined) await selectedJournal.prepare()
      return sqliteOperation(
        organization,
        name,
        input,
        context,
        undefined,
        (captured) => {
          sqliteAssertRoot(organization)
          throwIfAborted(signal)
          capturedInput = captured
          return run(
            sqliteOperationOrg(organization, context),
            captured,
            keys === undefined ? undefined : (key) => keys!.push(key)
          )
        },
        batch
      )
    })
  const result =
    organization.core.execution.observe === undefined
      ? execute()
      : organization.core.execution.observe(
          () => ({
            operation: name,
            input: capturedInput,
            keys: () => keys ?? [],
            internal:
              name === SqliteOperation.metadataGet ||
              name === SqliteOperation.metadataSet ||
              name === SqliteOperation.metadataDelete
                ? true
                : undefined
          }),
          (enabled) => {
            if (enabled) keys = []
            return execute()
          }
        )
  return result.finally(finish)
}
/** One root write owns its captured payload and observed attempt facts through canonical retry. */
class SqliteRootWrite<TValue, I, R> {
  /** Native layout and admission stay with the original organization. */
  readonly #organization: ISqliteOrganizationContext<TValue>
  /** Stable operation name identifies the original pipeline and observer events. */
  readonly #name: string
  /** Initial payload remains available until the original pipeline captures actual input. */
  readonly #input: I
  /** Canonical concurrency owns this caller context's one budget and signal. */
  readonly #ctx: IOperationContext | undefined
  /** Terminal preparation chooses exact native keys and work after pipeline transformation. */
  readonly #prepare: (captured: I, context?: IOperationContext) => IRootMutation<R>
  /** Native batch observation retains its original optional input count. */
  readonly #batch: IBatchObservation | undefined
  /** The original pipeline writes its final accepted payload here once per operation. */
  #capturedInput!: I
  /** Prepared native work is rebound only by canonical attempt lock derivation. */
  #mutation!: IRootMutation<R>
  /** The selected original journal port shares preparation, head locks and the native attempt. */
  #selectedJournal: IStorageJournalExecutionPort | undefined
  /** Telemetry allocates native key facts only when the existing observer enables it. */
  #observing = false
  /** Final real native observations remain available to the outer operation observer. */
  #observedKeys: readonly ILockKey[] | undefined
  /** Own callback retains the operation while native attempts report their exact observations. */
  readonly #recordKeys = (state: INativeState): void => {
    this.#observedKeys = [...state.observed!.values()]
  }
  /** Bind operation context without starting another transaction or retry owner. */
  constructor(
    organization: ISqliteOrganizationContext<TValue>,
    name: string,
    input: I,
    ctx: IOperationContext | undefined,
    prepare: (captured: I, context?: IOperationContext) => IRootMutation<R>,
    batch: IBatchObservation | undefined
  ) {
    this.#organization = organization
    this.#name = name
    this.#input = input
    this.#ctx = ctx
    this.#prepare = prepare
    this.#batch = batch
  }
  /** Canonical concurrency alone owns logical attempts, locks and physical waiting. */
  #execute(): Promise<Awaited<R>> {
    return runWithConcurrency<Awaited<R>>(
      {
        store: this.#organization.store,
        options: this.#ctx === undefined ? {} : this.#ctx,
        prepare:
          this.#organization.core.journal === undefined || this.#name === SqliteOperation.dropOrg
            ? undefined
            : (context) => {
                this.#selectedJournal = sqliteJournalFor(this.#organization, context)
                return this.#selectedJournal?.prepare()
              },
        execute: (context, proceed) =>
          sqliteOperation(
            this.#organization,
            this.#name,
            this.#input,
            context,
            undefined,
            (captured) => {
              this.#capturedInput = captured
              return proceed()
            },
            this.#batch
          ),
        lock: (context) => {
          this.#mutation = this.#prepare(this.#capturedInput, context)
          return [...this.#mutation.keys, ...(this.#selectedJournal?.headLocks() ?? [])]
        }
      },
      {
        attempt: (context) => this.#attempt(context)
      }
    )
  }
  /** One explicit native retry loop distinguishes logical range conflicts from physical BUSY. */
  async #attempt(context: IConcurrencyAttemptContext): Promise<IConcurrencyAttempt<Awaited<R>>> {
    const guard = this.#mutation.guard
    const ranges = guard ? sqliteLockRanges(this.#organization, guard) : []
    const ids = readConcurrencyLockIdentities(context)
    /** Logical fail decisions remain observable before entering the physical queue. */
    const conflict = this.#organization.wal
      ? sqliteConflictingLock(this.#organization, context, ids, '')
      : undefined
    const range =
      this.#organization.wal && guard
        ? sqliteRangeConflict(
            this.#organization,
            sqliteOperationOrg(this.#organization, context),
            guard
          )
        : undefined
    if ((conflict || range) && context.admission === 'try')
      return {
        status: 'conflict' as const,
        phase: 'acquire' as const,
        keys: conflict ? [conflict.key] : range!.keys,
        holder: conflict ? sqliteHolderOf(this.#organization, conflict.row) : range!.holder
      }
    while (true) {
      throwIfAborted(context.signal)
      try {
        if (this.#mutation.read !== undefined && !this.#selectedJournal?.active()) {
          const keys: ILockKey[] | undefined = this.#observing ? [] : undefined
          try {
            return {
              status: 'committed' as const,
              value: this.#mutation.read(
                keys === undefined ? undefined : (key) => keys.push(key)
              ) as Awaited<R>
            }
          } finally {
            this.#observedKeys = keys
          }
        }
        const write = () =>
          sqliteSyncMutation(
            this.#organization,
            this.#mutation.run,
            context.lock ?? [],
            guard,
            sqliteOperationOrg(this.#organization, context),
            context,
            this.#mutation.committed,
            this.#observing ? this.#recordKeys : undefined
          ) as Awaited<R>
        if (this.#selectedJournal?.active()) {
          const native = () =>
            sqliteNativeAttempt(
              this.#organization,
              context,
              (scope) => this.#mutation.run(sqliteJournalScope(this.#organization, scope).state),
              true,
              this.#mutation.committed,
              this.#observing ? this.#recordKeys : undefined
            )
          const run = () =>
            sqlitePhysicalRun(this.#organization, context, () =>
              this.#organization.wal
                ? sqliteWalAttempt(this.#organization, context, native)
                : native()
            )
          return this.#organization.wal
            ? await run()
            : await sqliteLocalGroup(
                this.#organization,
                sqliteOperationOrg(this.#organization, context)
              ).locks.attempt(
                context,
                {
                  owner: this.#organization.controller.origin,
                  since: Date.now(),
                  status: 'held',
                  scope: 'local'
                },
                { attempt: run },
                this.#organization.concurrencyStages,
                this.#organization.controller.closingSignal,
                ranges
              )
        }
        return this.#organization.wal
          ? await sqlitePhysicalRun(this.#organization, context, () =>
              sqliteWalAttempt(this.#organization, context, async () => ({
                status: 'committed' as const,
                value: write() as Awaited<R>
              }))
            )
          : await sqliteLocalGroup(
              this.#organization,
              sqliteOperationOrg(this.#organization, context)
            ).locks.attemptWrite(
              context,
              {
                owner: this.#organization.controller.origin,
                ...(this.#organization.label === undefined
                  ? {}
                  : { label: this.#organization.label }),
                since: Date.now(),
                status: 'held',
                scope: 'local'
              },
              write,
              this.#organization.concurrencyStages,
              this.#organization.controller.closingSignal,
              ranges,
              (commit) => sqlitePhysicalRun(this.#organization, context, commit)
            )
      } catch (error) {
        if (error instanceof SqliteLogicalConflict) {
          if (context.admission === 'try')
            return {
              status: 'conflict' as const,
              phase: 'acquire' as const,
              keys: error.keys,
              holder: error.holder
            }
          await context.wait(sleep(SqliteLimits.pollMs, { signal: context.signal }))
        } else if (!(error instanceof AggregateError) && sqliteIsBusy(this.#organization, error))
          await context.waitPhysical(sleep(SqliteLimits.pollMs, { signal: context.signal }))
        else throw error
      }
    }
  }
  /** Keep the original controller lease and returned finally promise. */
  run(): Promise<Awaited<R>> {
    this.#organization.controller.assertLive()
    const finish = this.#organization.controller.beginMutation()
    const result =
      this.#organization.core.execution.observe === undefined
        ? this.#execute()
        : this.#organization.core.execution.observe(
            () => ({
              operation: this.#name,
              input: this.#capturedInput ?? this.#input,
              keys: () => this.#observedKeys ?? []
            }),
            (enabled) => {
              this.#observing = enabled
              return this.#execute()
            }
          )
    return result.finally(finish)
  }
}
/** Root mutations declare affected original channel keys before logical lock acquisition. */
export function sqliteRootWrite<TValue, I, R>(
  organization: ISqliteOrganizationContext<TValue>,
  name: string,
  input: I,
  ctx: IOperationContext | undefined,
  prepare: (captured: I, context?: IOperationContext) => IRootMutation<R>,
  batch?: IBatchObservation
): Promise<Awaited<R>> {
  return new SqliteRootWrite(organization, name, input, ctx, prepare, batch).run()
}

/** Standard channel preparation owns payload conversion before the shared lock provider runs. */
export function sqlitePrepareWrite<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: 'text' | 'bytes' | 'record',
  key: IStorageKey,
  value: unknown
): Omit<IRootMutation<void>, 'read'> {
  const raw =
    channel === 'bytes'
      ? (value as Uint8Array).slice()
      : (sqliteConvert(organization, channel, 'encode', value) as string)
  return {
    keys:
      typeof key === 'string'
        ? [lockKey.text(key), lockKey.bytes(key), lockKey.record(key)]
        : [lockKey.text(key), lockKey.record(key)],
    run: (state) =>
      sqliteWriteRaw(
        organization,
        channel,
        key,
        raw,
        state,
        readTransactionConflictPolicy(state.context, SqliteNames.backend)
      )
  }
}
/** Empty root calls still validate their live resource and supplied context without doing I/O. */
export function sqliteBatchSize<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  input: readonly unknown[]
): number {
  organization.controller.assertLive()
  if (!Array.isArray(input))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend
    })
  return input.length
}
/** Validate native text fields using the canonical key owner's selected capture or projection. */
function sqliteTextBatchEntries(
  entries: Parameters<IKeyValueApi['setMany']>[0],
  capture: IStorageBatchKeyCapture
): readonly ITextBatchEntry[] {
  if (!Array.isArray(entries))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend
    })
  /** Length is fixed before any caller entry can extend the array. */
  const length = entries.length
  /** Native work consumes only these detached fields after asynchronous stages. */
  const result: ITextBatchEntry[] = []
  for (let index = 0; index < length; index++) {
    /** Keep key, value, TTL reads in the old scope batch order. */
    const entry = entries[index]!
    const fact = capture(entry.key)
    const value = entry.value
    const ttlMs = entry.ttlMs
    if (fact.firstIndex !== index || typeof value !== 'string')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: SqliteNames.backend,
        cause: new TypeError(SqliteErrorText.batch)
      })
    if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, SqliteNames.backend)
    result.push({ ...fact, value, ttlMs })
  }
  return result
}
/** Detach caller or transformed keys before asynchronous stages or physical admission. */
export function sqliteCaptureTextEntries(
  entries: Parameters<IKeyValueApi['setMany']>[0]
): readonly ITextBatchEntry[] {
  return sqliteTextBatchEntries(entries, createStorageBatchKeyCapture(SqliteNames.backend))
}
/** Scope terminals execute native statements synchronously after middleware, without another wait. */
export function sqliteProjectTextEntries(
  entries: Parameters<IKeyValueApi['setMany']>[0]
): readonly ITextBatchEntry[] {
  return sqliteTextBatchEntries(entries, createStorageBatchKeyProjection(SqliteNames.backend))
}
/** A root read's synchronous native segment holds one real read snapshot across every IN chunk. */
export function sqliteReadSnapshot<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  orgId: string,
  run: (state: INativeState) => R
): R {
  sqliteAssertRoot(organization)
  /** Expiry cleanup, when needed, belongs to this same original native snapshot and commit. */
  const state: INativeState = {
    orgId,
    context: undefined,
    baseline: new Map(),
    changed: new Map(),
    expirations: new Map(),
    mode: 'deferred',
    failure: undefined,
    expiresAt: undefined
  }
  sqliteStatement(organization, SqliteControl.deferred, [], 'run')
  organization.physicalState.active = SQLITE_CONTROL_ACTIVE
  try {
    const result = run(state)
    sqliteStatement(organization, SqliteControl.commit, [], 'run')
    organization.physicalState.active = undefined
    sqliteAdvanceRevisions(organization, state)
    sqlitePublishChanges(organization, state)
    return result
  } catch (error) {
    return sqliteRollback(
      organization,
      error instanceof SqlitePhysicalBusy ? normalizeSqliteFailure(error.cause) : error
    )
  }
}
/** Batch get uses bounded IN lists inside one real native transaction snapshot. */
export function sqliteGetMany<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  keys: readonly IStorageBatchKey[],
  state: INativeState,
  scope?: object
): readonly (string | undefined)[] {
  const result = new Map<string, string>()
  const captured = keys.filter(({ firstIndex }, index) => firstIndex === index)
  /** Native expired rows map back to original snapshots in linear total work. */
  const keysByIdentity = new Map(captured.map(({ identity, key }) => [identity, key]))
  /** Every chunk uses the same operation-local expiry cutoff inside the same native snapshot. */
  const now = Date.now()
  for (let index = 0; index < captured.length; index += SqliteLimits.batch) {
    const part = captured.slice(index, index + SqliteLimits.batch).map(({ identity }) => identity)
    const rows = sqliteStatement<TValue, readonly ISqliteRow[]>(
      organization,
      `SELECT key,value,expires_at FROM ${organization.tables.text} WHERE org_id=? AND key IN (${part.map(() => '?').join(',')})`,
      [state.orgId, ...part],
      'all',
      state
    )
    for (const row of rows) {
      if (
        !sqliteLiveExpiration(
          organization,
          'text',
          keysByIdentity.get(row.key as string)!,
          row.expires_at,
          state,
          now
        )
      )
        sqlitePrune(organization, 'text', keysByIdentity.get(row.key as string)!, state)
      else
        result.set(
          row.key as string,
          sqliteConvert(organization, 'text', 'decode', row.value, scope) as string
        )
    }
  }
  for (const { key } of captured) sqliteRevision(organization, state, 'text', key)
  return keys.map(({ identity }) => result.get(identity))
}
