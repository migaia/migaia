import {
  StorageContractError,
  StorageContractErrorCode,
  assertTransactionCallback,
  type IStorageStore,
  type ITransactionOptions,
  type IConcurrencyAttemptContext,
  type IConcurrencyAttempt,
  type ITransactionStageObserver,
  type ILockKey,
  type IOperationContext,
  type ITransactionScope
} from '@migaia/storage-contract'
import {
  createTransactionOwner,
  assertTransactionOwner
} from '@migaia/storage-host/authoring/transaction'
import { runWithConcurrency } from '@migaia/storage-host/authoring/concurrency'
import type { IStorageBackendOrgContext } from '@migaia/storage-host'
import {
  createStorageOperationReporter,
  reportCleanupError,
  throwIfAborted,
  type IBackendChangeController
} from '@migaia/storage-host/authoring/backend'
import { sleep } from '@migaia/utils/promise'
import { walkErrorCauses, attachSecondaryErrors } from '@migaia/utils/error'
import type { IPgConfiguration, IPgTables } from './schema.js'
import type { IPgState, IPgRevision } from './native.js'
import type { IPgJournalCapture } from './journal.js'
import { commitPgRevisions, recheckPgRevisions } from './native.js'
import {
  acquirePgLocks,
  verifyPgLocks,
  releasePgLocks,
  guardPgKeys,
  guardPgRange,
  PgLockConflict,
  type IPgLockLease
} from './locks.js'
import { normalizeTransactionFailure, normalizePostgresError } from './errors.js'
import { PgNames, PgSqlState, PgOperation } from './constants.js'
import { PostgresErrorText } from './error-text.js'
import { pgCodecs } from './codec.js'
/** Observation always retains its original receiver and remains report-only. */
export function observePg<T extends object, K extends keyof T>(
  observer: T,
  key: K,
  ...args: NonNullable<T[K]> extends (...args: infer A) => unknown ? A : never
): void {
  const report = createStorageOperationReporter()
  try {
    if (typeof observer[key] !== 'function') return
    const result = observer[key](...args)
    void Promise.resolve(result).catch((cause) => reportCleanupError(report, cause))
  } catch (cause) {
    reportCleanupError(report, cause)
  }
}
/** Only native driver SQL states, preserved on the owned cause chain, cause physical replay. */
function physicalPgFailure(value: unknown): boolean {
  return walkErrorCauses(value).some(
    (cause) =>
      cause !== null &&
      typeof cause === 'object' &&
      (('code' in cause &&
        (cause.code === PgSqlState.serialization || cause.code === PgSqlState.deadlock)) ||
        ('errno' in cause &&
          (cause.errno === PgSqlState.serialization || cause.errno === PgSqlState.deadlock)))
  )
}
/** Frozen primary failures keep their public identity on a wrapper and both original causes. */
function physicalPgCause(failure: unknown, cause: unknown): unknown {
  const attached = attachSecondaryErrors(failure, [cause])
  if (attached === failure) return failure
  return failure instanceof StorageContractError
    ? new StorageContractError(
        failure.code,
        { backend: failure.backend, keys: failure.keys, holder: failure.holder, cause: attached },
        failure.message
      )
    : normalizeTransactionFailure(attached)
}
/** Installation context contains only the original native and canonical transaction ports. */
type IPgTransactionInput<TScope extends Omit<ITransactionScope, 'use'>> = {
  readonly states: WeakMap<object, { readonly store: IStorageStore; readonly state: IPgState }>
  readonly store: IStorageStore
  readonly configuration: IPgConfiguration
  readonly tables: IPgTables
  readonly runtime: IStorageBackendOrgContext
  readonly controller: IBackendChangeController
  readonly createScope: (state: IPgState) => TScope
  readonly publish: (state: IPgState) => void
  readonly journalCapture?: (state: IPgState) => IPgJournalCapture
  readonly beforeCommit?: (state: IPgState) => Promise<void>
  readonly onIsolation?: (value: string) => void
}
/** One logical attempt retains revisions across physical serialization replay. */
type IPgLogicalAttempt<TScope extends Omit<ITransactionScope, 'use'>, R> = {
  readonly context: IConcurrencyAttemptContext
  readonly callback: (scope: TScope) => R
  readonly lease: IPgLockLease | undefined
  readonly publicTransaction: boolean
  readonly journaled: boolean
  readonly observeKeys: ((keys: readonly ILockKey[]) => void) | undefined
  readonly normalize: (cause: unknown) => Error
  readonly baseline: Map<string, IPgRevision>
  lastPhysical: unknown
}
/** Existing native flags and handles belong to exactly one borrowed physical transaction. */
type IPgPhysicalAttempt<TScope extends Omit<ITransactionScope, 'use'>, R> = {
  readonly logical: IPgLogicalAttempt<TScope, R>
  readonly state: IPgState
  begun: boolean
  commitSent: boolean
  registration:
    | ReturnType<ReturnType<typeof createTransactionOwner<unknown, TScope>>['register']>
    | undefined
  terminal: ITransactionStageObserver | undefined
  primary: unknown
  failed: boolean
  retry: boolean
  value: Awaited<R> | undefined
  marker: string | undefined
  borrowReturned: boolean
  journalAttempt: ReturnType<NonNullable<IStorageBackendOrgContext['journal']>['begin']>
}
/** Native failure is captured only so ordered cleanup also runs after a rejected operation. */
type IPgPhysicalResult<R> =
  | { readonly failed: false; readonly value: IConcurrencyAttempt<Awaited<R>> | undefined }
  | { readonly failed: true; readonly cause: unknown }
