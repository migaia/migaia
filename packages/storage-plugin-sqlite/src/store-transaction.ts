// Transaction control, lock conflicts, WAL attempts and native attempts for the SQLite store (see ./store.ts).
import {
  assertTransactionOwner,
  runWithConcurrency,
  readConcurrencyLockIdentities,
  snapshotConcurrencyLockRange,
  reportCleanupError,
  throwIfAborted,
  subscribeToAbort,
  readAbortReason
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertTransactionCallback,
  type ITransactionOptions,
  type IConcurrencyAttemptContext,
  type IConcurrencyAttempt,
  type IConcurrencyHolder,
  type ILockKey,
  type IBackendStageBindings
} from '@migaia/storage-contract'
import { createAbortController } from '@migaia/lifecycle'
import { walkErrorCauses } from '@migaia/utils/error'
import type { IStorageJournalExecutionPort } from '@migaia/storage-host'
import { sleep, deferred } from '@migaia/utils/promise'
import { SqliteNames, SqliteControl, SqliteLimits, SqliteOperation } from './constants.ts'
import {
  sqliteError,
  normalizeTransactionFailure,
  normalizeSqliteFailure,
  transactionCleanupFailure
} from './errors.ts'
import { SqliteErrorCode } from '@migaia/storage-contract/error-code'
import type { ISqliteTransactionScope, ISqliteRow, ISqliteValue } from './types.ts'
import { sqliteObserve } from './store-mutation.ts'
import {
  sqliteDecodeLockIdentity,
  sqliteIdentityRange,
  sqliteCurrentRevision,
  sqliteAdvanceRevisions,
  sqlitePublishChanges
} from './store-revision.ts'
import { sqliteCreateScope } from './store-scope.ts'
import {
  SQLITE_CONTROL_ACTIVE,
  sqliteIsBusy,
  sqliteStatement,
  sqliteLocalGroup,
  sqliteOperationOrg,
  sqliteJournalFor,
  sqliteFinishJournal,
  SqlitePhysicalBusy,
  SqliteLogicalConflict
} from './store-state.ts'
import type {
  ISqliteOrganizationContext,
  IWriteGuard,
  INativeState,
  ISqliteRevision
} from './store-state.ts'

