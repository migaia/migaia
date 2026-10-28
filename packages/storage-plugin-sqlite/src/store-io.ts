// Row conversion, reads, TTL expiration and raw writes for the SQLite store (see ./store.ts).
import {
  encodeOrderedStorageKey,
  snapshotStorageTtlTarget,
  lockKey,
  assertKeyRange
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStorageTtlTarget,
  type IStorageKey,
  type ITtlTarget,
  type IKeyRange,
  type ILockKey
} from '@migaia/storage-contract'
import type { ICollectionsCodecValue } from '@migaia/serialize/codecs/collections-json'
import { SqliteNames } from './constants.ts'
import { sqliteError } from './errors.ts'
import { SqliteErrorCode } from '@migaia/storage-contract/error-code'
import { decodeKey, decodeHexKey } from './key-codec.ts'
import type { ISqliteRow, ISqliteValue } from './types.ts'
import { sqliteObserve, sqliteSyncMutation } from './store-mutation.ts'
import {
  sqliteRevisionKey,
  sqliteRevision,
  sqliteEncoded,
  sqliteChanged,
  sqliteIdentity
} from './store-revision.ts'
import { sqliteStatement } from './store-state.ts'
import type {
  ISqliteOrganizationContext,
  IChannel,
  INativeState,
  ISqliteTtlTarget
} from './store-state.ts'

/** Actual codec calls share one failure policy for roots, scopes and iterator advances. */
export function sqliteConvert<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  direction: 'encode' | 'decode',
  value: unknown,
  scope?: object
): unknown {
  const observer = scope ? organization.codecStages.forTransaction(scope) : organization.codecStages
  const codec = channel === 'text' ? organization.textCodec : organization.recordCodec
  const operation = channel
  sqliteObserve(
    organization,
    observer,
    direction === 'encode' ? 'beforeEncode' : 'beforeDecode',
    operation,
    codec.id
  )
  try {
    const result =
      direction === 'encode'
        ? channel === 'text'
          ? organization.textCodec.encode(value as string)
          : organization.recordCodec.encode(value as ICollectionsCodecValue)
        : codec.decode(value as string)
    sqliteObserve(
      organization,
      observer,
      direction === 'encode' ? 'afterEncode' : 'afterDecode',
      operation,
      codec.id
    )
    return result
  } catch (cause) {
    sqliteObserve(
      organization,
      observer,
      direction === 'encode' ? 'onEncodeError' : 'onDecodeError',
      operation,
      codec.id,
      (cause as { code?: unknown })?.code
    )
    if (direction === 'decode') throw sqliteError(SqliteErrorCode.decodeFailed, cause)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend,
      cause
    })
  }
}
/** Read live data in the current native snapshot; expired data is treated as absent. */
export function sqliteRead<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey,
  orgId: string,
  state?: INativeState,
  scope?: object,
  observeKey?: (key: ILockKey) => void
): unknown {
  if (channel !== 'metadata') observeKey?.(sqliteRevisionKey(organization, channel, key))
  if (state) sqliteRevision(organization, state, channel, key)
  const row = sqliteStatement<TValue, ISqliteRow | undefined>(
    organization,
    `SELECT value${channel === 'metadata' ? '' : ',expires_at'} FROM ${organization.tables[channel]} WHERE org_id=? AND key=?`,
    [orgId, sqliteEncoded(organization, channel, key)],
    'get',
    state
  )
  if (
    row &&
    channel !== 'metadata' &&
    !sqliteLiveExpiration(organization, channel, key, row.expires_at, state)
  ) {
    if (state) sqlitePrune(organization, channel, key, state)
    else
      sqliteSyncMutation(
        organization,
        (current) => sqlitePrune(organization, channel, key, current),
        [],
        undefined,
        orgId
      )
    return channel === 'text' || channel === 'bytes' ? null : undefined
  }
  if (!row) return channel === 'text' || channel === 'bytes' ? null : undefined
  return channel === 'bytes'
    ? (row.value as Uint8Array).slice()
    : sqliteConvert(organization, channel, 'decode', row.value, scope)
}
/** Expired cross-channel rows are reclaimed inside the same original native write transaction. */
export function sqlitePrune<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey,
  state: INativeState
): void {
  if (channel === 'metadata') return
  sqliteRevision(organization, state, channel, key)
  const result = sqliteStatement<TValue, { changes: number | bigint }>(
    organization,
    `DELETE FROM ${organization.tables[channel]} WHERE org_id=? AND key=? AND expires_at IS NOT NULL AND expires_at<=?`,
    [state.orgId, sqliteEncoded(organization, channel, key), Date.now()],
    'run',
    state
  )
  if (result.changes !== 0 && result.changes !== 0n)
    sqliteChanged(organization, state, channel, key)
}
/** First live reads retain the native snapshot's deadline until the original attempt commits. */
export function sqliteLiveExpiration<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: Exclude<IChannel, 'metadata'>,
  key: IStorageKey,
  expiresAt: ISqliteValue | undefined,
  state?: INativeState,
  now = Date.now()
): boolean {
  if (expiresAt == null) return true
  /** The existing revision identity owns this attempt-local observation as well. */
  const id = sqliteIdentity(organization, channel, key)
  const deadline = Number(expiresAt)
  const observed = state?.expirations.get(id)
  if (observed?.deadline === deadline && !state!.changed.get(channel)?.has(id)) return true
  if (deadline <= now) return false
  if (state && !observed && !state.changed.get(channel)?.has(id)) {
    const target =
      channel === 'text'
        ? lockKey.text(key)
        : channel === 'bytes'
          ? lockKey.bytes(key as string)
          : lockKey.record(key)
    state.expirations.set(id, { target, deadline })
  }
  return true
}
/**
 * SqliteCleanupExpiredRows uses explicit organization state and the original native execution
 * owner.
 */