/** Named native transaction adapter; admission and retry policy remain with canonical owners. */
class PgTransactions<TScope extends Omit<ITransactionScope, 'use'>> {
  /** Fixed organization, native layout and callback ports do not change between operations. */
  readonly #input: IPgTransactionInput<TScope>
  /** The original observer reports actual conflict attempts and physical retries. */
  readonly #concurrencyStages: ReturnType<
    IStorageBackendOrgContext['stageBindings']['concurrencyStages']
  >
  /** The original transaction observer retains actual native settlement events. */
  readonly #transactionStages: ReturnType<
    IStorageBackendOrgContext['stageBindings']['transactionStages']
  >
  /** Canonical admission and scope lifetime are reused, not reimplemented by this adapter. */
  readonly #owner: ReturnType<typeof createTransactionOwner<unknown, TScope>>
  /** Assemble one adapter around the canonical transaction owner and fixed native context. */
  constructor(input: IPgTransactionInput<TScope>) {
    this.#input = input
    this.#concurrencyStages = input.runtime.stageBindings.concurrencyStages(input.store)
    this.#transactionStages = input.runtime.stageBindings.transactionStages(input.store)
    this.#owner = createTransactionOwner<unknown, TScope>(
      input.store,
      normalizeTransactionFailure,
      {
        activityMode: 'managed',
        defaultPolicy: input.configuration.concurrency,
        concurrencyStages: this.#concurrencyStages
      }
    )
  }
  /** Register one actual native scope with the original shared identity table. */
  #makeScope(state: IPgState): TScope {
    const scope = this.#input.createScope(state)
    this.#input.states.set(scope, { store: this.#input.store, state })
    return scope
  }
  /** Authenticate the original transaction owner before borrowing its native state. */
  readonly stateFor = (scope: object): IPgState => {
    assertTransactionOwner(this.#input.store, scope)
    return this.#input.states.get(scope)!.state
  }
  /** Physical native state is independent of the canonical logical concurrency attempt. */
  async #attempt<R>(
    context: IConcurrencyAttemptContext,
    callback: (scope: TScope) => R,
    lease: IPgLockLease | undefined,
    publicTransaction: boolean,
    journaled: boolean,
    observeKeys?: (keys: readonly ILockKey[]) => void
  ): Promise<IConcurrencyAttempt<Awaited<R>>> {
    const logical: IPgLogicalAttempt<TScope, R> = {
      context,
      callback,
      lease,
      publicTransaction,
      journaled,
      observeKeys,
      normalize: publicTransaction ? normalizeTransactionFailure : normalizePostgresError,
      baseline: new Map(),
      lastPhysical: undefined
    }
    for (;;) {
      if (logical.lastPhysical !== undefined)
        await this.#physicalCancellation(logical, logical.lastPhysical)
      throwIfAborted(context.signal)
      const attempt = await this.#openPhysical(logical)
      const settled = await this.#executePhysical(attempt).then(
        (value) => ({ failed: false as const, value }),
        (cause) => ({ failed: true as const, cause })
      )
      await this.#finishPhysical(attempt, settled)
      if (settled.failed) throw settled.cause
      if (settled.value !== undefined) return settled.value
      if (attempt.retry) {
        try {
          await context.waitPhysical(sleep(10))
        } catch (failure) {
          throw physicalPgCause(failure, attempt.primary)
        }
      }
    }
  }
  /** Only the original concurrency owner classifies physical deadline cancellation. */
  async #physicalCancellation<R>(
    logical: IPgLogicalAttempt<TScope, R>,
    cause: unknown
  ): Promise<void> {
    if (!logical.context.signal?.aborted) return
    try {
      await logical.context.waitPhysical(Promise.resolve())
    } catch (failure) {
      throw physicalPgCause(failure, cause)
    }
  }
  /** Borrow one client and create exactly one native attempt using the original guard owners. */
  async #openPhysical<R>(
    logical: IPgLogicalAttempt<TScope, R>
  ): Promise<IPgPhysicalAttempt<TScope, R>> {
    const client = await this.#input.configuration.driver.connect(logical.context)
    const state: IPgState = {
      terminal: { committed: new Set(), rolledBack: new Set(), ended: new Set(), settled: false },
      codecs: pgCodecs,
      client,
      orgId: this.#input.runtime.orgId,
      ctx: logical.context,
      baseline: logical.baseline,
      observed: new Map(),
      changed: new Map(),
      expirations: new Map(),
      failure: undefined,
      guardKeys: (keys) =>
        guardPgKeys(
          client,
          this.#input.tables,
          this.#input.runtime.orgId,
          this.#input.controller.origin,
          logical.lease,
          keys
        ),
      guardRange: (channel, prefix) =>
        guardPgRange(
          client,
          this.#input.tables,
          this.#input.runtime.orgId,
          this.#input.controller.origin,
          logical.lease,
          channel,
          prefix
        )
    }
    if (logical.journaled && this.#input.runtime.journal?.active())
      state.journal = this.#input.journalCapture?.(state)
    return {
      logical,
      state,
      begun: false,
      commitSent: false,
      registration: undefined,
      terminal: undefined,
      primary: undefined,
      failed: false,
      retry: false,
      value: undefined,
      marker: undefined,
      borrowReturned: false,
      journalAttempt: undefined
    }
  }
  /** Native settlement alone delivers original terminal effects once. */
  #complete<R>(attempt: IPgPhysicalAttempt<TScope, R>, success: boolean): void {
    if (attempt.state.terminal.settled) return
    attempt.state.terminal.settled = true
    for (const effect of success
      ? attempt.state.terminal.committed
      : attempt.state.terminal.rolledBack)
      observePg({ effect }, 'effect')
    attempt.state.terminal.committed.clear()
    attempt.state.terminal.rolledBack.clear()
  }
  /** Publication follows a committed native outcome, including positively recovered COMMIT. */
  async #committed<R>(
    attempt: IPgPhysicalAttempt<TScope, R>
  ): Promise<IConcurrencyAttempt<Awaited<R>>> {
    attempt.begun = false
    observePg(
      attempt.terminal!,
      'afterCommit',
      [...attempt.state.changed.values()].reduce((count, keys) => count + keys.size, 0)
    )
    this.#complete(attempt, true)
    this.#input.publish(attempt.state)
    await attempt.journalAttempt?.settle?.()
    return { status: 'committed', value: attempt.value as Awaited<R> }
  }
  /** Begin, authenticate and finish the callback before native commit preparation. */
  async #preparePhysical<R>(attempt: IPgPhysicalAttempt<TScope, R>): Promise<void> {
    await attempt.state.client.query(
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      [],
      attempt.logical.context
    )
    attempt.begun = true
    const isolation = (
      await attempt.state.client.query('SHOW transaction_isolation', [], attempt.logical.context)
    ).rows[0]?.transaction_isolation
    if (typeof isolation !== 'string')
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: PgNames.backend
      })
    this.#input.onIsolation?.(isolation)
    await verifyPgLocks(
      attempt.state.client,
      this.#input.tables,
      this.#input.runtime.orgId,
      attempt.logical.lease
    )
    const scope = this.#makeScope(attempt.state)
    attempt.registration = this.#owner.register(scope, {
      createScope: () => this.#makeScope(attempt.state),
      context: attempt.logical.context,
      onFailure: (failure) => {
        attempt.state.failure ??= failure
      },
      beforeCommit: async (checkScope) => {
        observePg(this.#transactionStages.forTransaction(checkScope), 'beforeCommit')
        await attempt.state.journal?.finalize()
        await attempt.journalAttempt?.record(checkScope)
        await this.#input.beforeCommit?.(attempt.state)
      }
    })
    if (attempt.logical.journaled)
      attempt.journalAttempt = this.#input.runtime.journal?.begin(scope)
    attempt.terminal = this.#transactionStages.forTransaction(scope)
    observePg(attempt.terminal, 'beforeTransaction')
    observePg(attempt.terminal, 'onTransactionStart')
    attempt.marker = assertTransactionOwner(this.#input.store, scope).id
    try {
      attempt.value = await attempt.logical.callback(scope)
    } catch (cause) {
      attempt.state.failure ??= attempt.logical.normalize(cause)
    } finally {
      attempt.registration.stopAdmission()
    }
    if (attempt.state.failure) throw attempt.state.failure
    await attempt.registration.runFinalizers()
  }
  /** Commit revisions and the original marker before publishing native success. */
  async #commitPhysical<R>(
    attempt: IPgPhysicalAttempt<TScope, R>
  ): Promise<IConcurrencyAttempt<Awaited<R>> | undefined> {
    throwIfAborted(attempt.logical.context.signal)
    await verifyPgLocks(
      attempt.state.client,
      this.#input.tables,
      this.#input.runtime.orgId,
      attempt.logical.lease
    )
    const conflict = await commitPgRevisions(attempt.state, this.#input.tables)
    if (conflict !== undefined) {
      await attempt.state.client.query('ROLLBACK', [])
      attempt.begun = false
      observePg(attempt.terminal!, 'afterRollback', StorageContractErrorCode.writeConflict)
      return { status: 'conflict', phase: 'commit', keys: conflict, holder: undefined }
    }
    throwIfAborted(attempt.logical.context.signal)
    await attempt.state.client.query(
      'INSERT INTO ' +
        this.#input.tables.markers +
        ' (org_id,key,value) VALUES($1,$2,$3) ON CONFLICT(org_id,key) DO NOTHING',
      [this.#input.runtime.orgId, attempt.marker!, PgNames.markerValue],
      attempt.logical.context
    )
    throwIfAborted(attempt.logical.context.signal)
    attempt.commitSent = true
    await attempt.state.client.query('COMMIT', [])
    return undefined
  }
  /** Preserve primary failure while the original marker proves or rejects a recovered COMMIT. */
  async #recoverCommit<R>(
    attempt: IPgPhysicalAttempt<TScope, R>,
    cause: unknown
  ): Promise<IConcurrencyAttempt<Awaited<R>>> {
    try {
      // Return the original borrow before a marker query can need the same pool slot.
      await attempt.state.client.dispose()
      attempt.borrowReturned = true
      const row = (
        await this.#input.configuration.driver.query(
          'SELECT value FROM ' + this.#input.tables.markers + ' WHERE org_id=$1 AND key=$2',
          [this.#input.runtime.orgId, attempt.marker!]
        )
      ).rows[0]
      if (row?.value === PgNames.markerValue) {
        reportCleanupError(createStorageOperationReporter(), cause)
        attempt.failed = false
        return this.#committed(attempt)
      }
    } catch (secondary) {
      if (secondary !== attempt.primary)
        attempt.primary = new AggregateError(
          [attempt.primary, secondary],
          PostgresErrorText.transactionFailed
        )
    }
    void this.#input.controller
      .dispose()
      .catch((secondary) => reportCleanupError(createStorageOperationReporter(), secondary))
    throw attempt.logical.normalize(attempt.primary)
  }
  /** Roll back only an open transaction whose COMMIT was never sent. */
  async #rollbackPhysical<R>(attempt: IPgPhysicalAttempt<TScope, R>): Promise<void> {
    if (attempt.begun && !attempt.commitSent) {
      try {
        await attempt.state.client.query('ROLLBACK', [])
        attempt.begun = false
        if (attempt.terminal)
          observePg(
            attempt.terminal,
            'afterRollback',
            typeof attempt.primary === 'object' &&
              attempt.primary !== null &&
              'code' in attempt.primary
              ? String(attempt.primary.code)
              : undefined
          )
      } catch (secondary) {
        throw normalizeTransactionFailure(
          new AggregateError([attempt.primary, secondary], PostgresErrorText.transactionFailed)
        )
      }
    }
  }
  /** Recover native failures without introducing a second retry or lifecycle owner. */
  async #recoverPhysical<R>(
    attempt: IPgPhysicalAttempt<TScope, R>,
    cause: unknown
  ): Promise<IConcurrencyAttempt<Awaited<R>> | undefined> {
    attempt.primary = cause
    attempt.failed = true
    if (attempt.commitSent && physicalPgFailure(cause)) attempt.commitSent = false
    if (attempt.commitSent) return this.#recoverCommit(attempt, cause)
    try {
      attempt.registration?.stopAdmission()
      await attempt.registration?.closeIterators()
    } catch (secondary) {
      if (secondary !== attempt.primary)
        attempt.primary = new AggregateError(
          [attempt.primary, secondary],
          PostgresErrorText.transactionFailed
        )
    }
    await this.#rollbackPhysical(attempt)
    if (!attempt.commitSent && physicalPgFailure(cause) && attempt.primary === cause) {
      attempt.logical.lastPhysical = cause
      await this.#physicalCancellation(attempt.logical, cause)
      let unchanged: boolean
      try {
        unchanged = await recheckPgRevisions(attempt.state, this.#input.tables)
      } catch (failure) {
        await this.#physicalCancellation(attempt.logical, cause)
        throw failure
      }
      if (unchanged) {
        observePg(
          this.#concurrencyStages,
          'onRetry',
          attempt.logical.context.attempt,
          0,
          'physical'
        )
        attempt.retry = true
      } else
        return {
          status: 'conflict',
          phase: 'commit',
          keys: [...attempt.state.observed.values()],
          holder: undefined,
          cause
        }
    }
    if (cause instanceof PgLockConflict && attempt.primary === cause)
      return { status: 'conflict', phase: 'acquire', keys: cause.keys, holder: cause.holder }
    if (!attempt.retry) {
      if (attempt.logical.lastPhysical !== undefined)
        await this.#physicalCancellation(attempt.logical, attempt.logical.lastPhysical)
      throw attempt.logical.normalize(attempt.primary)
    }
  }
  /** Keep callback failure, native recovery and final cleanup as separate named jobs. */
  async #executePhysical<R>(
    attempt: IPgPhysicalAttempt<TScope, R>
  ): Promise<IConcurrencyAttempt<Awaited<R>> | undefined> {
    try {
      await this.#preparePhysical(attempt)
      const conflict = await this.#commitPhysical(attempt)
      return conflict ?? this.#committed(attempt)
    } catch (cause) {
      return this.#recoverPhysical(attempt, cause)
    }
  }
  /** Original cleanup order retains journal intent until the actual native terminal is known. */
  async #finishPhysical<R>(
    attempt: IPgPhysicalAttempt<TScope, R>,
    settled: IPgPhysicalResult<R>
  ): Promise<void> {
    if (attempt.logical.observeKeys !== undefined)
      attempt.logical.observeKeys([...attempt.state.observed.values()])
    if (!attempt.state.terminal.settled && !attempt.begun && !attempt.commitSent)
      this.#complete(attempt, false)
    await attempt.journalAttempt?.settle?.()
    for (const effect of attempt.state.terminal.ended) observePg({ effect }, 'effect')
    attempt.state.terminal.ended.clear()
    attempt.state.terminal.committed.clear()
    attempt.state.terminal.rolledBack.clear()
    if (!settled.failed && settled.value?.status === 'committed' && attempt.marker !== undefined) {
      try {
        await (
          attempt.borrowReturned ? this.#input.configuration.driver : attempt.state.client
        ).query('DELETE FROM ' + this.#input.tables.markers + ' WHERE org_id=$1 AND key=$2', [
          this.#input.runtime.orgId,
          attempt.marker
        ])
      } catch (cause) {
        reportCleanupError(createStorageOperationReporter(), cause)
      }
    }
    attempt.registration?.close()
    if (attempt.terminal) observePg(attempt.terminal, 'onTransactionClose')
    try {
      await attempt.state.client.dispose()
    } catch (secondary) {
      throw normalizeTransactionFailure(
        attempt.failed
          ? new AggregateError([attempt.primary, secondary], PostgresErrorText.transactionFailed)
          : secondary
      )
    }
  }

  /** Execute one logical operation through the canonical concurrency and observation owners. */
  readonly run = <R>(
    callback: (scope: TScope) => R,
    options: ITransactionOptions = {},
    operation = 'transaction',
    execution?: {
      readonly input: unknown
      readonly capture: (input: unknown) => void
      readonly lock?: () => readonly ILockKey[]
      readonly observe?: <V>(invoke: () => Promise<V>) => Promise<V>
    },
    pipeline = true,
    journaled = true
  ): Promise<Awaited<R>> => {
    assertTransactionCallback(callback, PgNames.backend)
    this.#input.controller.assertLive()
    const release = this.#input.controller.beginMutation()
    /** Only enabled observation copies final original native facts across the existing retry loop. */
    let observing = false
    let observedKeys: readonly ILockKey[] | undefined
    let observedInput = execution?.input ?? {}
    const execute = () =>
      runWithConcurrency<Awaited<R>>(
        {
          store: this.#input.store,
          options,
          ...(journaled && this.#input.runtime.journal !== undefined
            ? { prepare: () => this.#input.runtime.journal!.prepare() }
            : {}),
          lock: () => [
            ...(execution?.lock?.() ?? []),
            ...(journaled ? (this.#input.runtime.journal?.headLocks() ?? []) : [])
          ],
          ...(pipeline
            ? {
                executeAttempt: (
                  ctx: IOperationContext,
                  invoke: () => Promise<Awaited<Awaited<R>>>
                ) =>
                  this.#input.runtime.execution.run(
                    { operation, input: execution?.input ?? {}, ctx, internal: true },
                    (input) => {
                      observedInput = input
                      execution?.capture(input)
                      return execution?.observe === undefined ? invoke() : execution.observe(invoke)
                    }
                  )
              }
            : {})
        },
        {
          attempt: async (context) => {
            if (observing) observedKeys = context.lock ?? []
            if (context.orgId !== undefined && context.orgId !== this.#input.runtime.orgId)
              throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
                backend: PgNames.backend
              })
            const lease = await acquirePgLocks(
              this.#input.configuration,
              this.#input.tables,
              this.#input.runtime.orgId,
              this.#input.controller.origin,
              context
            )
            if (lease instanceof PgLockConflict)
              return {
                status: 'conflict',
                phase: 'acquire',
                keys: lease.keys,
                holder: lease.holder
              }
            let primary: unknown
            let failed = false
            let result: IConcurrencyAttempt<Awaited<R>> | undefined
            try {
              result = await this.#attempt(
                context,
                callback,
                lease,
                operation === PgOperation.transaction,
                journaled,
                observing
                  ? (keys) => {
                      observedKeys = keys
                    }
                  : undefined
              )
            } catch (cause) {
              primary = cause
              failed = true
            }
            try {
              await releasePgLocks(
                this.#input.configuration,
                this.#input.tables,
                this.#input.runtime.orgId,
                lease
              )
            } catch (secondary) {
              if (failed)
                throw normalizeTransactionFailure(
                  new AggregateError([primary, secondary], PostgresErrorText.transactionFailed)
                )
              throw normalizeTransactionFailure(secondary)
            }
            if (failed) throw primary
            return result!
          }
        }
      )
    const result =
      this.#input.runtime.execution.observe === undefined
        ? execute()
        : this.#input.runtime.execution.observe(
            () => ({
              operation,
              input: observedInput,
              keys: () => observedKeys ?? [],
              internal:
                !journaled ||
                operation === PgOperation.metadataGet ||
                operation === PgOperation.metadataSet ||
                operation === PgOperation.metadataDelete
                  ? true
                  : undefined
            }),
            (enabled) => {
              observing = enabled
              return execute()
            }
          )
    void result.then(release, release)
    return result
  }
  /** Iterator activity stays authenticated by the canonical transaction lifetime. */
  get registerIterator() {
    return this.#owner.registerIterator
  }
}
/** Build the native adapter without closing over mutable component state. */
export function createPgTransactions<TScope extends Omit<ITransactionScope, 'use'>>(
  input: IPgTransactionInput<TScope>
) {
  return new PgTransactions(input)
}
