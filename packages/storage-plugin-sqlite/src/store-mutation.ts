// Clears, key listing, synchronous mutations, record cursors and journal markers for the SQLite store (see ./store.ts).
import {
  snapshotStorageKeyPrefix,
  readConcurrencyLockIdentities,
  snapshotConcurrencyLockKeys,
  lockKey,
  decodeFlatStorageKey,
  reportCleanupError,
  throwIfAborted,
  snapshotKeyRange
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageKey,
  type IStorageBatchKey,
  type IOperationContext,
  type IKeyRange,
  type IStorageIterator,
  type IConcurrencyAttemptContext,
  type ILockKey
} from '@migaia/storage-contract'
import { asyncDisposeKey } from '@migaia/plugin-host'
import type { IStorageJournalChange, IStorageJournalTarget } from '@migaia/storage-host'
import { SqliteNames, SqliteControl, SqliteLimits, SqliteOperation } from './constants.ts'
import { normalizeSqliteFailure } from './errors.ts'
import { decodeKey, decodeHexKey, keyHex } from './key-codec.ts'
import type { ISqliteRow } from './types.ts'
import {
  sqliteCleanupExpiredRows,
  sqliteRecordRows,
  sqliteLiveExpiration,
  sqlitePrune,
  sqliteConvert
} from './store-io.ts'
import { sqliteRootRead } from './store-operation.ts'
import {
  sqliteRevision,
  sqliteChanged,
  sqliteAdvanceRevisions,
  sqlitePublishChanges,
  sqliteIdentity,
  sqliteCurrentRevision,
  sqliteRevisionIdentity
} from './store-revision.ts'
import {
  sqliteStatement,
  SqliteLogicalConflict,
  sqliteAssertRoot,
  sqliteLocalGroup,
  SQLITE_CONTROL_ACTIVE,
  sqliteJournalScope
} from './store-state.ts'
import type {
  ISqliteOrganizationContext,
  INativeState,
  IChannel,
  IWriteGuard
} from './store-state.ts'
import {
  sqliteRangeConflict,
  sqliteLockRow,
  sqliteHolderOf,
  sqliteRollback,
  sqliteTransact
} from './store-transaction.ts'