/** Busy classification is restricted to trusted native transaction control boundaries. */
async function sqliteControl<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  text: string,
  context: IConcurrencyAttemptContext,
  cleanup = false,
  committed?: () => void
): Promise<void> {
  while (true) {
    if (!cleanup) throwIfAborted(context.signal)
    try {
      organization.statements.get(text).run()
      if (
        (text === SqliteControl.begin || text === SqliteControl.deferred) &&
        organization.physicalState.active === undefined
      )
        organization.physicalState.active = SQLITE_CONTROL_ACTIVE
      else if (
        (text === SqliteControl.commit || text === SqliteControl.rollback) &&
        organization.physicalState.active === SQLITE_CONTROL_ACTIVE
      )
        organization.physicalState.active = undefined
      if (text === SqliteControl.commit) committed?.()
      return
    } catch (error) {
      if (!sqliteIsBusy(organization, error)) throw normalizeSqliteFailure(error)
      if (cleanup) await sleep(SqliteLimits.pollMs)
      else await context.waitPhysical(sleep(SqliteLimits.pollMs, { signal: context.signal }))
    }
  }
}
/** Actual native rollback clears only a successfully ended trusted control segment. */
function sqliteRollbackNative<TValue>(organization: ISqliteOrganizationContext<TValue>): void {
  organization.statements.get(SqliteControl.rollback).run()
  if (organization.physicalState.active === SQLITE_CONTROL_ACTIVE)
    organization.physicalState.active = undefined
}
/** The native rollback error is secondary and never replaces the first callback/operation failure. */
export function sqliteRollback<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  primary: unknown
): never {
  try {
    sqliteRollbackNative(organization)
  } catch (secondary) {
    /** Original errors stay in order, including the exact native rollback object. */
    throw transactionCleanupFailure(primary, secondary)
  }
  throw primary
}
/** Read one actual lock row, retaining expiration and last-known holder metadata. */
export function sqliteLockRow<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  orgId: string,
  id: string
): ISqliteRow | undefined {
  return sqliteStatement(
    organization,
    `SELECT owner,label,pid,since,expires_at,attempt_token FROM ${organization.tables.locks} WHERE org_id=? AND key=?`,
    [orgId, id],
    'get'
  )
}
/** Lock identity projection contains only documented diagnostics, never the private attempt token. */
export function sqliteHolderOf<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  row: ISqliteRow
): IConcurrencyHolder {
  return {
    owner: String(row.owner),
    ...(typeof row.label === 'string' ? { label: row.label } : {}),
    ...(typeof row.pid === 'number' ? { pid: row.pid } : {}),
    since: Number(row.since),
    status: 'held',
    scope: row.owner === organization.controller.origin ? 'local' : 'remote'
  }
}
/** Range conflicts are native lock evidence; they never infer business conflict from SQLITE_BUSY. */
export function sqliteRangeConflict<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  orgId: string,
  guard: IWriteGuard,
  current?: IConcurrencyAttemptContext
):
  | { readonly keys: readonly ILockKey[]; readonly holder: IConcurrencyHolder | undefined }
  | undefined {
  if (!organization.wal) {
    const holding = sqliteLocalGroup(organization, orgId).locks.probe(
      [],
      sqliteLockRanges(organization, guard),
      current
    )
    return holding ? { keys: [holding.key], holder: holding.holder } : undefined
  }
  const conditions: string[] = []
  const values: ISqliteValue[] = [orgId, Date.now()]
  for (const channel of guard.channels) {
    const bounds = snapshotConcurrencyLockRange(
      { channel, prefix: guard.prefix },
      SqliteNames.backend
    )
    conditions.push('(key>=? AND key<?)')
    values.push(bounds.lower, bounds.upper)
  }
  if (conditions.length === 0) return
  const rows = sqliteStatement<TValue, readonly ISqliteRow[]>(
    organization,
    `SELECT key,owner,label,pid,since,expires_at,attempt_token FROM ${organization.tables.locks} WHERE org_id=? AND expires_at>? AND (${conditions.join(' OR ')})`,
    values,
    'all'
  )
  for (const row of rows) {
    const id = row.key as string
    if (
      current !== undefined &&
      organization.expectedToken?.context === current &&
      row.attempt_token === organization.expectedToken.token &&
      row.owner === organization.controller.origin
    )
      continue
    return {
      keys: [sqliteDecodeLockIdentity(organization, id)],
      holder: sqliteHolderOf(organization, row)
    }
  }
  return
}
/** The canonical owner computes bounds; this backend supplies only known affected channels. */
export function sqliteLockRanges<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  guard: IWriteGuard
) {
  return guard.channels.map((channel) => ({
    channel,
    ...snapshotConcurrencyLockRange({ channel, prefix: guard.prefix }, SqliteNames.backend)
  }))
}
/** Logical conflicts are visible before any attempt to acquire SQLite's physical writer lock. */
export function sqliteConflictingLock<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  context: IConcurrencyAttemptContext,
  ids: readonly string[],
  token: string
): { readonly row: ISqliteRow; readonly key: ILockKey } | undefined {
  for (const [index, id] of ids.entries()) {
    const row = sqliteLockRow(organization, sqliteOperationOrg(organization, context), id)
    if (row && row.attempt_token !== token && Number(row.expires_at) > Date.now())
      return { row, key: context.lock![index]! }
  }
  return undefined
}
/** SQLite's WAL lock table uses the shared model; the original loop still owns strategy and retry. */
export async function sqliteWalAttempt<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  context: IConcurrencyAttemptContext,
  run: () => Promise<IConcurrencyAttempt<R>>
): Promise<IConcurrencyAttempt<R>> {
  if (context.locking === 'optimistic' || !context.lock?.length) return run()
  const ids = readConcurrencyLockIdentities(context)
  const token = String(
    sqliteStatement<TValue, ISqliteRow>(organization, SqliteControl.generatedKey, [], 'get').key
  )
  const orgId = sqliteOperationOrg(organization, context)
  let since = 0
  let expiresAt = 0
  while (true) {
    const conflict = sqliteConflictingLock(organization, context, ids, token)
    if (conflict) {
      if (context.admission === 'try')
        return {
          status: 'conflict',
          phase: 'acquire',
          keys: context.lock,
          holder: sqliteHolderOf(organization, conflict.row)
        }
      await context.wait(sleep(SqliteLimits.pollMs, { signal: context.signal }))
      continue
    }
    /** This short native segment rechecks before writing any lock rows. */
    await sqliteControl(organization, SqliteControl.begin, context)
    try {
      const raced = sqliteConflictingLock(organization, context, ids, token)
      if (raced) {
        sqliteRollbackNative(organization)
        if (context.admission === 'try')
          return {
            status: 'conflict',
            phase: 'acquire',
            keys: context.lock,
            holder: sqliteHolderOf(organization, raced.row)
          }
        await context.wait(sleep(SqliteLimits.pollMs, { signal: context.signal }))
        continue
      }
      since = Date.now()
      expiresAt = since + organization.maxLockMs
      for (const id of ids)
        sqliteStatement(
          organization,
          `INSERT INTO ${organization.tables.locks}(org_id,key,owner,attempt_token,label,pid,since,expires_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(org_id,key) DO UPDATE SET owner=excluded.owner,attempt_token=excluded.attempt_token,label=excluded.label,pid=excluded.pid,since=excluded.since,expires_at=excluded.expires_at`,
          [
            orgId,
            id,
            organization.controller.origin,
            token,
            organization.label ?? null,
            typeof process === 'object' ? process.pid : null,
            since,
            expiresAt
          ],
          'run'
        )
      await sqliteControl(organization, SqliteControl.commit, context)
      break
    } catch (error) {
      sqliteRollback(organization, error)
    }
  }
  sqliteObserve(
    organization,
    organization.concurrencyStages,
    'onLockAcquired',
    context.attempt,
    ids.length
  )
  /** Cleanup failure keeps the earlier callback/cancellation failure first. */
  let primary: unknown
  let failed = false
  let result: IConcurrencyAttempt<R> | undefined
  try {
    result = await sqliteRunWithWalToken(organization, context, token, expiresAt, run)
  } catch (error) {
    primary = error
    failed = true
  }
  try {
    /** A late cleanup removes only this exact owner/token, even after caller cancellation. */
    await sqliteControl(organization, SqliteControl.begin, context, true)
    for (const id of ids)
      sqliteStatement(
        organization,
        `DELETE FROM ${organization.tables.locks} WHERE org_id=? AND key=? AND owner=? AND attempt_token=?`,
        [orgId, id, organization.controller.origin, token],
        'run'
      )
    await sqliteControl(organization, SqliteControl.commit, context, true)
  } catch (error) {
    let cleanup: unknown = error
    try {
      sqliteRollbackNative(organization)
    } catch (secondary) {
      cleanup = transactionCleanupFailure(error, secondary)
    }
    throw failed
      ? transactionCleanupFailure(primary, cleanup)
      : normalizeTransactionFailure(cleanup)
  }
  sqliteObserve(
    organization,
    organization.concurrencyStages,
    'onLockReleased',
    context.attempt,
    ids.length
  )
  if (failed) throw primary
  return result!
}
/** Preserve one temporary native token binding without another owner registry. */
async function sqliteRunWithWalToken<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  context: IConcurrencyAttemptContext,
  token: string,
  expiresAt: number,
  run: () => Promise<IConcurrencyAttempt<R>>
): Promise<IConcurrencyAttempt<R>> {
  organization.expectedToken = { context, token, expiresAt }
  try {
    return await run()
  } finally {
    organization.expectedToken = undefined
  }
}
/** Logical revisions and first-read deadlines survive only the original physical recovery. */
type ISqliteLogicalAttempt<TValue, R> = {
  readonly organization: ISqliteOrganizationContext<TValue>
  readonly context: IConcurrencyAttemptContext
  readonly callback: (scope: ISqliteTransactionScope<TValue>) => R
  readonly journaled: boolean
  readonly committed: (() => void) | undefined
  readonly observeKeys: ((state: INativeState) => void) | undefined
  readonly baseline: Map<string, ISqliteRevision>
  readonly expirations: INativeState['expirations']
  recover: boolean
}
/** One actual native transaction owns its admitted scope and settlement handles. */
type ISqliteNativeAttempt<TValue, R> = {
  readonly logical: ISqliteLogicalAttempt<TValue, R>
  readonly state: INativeState
  begun: boolean
  registration:
    | ReturnType<ISqliteOrganizationContext<TValue>['transactionOwner']['register']>
    | undefined
  value: Awaited<R> | undefined
  terminal: ReturnType<IBackendStageBindings['transactionStages']> | undefined
  journalAttempt: ReturnType<IStorageJournalExecutionPort['begin']>
  transactionId: string | undefined
}
/** Replay only the existing native upgrade recovery inside the canonical logical attempt. */
export async function sqliteNativeAttempt<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  context: IConcurrencyAttemptContext,
  callback: (scope: ISqliteTransactionScope<TValue>) => R,
  journaled = true,
  committed?: () => void,
  observeKeys?: (state: INativeState) => void
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  const logical: ISqliteLogicalAttempt<TValue, R> = {
    organization,
    context,
    callback,
    journaled,
    committed,
    observeKeys,
    baseline: new Map(),
    expirations: new Map(),
    recover: false
  }
  for (;;) {
    const attempt = sqliteCreateNativeAttempt(logical)
    const result = await sqliteExecuteNativeAttempt(attempt)
    if (result !== undefined) return result
  }
}
/** Attach one physical transaction to the original shared connection admission. */
function sqliteCreateNativeAttempt<TValue, R>(
  logical: ISqliteLogicalAttempt<TValue, R>
): ISqliteNativeAttempt<TValue, R> {
  const state: INativeState = {
    orgId: sqliteOperationOrg(logical.organization, logical.context),
    context: logical.context,
    baseline: logical.baseline,
    observed: logical.observeKeys === undefined ? undefined : new Map(),
    changed: new Map(),
    expirations: logical.expirations,
    expiresAt: logical.organization.expectedToken?.expiresAt,
    mode: logical.recover || logical.context.locking === 'pessimistic' ? 'immediate' : 'deferred',
    failure: undefined
  }
  logical.organization.physicalState.active = state
  return {
    logical,
    state,
    begun: false,
    registration: undefined,
    value: undefined,
    terminal: undefined,
    journalAttempt: undefined,
    transactionId: undefined
  }
}
/** Begin, authenticate and finish one callback before final native commit checks. */
async function sqliteRunNativeCallback<TValue, R>(
  attempt: ISqliteNativeAttempt<TValue, R>
): Promise<IConcurrencyAttempt<Awaited<R>> | undefined> {
  sqliteObserve(
    attempt.logical.organization,
    attempt.logical.organization.transactionStages,
    'beforeTransaction'
  )
  await sqliteControl(
    attempt.logical.organization,
    attempt.state.mode === 'immediate' ? SqliteControl.begin : SqliteControl.deferred,
    attempt.logical.context
  )
  attempt.begun = true
  if (attempt.logical.organization.expectedToken) {
    for (const id of readConcurrencyLockIdentities(attempt.logical.context)) {
      const row = sqliteLockRow(attempt.logical.organization, attempt.state.orgId, id)
      if (
        !row ||
        row.owner !== attempt.logical.organization.controller.origin ||
        row.attempt_token !== attempt.logical.organization.expectedToken.token
      )
        throw new StorageContractError(StorageContractErrorCode.lockLost)
    }
  }
  if (attempt.logical.recover) {
    /** Compare in the new writer transaction before the callback can change its own baseline. */
    for (const [id, expected] of attempt.logical.baseline) {
      const channel = sqliteIdentityRange(attempt.logical.organization, id).channel
      const actual = sqliteCurrentRevision(attempt.logical.organization, attempt.state, channel, id)
      if (actual.version !== expected.version || actual.birth !== expected.birth) {
        sqliteRollbackNative(attempt.logical.organization)
        attempt.begun = false
        return {
          status: 'conflict',
          phase: 'commit',
          keys: attempt.logical.context.lock ?? [],
          holder: undefined
        }
      }
    }
  }
  attempt.state.scopeStore = attempt.logical.organization.store
  const scope = sqliteCreateScope(attempt.logical.organization)
  attempt.registration = attempt.logical.organization.transactionOwner.register(scope, {
    createScope: () => sqliteCreateScope(attempt.logical.organization),
    context: attempt.logical.context,
    onFailure: (failure) => {
      attempt.state.failure ??= failure
    },
    beforeCommit: (checkScope) => {
      sqliteObserve(
        attempt.logical.organization,
        attempt.logical.organization.transactionStages.forTransaction(checkScope),
        'beforeCommit'
      )
      return attempt.journalAttempt?.record(checkScope)
    }
  })
  attempt.terminal = attempt.logical.organization.transactionStages.forTransaction(scope)
  attempt.transactionId = assertTransactionOwner(attempt.logical.organization.store, scope).id
  if (
    attempt.logical.journaled &&
    sqliteJournalFor(attempt.logical.organization, attempt.logical.context)?.active()
  ) {
    attempt.state.journalBefore = new Map()
    attempt.state.journalSteps = []
    attempt.journalAttempt = sqliteJournalFor(
      attempt.logical.organization,
      attempt.logical.context
    )!.begin(scope)
  }
  sqliteObserve(attempt.logical.organization, attempt.terminal, 'onTransactionStart')
  try {
    attempt.value = (await attempt.logical.callback(scope)) as Awaited<R>
  } catch (error) {
    attempt.state.failure ??= normalizeTransactionFailure(error)
  } finally {
    attempt.registration.stopAdmission()
  }
  if (attempt.state.failure) throw attempt.state.failure
  await attempt.registration.runFinalizers()
}
/** Check original deadlines and publish only after the actual native COMMIT. */
async function sqliteCommitNativeAttempt<TValue, R>(
  attempt: ISqliteNativeAttempt<TValue, R>
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  throwIfAborted(attempt.logical.context.signal)
  if (attempt.state.expiresAt !== undefined && Date.now() >= attempt.state.expiresAt)
    throw new StorageContractError(StorageContractErrorCode.lockLost)
  const commitNow = Date.now()
  const expired = [...attempt.state.expirations.values()]
    .filter(({ deadline }) => deadline <= commitNow)
    .map(({ target }) => target)
  if (expired.length !== 0) {
    sqliteRollbackNative(attempt.logical.organization)
    attempt.begun = false
    sqliteObserve(
      attempt.logical.organization,
      attempt.terminal,
      'afterRollback',
      StorageContractErrorCode.writeConflict
    )
    return { status: 'conflict', phase: 'commit', keys: expired, holder: undefined }
  }
  await sqliteControl(
    attempt.logical.organization,
    SqliteControl.commit,
    attempt.logical.context,
    false,
    () => {
      attempt.begun = false
      sqliteAdvanceRevisions(attempt.logical.organization, attempt.state)
      attempt.logical.committed?.()
      attempt.state.committedTxId = attempt.transactionId
      sqliteFinishJournal(attempt.logical.organization, attempt.state, true)
    }
  )
  let changedKeys = 0
  for (const keys of attempt.state.changed.values()) changedKeys += keys.size
  sqliteObserve(attempt.logical.organization, attempt.terminal, 'afterCommit', changedKeys)
  sqlitePublishChanges(attempt.logical.organization, attempt.state)
  return { status: 'committed', value: attempt.value as Awaited<R> }
}
/** Preserve primary errors while classifying only existing physical or logical conflict evidence. */
async function sqliteRecoverNativeAttempt<TValue, R>(
  attempt: ISqliteNativeAttempt<TValue, R>,
  error: unknown
): Promise<IConcurrencyAttempt<Awaited<R>> | undefined> {
  /** Recognize only the private recovery marker produced by a trusted statement call. */
  const physical =
    error instanceof SqlitePhysicalBusy ||
    (error instanceof Error && error.cause instanceof SqlitePhysicalBusy)
  const logical =
    error instanceof SqliteLogicalConflict
      ? error
      : error instanceof Error && error.cause instanceof SqliteLogicalConflict
        ? error.cause
        : undefined
  /** Accepted resource cleanup contributes to the same result, never only a console report. */
  let failure = error
  try {
    attempt.registration?.stopAdmission()
    await attempt.registration?.closeIterators()
  } catch (cleanup) {
    if (cleanup !== error) failure = transactionCleanupFailure(error, cleanup)
  }
  if (attempt.begun) {
    try {
      sqliteRollbackNative(attempt.logical.organization)
      attempt.begun = false
      sqliteObserve(
        attempt.logical.organization,
        attempt.terminal,
        'afterRollback',
        (failure as { code?: unknown })?.code
      )
    } catch (secondary) {
      throw transactionCleanupFailure(failure, secondary)
    }
  }
  if (physical && !attempt.logical.recover && failure === error) {
    sqliteObserve(
      attempt.logical.organization,
      attempt.logical.organization.concurrencyStages,
      'onRetry',
      attempt.logical.context.attempt,
      0,
      'physical'
    )
    attempt.logical.recover = true
    return undefined
  }
  if (logical && failure === error)
    return {
      status: 'conflict',
      phase: 'acquire',
      keys: logical.keys,
      holder: logical.holder
    }
  throw normalizeTransactionFailure(failure)
}
/** Native outcome and resource completion keep their original distinct settlement order. */
async function sqliteFinishNativeAttempt<TValue, R>(
  attempt: ISqliteNativeAttempt<TValue, R>
): Promise<void> {
  attempt.logical.observeKeys?.(attempt.state)
  sqliteFinishJournal(
    attempt.logical.organization,
    attempt.state,
    attempt.begun ? undefined : false
  )
  if (attempt.journalAttempt?.settle !== undefined) await attempt.journalAttempt.settle()
  attempt.registration?.close()
  if (attempt.registration)
    sqliteObserve(attempt.logical.organization, attempt.terminal, 'onTransactionClose')
  /** Failed rollback keeps actual unknown native ownership sealed against root access. */
  attempt.logical.organization.physicalState.active = attempt.begun
    ? SQLITE_CONTROL_ACTIVE
    : undefined
}
/** Named native jobs share one explicit attempt instead of captured mutable handles. */
async function sqliteExecuteNativeAttempt<TValue, R>(
  attempt: ISqliteNativeAttempt<TValue, R>
): Promise<IConcurrencyAttempt<Awaited<R>> | undefined> {
  try {
    const conflict = await sqliteRunNativeCallback(attempt)
    return conflict ?? (await sqliteCommitNativeAttempt(attempt))
  } catch (error) {
    return await sqliteRecoverNativeAttempt(attempt, error)
  } finally {
    await sqliteFinishNativeAttempt(attempt)
  }
}