export function sqliteCleanupExpiredRows<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: 'text' | 'record',
  orgId: string,
  range?: IKeyRange,
  state?: INativeState
): void {
  /** One local wall-clock cutoff keeps every candidate in this cleanup operation consistent. */
  const clauses = ['org_id=?', 'expires_at IS NOT NULL', 'expires_at<=?']
  const values: ISqliteValue[] = [orgId, Date.now()]
  if (range?.lower !== undefined) {
    clauses.push(`key${range.lowerOpen ? '>' : '>='}?`)
    values.push(sqliteEncoded(organization, channel, range.lower))
  }
  if (range?.upper !== undefined) {
    clauses.push(`key${range.upperOpen ? '<' : '<='}?`)
    values.push(sqliteEncoded(organization, channel, range.upper))
  }
  /** The native index returns actual expiry candidates without scanning unrelated organizations. */
  const rows = sqliteStatement<TValue, readonly ISqliteRow[]>(
    organization,
    `SELECT key FROM ${organization.tables[channel]} WHERE ${clauses.join(' AND ')}`,
    values,
    'all',
    state
  )
  if (rows.length === 0) return
  /** The original writer rechecks each deadline so a fresh replacement cannot be removed. */
  const reclaim = (current: INativeState): void => {
    for (const row of rows) {
      const key =
        channel === 'record' ? decodeKey(row.key as Uint8Array) : decodeHexKey(row.key as string)
      const id = sqliteIdentity(organization, channel, key)
      if (state?.expirations.has(id) && !state.changed.get(channel)?.has(id)) continue
      sqlitePrune(organization, channel, key, current)
    }
  }
  if (state) reclaim(state)
  else sqliteSyncMutation(organization, reclaim, [], undefined, orgId)
}
/** TTL channel support adds only this backend's capability boundary to the canonical pure guard. */
export function sqliteAssertTtlTarget(input: ITtlTarget): asserts input is ISqliteTtlTarget {
  assertStorageTtlTarget(input, SqliteNames.backend)
  if (input.channel !== 'text' && input.channel !== 'bytes' && input.channel !== 'record')
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: SqliteNames.backend
    })
}
/** Capture target keys before middleware, logical locks or physical admission can await. */
export function sqliteCaptureTtlTarget(input: ITtlTarget): ISqliteTtlTarget {
  sqliteAssertTtlTarget(input)
  return snapshotStorageTtlTarget(input, SqliteNames.backend) as ISqliteTtlTarget
}
/** Deadline reads and writes share the original attempt's first live native observation. */
export function sqliteExpiration<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  target: ISqliteTtlTarget,
  orgId: string,
  state?: INativeState
): ISqliteRow | undefined {
  if (state) sqliteRevision(organization, state, target.channel, target.key)
  const row = sqliteStatement<TValue, ISqliteRow | undefined>(
    organization,
    `SELECT expires_at FROM ${organization.tables[target.channel]} WHERE org_id=? AND key=?`,
    [orgId, sqliteEncoded(organization, target.channel, target.key)],
    'get',
    state
  )
  if (
    row &&
    !sqliteLiveExpiration(organization, target.channel, target.key, row.expires_at, state)
  ) {
    if (state) sqlitePrune(organization, target.channel, target.key, state)
    else
      sqliteSyncMutation(
        organization,
        (current) => sqlitePrune(organization, target.channel, target.key, current),
        [],
        undefined,
        orgId
      )
    return undefined
  }
  return row
}
/** TTL updates share the original native mutation, revision and commit notification owners. */
export function sqliteChangeDeadline<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  target: ISqliteTtlTarget,
  state: INativeState,
  ms?: number
): boolean {
  const row = sqliteExpiration(organization, target, state.orgId, state)
  if (!row || (ms === undefined && row.expires_at === null)) return false
  if (ms === 0) return sqliteRemove(organization, target.channel, target.key, state)
  sqliteStatement(
    organization,
    `UPDATE ${organization.tables[target.channel]} SET expires_at=? WHERE org_id=? AND key=?`,
    [
      ms === undefined ? null : Date.now() + ms,
      state.orgId,
      sqliteEncoded(organization, target.channel, target.key)
    ],
    'run',
    state
  )
  sqliteChanged(organization, state, target.channel, target.key)
  return true
}
/** One native write preserves atomic replace across all public channels. */
export function sqliteWrite<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey,
  value: unknown,
  state: INativeState,
  policy: 'conflict' | 'replace',
  scope?: object,
  ttlMs?: number
): void {
  /** Encode before any table mutation, including expiry cleanup and cross-channel removal. */
  const raw =
    channel === 'bytes'
      ? (value as Uint8Array)
      : (sqliteConvert(organization, channel, 'encode', value, scope) as string)
  sqliteWriteRaw(organization, channel, key, raw, state, policy, ttlMs)
}
/** Prepared values cannot invoke caller code between final lock admission and native mutation. */
export function sqliteWriteRaw<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey,
  raw: string | Uint8Array,
  state: INativeState,
  policy: 'conflict' | 'replace',
  ttlMs?: number
): void {
  sqliteRevision(organization, state, channel, key)
  if (channel !== 'metadata') {
    for (const other of ['text', 'bytes', 'record'] as const) {
      if (other === 'bytes' && typeof key !== 'string') continue
      sqlitePrune(organization, other, key, state)
      if (other === channel) continue
      const present = sqliteStatement<TValue, ISqliteRow | undefined>(
        organization,
        `SELECT key FROM ${organization.tables[other]} WHERE org_id=? AND key=?`,
        [state.orgId, sqliteEncoded(organization, other, key)],
        'get',
        state
      )
      if (present) {
        if (policy !== 'replace') throw sqliteError(SqliteErrorCode.duplicateKey)
        sqliteRevision(organization, state, other, key)
        sqliteStatement(
          organization,
          `DELETE FROM ${organization.tables[other]} WHERE org_id=? AND key=?`,
          [state.orgId, sqliteEncoded(organization, other, key)],
          'run',
          state
        )
        sqliteChanged(organization, state, other, key)
      }
    }
  }
  sqliteStatement(
    organization,
    `INSERT INTO ${organization.tables[channel]}(org_id,key,value${channel === 'metadata' ? '' : ',expires_at'}) VALUES(?,?,?${channel === 'metadata' ? '' : ',?'}) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value${channel === 'metadata' ? '' : `,expires_at=${ttlMs === undefined ? `${organization.tables[channel]}.expires_at` : 'excluded.expires_at'}`}`,
    [
      state.orgId,
      sqliteEncoded(organization, channel, key),
      raw as ISqliteValue,
      ...(channel === 'metadata' ? [] : [ttlMs === undefined ? null : Date.now() + ttlMs])
    ],
    'run',
    state
  )
  sqliteChanged(organization, state, channel, key)
}
/** Single deletes mutate only their own channel and retain real affected-key revisions. */
export function sqliteRemove<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey,
  state: INativeState
): boolean {
  sqliteRevision(organization, state, channel, key)
  const result = sqliteStatement<TValue, { changes: number | bigint }>(
    organization,
    `DELETE FROM ${organization.tables[channel]} WHERE org_id=? AND key=?`,
    [state.orgId, sqliteEncoded(organization, channel, key)],
    'run',
    state
  )
  const mutated = result.changes !== 0 && result.changes !== 0n
  if (mutated) sqliteChanged(organization, state, channel, key)
  return mutated
}
/** Native ordered scans preserve the BLOB primary-key order without a JavaScript sort. */
export function sqliteRecordRows<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  orgId: string,
  range?: IKeyRange,
  state?: INativeState
): readonly ISqliteRow[] {
  /** Native execution is synchronous; the existing range validator needs no second copy. */
  assertKeyRange(range, SqliteNames.backend)
  const captured = range
  sqliteCleanupExpiredRows(organization, 'record', orgId, captured, state)
  const clauses = ['org_id=?', ...(state ? [] : ['(expires_at IS NULL OR expires_at>?)'])]
  const values: ISqliteValue[] = [orgId, ...(state ? [] : [Date.now()])]
  if (captured?.lower !== undefined) {
    clauses.push(`key${captured.lowerOpen ? '>' : '>='}?`)
    values.push(encodeOrderedStorageKey(captured.lower, SqliteNames.backend))
  }
  if (captured?.upper !== undefined) {
    clauses.push(`key${captured.upperOpen ? '<' : '<='}?`)
    values.push(encodeOrderedStorageKey(captured.upper, SqliteNames.backend))
  }
  return sqliteStatement(
    organization,
    `SELECT key,value,expires_at FROM ${organization.tables.record} WHERE ${clauses.join(' AND ')} ORDER BY key`,
    values,
    'all',
    state
  )
}