/** Distinct physical deletions use bounded IN lists and one existing native transaction. */
export function sqliteRemoveTextBatch<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  keys: readonly IStorageBatchKey[],
  state: INativeState
): number {
  /** Canonical first positions own equality; no backend-specific duplicate-key representation. */
  const captured = keys.filter(({ firstIndex }, index) => firstIndex === index)
  /** Native row counts describe successful physical deletions, including existing expired rows. */
  let removed = 0
  for (let index = 0; index < captured.length; index += SqliteLimits.batch) {
    /** All placeholders stay within the same conservative builtin parameter budget as reads. */
    const part = captured.slice(index, index + SqliteLimits.batch)
    /** Only this bounded chunk maps native row identities back to original detached keys. */
    const keysByIdentity = new Map(part.map((fact) => [fact.identity, fact.key]))
    for (const { key } of part) sqliteRevision(organization, state, 'text', key)
    /** Native presence fixes the exact changed rows before the atomic DELETE. */
    const rows = sqliteStatement<TValue, readonly ISqliteRow[]>(
      organization,
      `SELECT key FROM ${organization.tables.text} WHERE org_id=? AND key IN (${part.map(() => '?').join(',')})`,
      [state.orgId, ...part.map(({ identity }) => identity)],
      'all',
      state
    )
    /** Matching rows cannot change between statements owned by this native writer. */
    const result = sqliteStatement<TValue, { changes: number | bigint }>(
      organization,
      `DELETE FROM ${organization.tables.text} WHERE org_id=? AND key IN (${part.map(() => '?').join(',')})`,
      [state.orgId, ...part.map(({ identity }) => identity)],
      'run',
      state
    )
    removed += Number(result.changes)
    for (const row of rows)
      sqliteChanged(organization, state, 'text', keysByIdentity.get(row.key as string)!)
  }
  return removed
}
/** Prefix bounds come from the canonical key owner and hit the existing ordered primary key. */
export function sqliteRemovePrefix<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: 'text' | 'record',
  prefix: IStorageKey,
  state: INativeState
): number {
  const held = sqliteRangeConflict(
    organization,
    state.orgId,
    { channels: [channel], prefix },
    state.context
  )
  if (held) throw new SqliteLogicalConflict(held.keys, held.holder)
  const range = snapshotStorageKeyPrefix(prefix, SqliteNames.backend)
  const lower = channel === 'record' ? range.lower : keyHex(range.lower)
  const upper = channel === 'record' ? range.upper : keyHex(range.upper)
  const rows = sqliteStatement<TValue, readonly ISqliteRow[]>(
    organization,
    `SELECT key FROM ${organization.tables[channel]} WHERE org_id=? AND key>=? AND key<?`,
    [state.orgId, lower, upper],
    'all',
    state
  )
  /** Baselines are captured before mutation, including physical expired matches. */
  for (const row of rows)
    sqliteRevision(
      organization,
      state,
      channel,
      channel === 'record' ? decodeKey(row.key as Uint8Array) : decodeHexKey(row.key as string)
    )
  sqliteStatement(
    organization,
    `DELETE FROM ${organization.tables[channel]} WHERE org_id=? AND key>=? AND key<?`,
    [state.orgId, lower, upper],
    'run',
    state
  )
  for (const row of rows)
    sqliteChanged(
      organization,
      state,
      channel,
      channel === 'record' ? decodeKey(row.key as Uint8Array) : decodeHexKey(row.key as string)
    )
  return rows.length
}
/** Clear enumerates only rows actually affected, for original revision and change ownership. */
export function sqliteClear<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channels: readonly IChannel[],
  state: INativeState
): void {
  /** Recheck inside the native writer before any row is removed. */
  const held = sqliteRangeConflict(
    organization,
    state.orgId,
    { channels: channels.filter((channel) => channel !== 'metadata') },
    state.context
  )
  if (held) throw new SqliteLogicalConflict(held.keys, held.holder)
  for (const channel of channels) {
    const rows = sqliteStatement<TValue, readonly ISqliteRow[]>(
      organization,
      `SELECT key FROM ${organization.tables[channel]} WHERE org_id=?`,
      [state.orgId],
      'all',
      state
    )
    for (const row of rows) {
      const key =
        channel === 'record' ? decodeKey(row.key as Uint8Array) : decodeHexKey(row.key as string)
      sqliteRevision(organization, state, channel, key)
    }
    sqliteStatement(
      organization,
      `DELETE FROM ${organization.tables[channel]} WHERE org_id=?`,
      [state.orgId],
      'run',
      state
    )
    for (const row of rows)
      sqliteChanged(
        organization,
        state,
        channel,
        channel === 'record' ? decodeKey(row.key as Uint8Array) : decodeHexKey(row.key as string)
      )
  }
}
/** String-only legacy keys omit typed batch keys while retaining canonical identity. */
export function sqliteTextKeys<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  orgId: string,
  observeKey?: (key: ILockKey) => void,
  state?: INativeState
): string[] {
  sqliteCleanupExpiredRows(organization, 'text', orgId, undefined, state)
  const rows = sqliteStatement<TValue, readonly ISqliteRow[]>(
    organization,
    `SELECT key FROM ${organization.tables.text} WHERE org_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY key`,
    [orgId, Date.now()],
    'all',
    state
  )
  const keys: string[] = []
  for (const row of rows) {
    const key = decodeHexKey(row.key as string)
    if (typeof key === 'string') {
      keys.push(key)
      observeKey?.(lockKey.text(key))
    }
  }
  return keys
}
/** Synchronous mutation keeps its complete replace in one native atomic segment. */
export function sqliteSyncMutation<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  run: (state: INativeState) => R,
  keys: readonly ILockKey[] = [],
  guard?: IWriteGuard,
  orgId = organization.runtime.orgId,
  context?: IConcurrencyAttemptContext,
  committed?: () => void,
  observeKeys?: (state: INativeState) => void
): R {
  sqliteAssertRoot(organization)
  /** Synchronous entry cannot wait or invoke a user strategy while another logical holder exists. */
  const captured = context
    ? { keys: context.lock ?? [], identities: readConcurrencyLockIdentities(context) }
    : snapshotConcurrencyLockKeys(keys, SqliteNames.backend)
  const assertAvailable = (): void => {
    let conflict = guard ? sqliteRangeConflict(organization, orgId, guard, context) : undefined
    if (!conflict && captured.keys.length) {
      if (organization.wal) {
        for (const [index, id] of captured.identities.entries()) {
          const row = sqliteLockRow(organization, orgId, id)
          if (
            row &&
            Number(row.expires_at) > Date.now() &&
            !(
              context !== undefined &&
              organization.expectedToken?.context === context &&
              row.attempt_token === organization.expectedToken.token &&
              row.owner === organization.controller.origin
            )
          ) {
            conflict = { keys: [captured.keys[index]!], holder: sqliteHolderOf(organization, row) }
            break
          }
        }
      } else {
        const held = sqliteLocalGroup(organization, orgId).locks.probe(
          captured.identities,
          undefined,
          context
        )
        if (held) conflict = { keys: [held.key], holder: held.holder }
      }
    }
    if (conflict) throw new SqliteLogicalConflict(conflict.keys, conflict.holder)
  }
  try {
    assertAvailable()
  } catch (error) {
    if (error instanceof SqliteLogicalConflict && context === undefined)
      throw new StorageContractError(StorageContractErrorCode.lockRejected, {
        backend: SqliteNames.backend,
        cause: error
      })
    throw error
  }
  /** No async attempt context is exposed; this native segment performs no waiting or callback. */
  const state = {
    orgId,
    baseline: new Map(),
    observed: observeKeys === undefined ? undefined : new Map(),
    changed: new Map(),
    expirations: new Map(),
    mode: 'immediate',
    failure: undefined,
    context,
    expiresAt:
      organization.expectedToken?.context === context
        ? organization.expectedToken?.expiresAt
        : undefined
  } satisfies INativeState
  /** Native cancellation or lease loss before commit still rolls back this short atomic write. */
  const assertAttempt = (): void => {
    throwIfAborted(context?.signal)
    if (state.expiresAt !== undefined && Date.now() >= state.expiresAt)
      throw new StorageContractError(StorageContractErrorCode.lockLost)
  }
  try {
    organization.statements.get(SqliteControl.begin).run()
    organization.physicalState.active = SQLITE_CONTROL_ACTIVE
  } catch (error) {
    throw normalizeSqliteFailure(error)
  }
  try {
    /** A competing process cannot insert a new lock row after this writer-side recheck. */
    assertAttempt()
    assertAvailable()
    const value = run(state)
    assertAttempt()
    try {
      organization.statements.get(SqliteControl.commit).run()
      organization.physicalState.active = undefined
      sqliteAdvanceRevisions(organization, state)
      committed?.()
    } catch (error) {
      throw normalizeSqliteFailure(error)
    }
    sqlitePublishChanges(organization, state)
    return value
  } catch (error) {
    return sqliteRollback(
      organization,
      error instanceof SqliteLogicalConflict && context === undefined
        ? new StorageContractError(StorageContractErrorCode.lockRejected, {
            backend: SqliteNames.backend,
            cause: error
          })
        : error
    )
  } finally {
    observeKeys?.(state)
  }
}
/** A root cursor owns its detached snapshot and cached terminal promises. */
class SqliteRecordCursor<TValue> {
  /** Original organization admission and observation stay authoritative. */
  readonly #organization: ISqliteOrganizationContext<TValue>
  /** Caller range mutations must not alter a deferred native read after an await. */
  readonly #range: IKeyRange | undefined
  /** Every advance retains the original root operation context. */
  readonly #ctx: IOperationContext | undefined
  /** One native snapshot is retained until exhaustion, return or disposal. */
  #rows: readonly ISqliteRow[] | undefined
  /** Native ordering and expiry skips advance this one position. */
  #position = 0
  /** Iteration-close observation counts only returned values. */
  #returnedCount = 0
  /** Iterator return retains its original stable settlement identity. */
  #returned: Promise<IteratorResult<[IStorageKey, TValue]>> | undefined
  /** Explicit and symbolic disposal share the original root cursor settlement. */
  #disposed: Promise<void> | undefined
  /** Capture only the caller range; native rows remain deferred. */
  constructor(
    organization: ISqliteOrganizationContext<TValue>,
    range: IKeyRange | undefined,
    ctx: IOperationContext | undefined
  ) {
    this.#organization = organization
    this.#range = snapshotKeyRange(range, SqliteNames.backend)
    this.#ctx = ctx
  }
  /** Release the buffer and unregister the same retained disposer once. */
  readonly dispose = (): Promise<void> => {
    if (this.#disposed) return this.#disposed
    this.#rows = []
    this.#organization.snapshots.delete(this.dispose)
    sqliteObserve(
      this.#organization,
      this.#organization.operationStages,
      'onStorageIterationClose',
      this.#returnedCount
    )
    return (this.#disposed = Promise.resolve())
  }
  /** Read or advance the snapshot inside the original root operation and expiry path. */
  #advance(
    orgId: string,
    observeKey: ((key: ILockKey) => void) | undefined,
    state: INativeState | undefined
  ): IteratorResult<[IStorageKey, TValue]> {
    if (this.#disposed) return { done: true, value: undefined }
    if (!this.#rows) {
      this.#rows = sqliteRecordRows(this.#organization, orgId, this.#range, state)
      this.#organization.snapshots.add(this.dispose)
    }
    while (this.#position < this.#rows.length) {
      const row = this.#rows[this.#position++]!
      const key = decodeKey(row.key as Uint8Array)
      observeKey?.(lockKey.record(key))
      if (state) sqliteRevision(this.#organization, state, 'record', key)
      if (!sqliteLiveExpiration(this.#organization, 'record', key, row.expires_at, state)) {
        if (state) sqlitePrune(this.#organization, 'record', key, state)
        else
          sqliteSyncMutation(
            this.#organization,
            (current) => sqlitePrune(this.#organization, 'record', key, current),
            [],
            undefined,
            orgId
          )
        continue
      }
      this.#returnedCount++
      return {
        done: false,
        value: [key, sqliteConvert(this.#organization, 'record', 'decode', row.value) as TValue]
      }
    }
    void this.dispose()
    return { done: true, value: undefined }
  }
  /** Keep own iterator callbacks and preserve the original root-next admission behavior. */
  open(): IStorageIterator<[IStorageKey, TValue]> {
    return {
      next: () =>
        sqliteRootRead(
          this.#organization,
          SqliteOperation.next,
          { range: this.#range },
          this.#ctx,
          (orgId, _input, observeKey, state) => this.#advance(orgId, observeKey, state)
        ).catch((error) => {
          void this.dispose()
          throw error
        }),
      return: () =>
        (this.#returned ??= this.dispose().then(() => ({ done: true, value: undefined }))),
      dispose: this.dispose,
      [asyncDisposeKey]: () => this.dispose(),
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }
}
/** Root iterators own one named detached snapshot and no persistent native cursor. */
export function sqliteIterator<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  range?: IKeyRange,
  ctx?: IOperationContext
): IStorageIterator<[IStorageKey, TValue]> {
  return new SqliteRecordCursor(organization, range, ctx).open()
}

/** Original observation remains report-only for thrown errors and rejected promises. */
export function sqliteObserve<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  observer: object | undefined,
  name: string,
  ...args: unknown[]
): void {
  if (!observer) return
  const handlers = observer as Record<string, (...args: unknown[]) => unknown>
  try {
    if (typeof handlers[name] !== 'function') return
    const result = handlers[name](...args)
    void Promise.resolve(result).catch((error) => reportCleanupError(organization.report, error))
  } catch (error) {
    reportCleanupError(organization.report, error)
  }
}
/** Persisted targets restore only original channels and the original flat metadata key codec. */
export function sqliteTargetKey<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  target: IStorageJournalTarget
): { channel: IChannel; key: IStorageKey } {
  if (target.channel === 'vector' || target.channel === 'rdf')
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: SqliteNames.backend
    })
  const key = target.channel === 'metadata' ? decodeFlatStorageKey(target.key) : target.key
  if (key === undefined || (target.channel === 'metadata' && typeof key !== 'string'))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return { channel: target.channel, key }
}
/** Final mirrors are read from the same native writer after all accepted operation finalizers. */
export function sqliteJournalChanges<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  state: INativeState
): readonly IStorageJournalChange[] {
  if (state.journalChanges !== undefined) return state.journalChanges
  if (state.changed.size === 0) return []
  const changes: IStorageJournalChange[] = []
  for (const step of state.journalSteps ?? []) {
    const { channel, key } = sqliteTargetKey(organization, step.target)
    const first = state.journalBefore!.get(sqliteIdentity(organization, channel, key))!
    if (!first.before.present && !first.current.present) continue
    const current = sqliteCurrentRevision(
      organization,
      state,
      channel,
      sqliteRevisionIdentity(organization, channel, key)
    )
    changes.push({
      ...step,
      afterRevision: {
        birth: current.birth ?? null,
        version: current.version + (organization.wal ? 0 : 1)
      }
    })
  }
  return (state.journalChanges = changes)
}
/** Marker cleanup joins this exact already-committed physical admission or its original runner. */
export async function sqliteMarker<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  txId: string,
  invoke: (state: INativeState) => R
): Promise<R> {
  if (typeof txId !== 'string' || txId.length === 0)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  const active = organization.physicalState.active
  if (
    active &&
    active !== SQLITE_CONTROL_ACTIVE &&
    active.orgId === organization.runtime.orgId &&
    active.committedTxId === txId
  )
    return invoke(active)
  return sqliteTransact(
    organization,
    (scope) => invoke(sqliteJournalScope(organization, scope).state),
    {},
    false
  )
}