/** The existing utility FIFO owns physical admission; only queue time enters waitPhysical. */
export async function sqlitePhysicalRun<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  context: IConcurrencyAttemptContext,
  run: () => R | Promise<R>
): Promise<R> {
  const admission = createAbortController()
  const admitted = deferred<void>()
  const unsubscribeContext = subscribeToAbort(
    context.signal,
    () => admission.abort(readAbortReason(context.signal)),
    organization.report
  )
  const unsubscribeClosing = subscribeToAbort(
    organization.controller.closingSignal,
    () =>
      admission.abort(
        new StorageContractError(StorageContractErrorCode.aborted, {
          cause: readAbortReason(organization.controller.closingSignal)
        })
      ),
    organization.report
  )
  const finished = organization.physicalAdmission.run(
    async () => {
      admitted.resolve()
      organization.controller.assertLive()
      if (organization.physicalState.active !== undefined)
        throw sqliteError(SqliteErrorCode.transactionFailed)
      throwIfAborted(context.signal)
      return run()
    },
    { signal: admission.signal }
  )
  void finished.then(undefined, (error) => admitted.reject(error))
  try {
    await context.waitPhysical(admitted.promise)
    return await finished
  } catch (primary) {
    const reason = context.signal?.aborted
      ? readAbortReason(context.signal)
      : primary instanceof StorageContractError &&
          primary.code === StorageContractErrorCode.lockTimeout
        ? primary.cause
        : primary
    admission.abort(reason)
    try {
      await finished
    } catch (secondary) {
      if (
        secondary !== primary &&
        secondary !== reason &&
        !walkErrorCauses(secondary).includes(primary)
      )
        reportCleanupError(organization.report, secondary)
    }
    throw primary
  } finally {
    unsubscribeClosing()
    unsubscribeContext()
  }
}
/** All public transactions enter the existing concurrency loop and original physical limiter. */
export function sqliteTransact<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  callback: (scope: ISqliteTransactionScope<TValue>) => R,
  options: ITransactionOptions = {},
  journaled = true
): Promise<Awaited<R>> {
  assertTransactionCallback(callback, SqliteNames.backend)
  organization.controller.assertLive()
  const finish = organization.controller.beginMutation()
  let observing = false
  let observedKeys: readonly ILockKey[] | undefined
  const execute = () =>
    runWithConcurrency<Awaited<R>>(
      {
        store: organization.store,
        options,
        prepare:
          !journaled || organization.core.journal === undefined
            ? undefined
            : (context) => sqliteJournalFor(organization, context)?.prepare(),
        lock: (context) =>
          journaled ? (sqliteJournalFor(organization, context)?.headLocks() ?? []) : []
      },
      {
        attempt: async (context) => {
          /** This native backend owns no vector collection or RDF graph and never falls back to key. */
          if (context.lock?.some(({ channel }) => channel === 'vector' || channel === 'rdf'))
            throw new StorageContractError(StorageContractErrorCode.unsupported, {
              backend: SqliteNames.backend
            })
          const run = () =>
            sqlitePhysicalRun(organization, context, () => {
              const invoke = () =>
                sqliteNativeAttempt(
                  organization,
                  context,
                  callback,
                  journaled,
                  undefined,
                  observing
                    ? (state) => {
                        observedKeys = [...state.observed!.values()]
                      }
                    : undefined
                )
              const execute = () =>
                organization.wal ? sqliteWalAttempt(organization, context, invoke) : invoke()
              return organization.core.execution.run(
                {
                  operation: SqliteOperation.transaction,
                  input: {},
                  ctx: context,
                  internal: true
                },
                execute
              )
            })
          if (organization.wal && context.locking === 'pessimistic' && context.lock?.length) {
            const ids = readConcurrencyLockIdentities(context)
            const conflict = sqliteConflictingLock(organization, context, ids, '')
            if (conflict && context.admission === 'try')
              return Promise.resolve({
                status: 'conflict',
                phase: 'acquire',
                keys: context.lock,
                holder: sqliteHolderOf(organization, conflict.row)
              })
          }
          return organization.wal
            ? run()
            : sqliteLocalGroup(
                organization,
                sqliteOperationOrg(organization, context)
              ).locks.attempt(
                context,
                {
                  owner: organization.controller.origin,
                  ...(organization.label === undefined ? {} : { label: organization.label }),
                  since: Date.now(),
                  status: 'held',
                  scope: 'local'
                },
                { attempt: run },
                organization.concurrencyStages,
                organization.controller.closingSignal
              )
        }
      }
    )
  const result =
    organization.core.execution.observe === undefined
      ? execute()
      : organization.core.execution.observe(
          () => ({
            operation: SqliteOperation.transaction,
            input: {},
            keys: () => observedKeys ?? [],
            internal: journaled ? undefined : true
          }),
          (enabled) => {
            observing = enabled
            return execute()
          }
        )
  return result.finally(finish)
}
