// Lock identities, revisions and journal capture for the SQLite store (see ./store.ts).
import {
  snapshotStorageKey,
  encodeOrderedStorageKey,
  snapshotConcurrencyLockKeys,
  lockKey,
  encodeFlatStorageKey
} from '@migaia/storage-host/sdk'
import type { IStorageKey, ILockKey } from '@migaia/storage-contract'
import { bytesToBase64 } from '@migaia/utils/bytes'
import type { IStorageJournalImage, IStorageJournalTarget } from '@migaia/storage-host'
import type { ICollectionsCodecValue } from '@migaia/serialize/codecs/collections-json'
import { SqliteNames } from './constants.js'
import { sqliteError } from './errors.js'
import { SqliteErrorCode } from '@migaia/storage-contract/error-code'
import { SqliteErrorText } from './error-text.js'
import { decodeHexKey, keyHex } from './key-codec.js'
import type { ISqliteRow } from './types.js'
import { sqliteLocalGroup, sqliteStatement } from './store-state.js'
import type {
  ISqliteOrganizationContext,
  IChannel,
  INativeState,
  ISqliteRevision
} from './store-state.js'

/** Bind one logical key to the existing physical table representation. */
export function sqliteEncoded<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey
): string | Uint8Array {
  const bytes = encodeOrderedStorageKey(key, SqliteNames.backend)
  return channel === 'record' ? bytes : keyHex(bytes)
}
/** Revision keys reuse the canonical original channel identity rather than another key format. */
export function sqliteIdentity<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey
): string {
  return channel === 'metadata'
    ? keyHex(encodeOrderedStorageKey(key, SqliteNames.backend))
    : snapshotConcurrencyLockKeys([{ channel, key }], SqliteNames.backend).identities[0]!
}
/** Native diagnostics recognize the channel through original bounds without copying rank tags. */
export function sqliteIdentityRange<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  id: string
) {
  const range = organization.channelRanges.find(({ lower, upper }) => id >= lower && id < upper)
  if (!range)
    throw sqliteError(SqliteErrorCode.decodeFailed, new Error(SqliteErrorText.malformedKey))
  return range
}
/**
 * SqliteDecodeLockIdentity uses explicit organization state and the original native execution
 * owner.
 */
export function sqliteDecodeLockIdentity<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  id: string
): ILockKey {
  const range = sqliteIdentityRange(organization, id)
  const captured = snapshotConcurrencyLockKeys(
    [{ channel: range.channel, key: decodeHexKey(id.slice(range.lower.length)) }],
    SqliteNames.backend
  )
  if (captured.identities[0] !== id)
    throw sqliteError(SqliteErrorCode.decodeFailed, new Error(SqliteErrorText.malformedKey))
  return captured.keys[0]!
}
/** Metadata borrows one original record guard; ordinary business keys keep their exact identity. */
export function sqliteRevisionKey<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey
): ILockKey {
  return channel === 'metadata'
    ? lockKey.record([SqliteNames.metadata, key])
    : channel === 'text'
      ? lockKey.text(key)
      : channel === 'bytes'
        ? lockKey.bytes(key as string)
        : lockKey.record(key)
}
/** The canonical lock owner supplies the single revision identity for every protected target. */
export function sqliteRevisionIdentity<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey
): string {
  return snapshotConcurrencyLockKeys(
    [sqliteRevisionKey(organization, channel, key)],
    SqliteNames.backend
  ).identities[0]!
}
/** Native row births and original local group births are the only revision owners. */
export function sqliteCurrentRevision<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  state: INativeState,
  channel: IChannel,
  id: string
): ISqliteRevision {
  if (!organization.wal) {
    const current = sqliteLocalGroup(organization, state.orgId)
    return {
      version: current.revisions.read(channel === 'metadata' ? 'record' : channel, id),
      birth: current.birth
    }
  }
  const row = sqliteStatement<TValue, ISqliteRow | undefined>(
    organization,
    'SELECT revision,birth FROM ' + organization.tables.revisions + ' WHERE org_id=? AND key=?',
    [state.orgId, id],
    'get',
    state
  )
  if (row !== undefined && typeof row.birth !== 'string')
    throw sqliteError(SqliteErrorCode.decodeFailed)
  return { version: Number(row?.revision ?? 0), birth: row?.birth as string | undefined }
}
/** The original native raw row and absolute deadline form one opaque canonical codec image. */
export function sqliteJournalImage<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  state: INativeState,
  channel: IChannel,
  key: IStorageKey
): IStorageJournalImage {
  const row = sqliteStatement<TValue, ISqliteRow | undefined>(
    organization,
    'SELECT value' +
      (channel === 'metadata' ? '' : ',expires_at') +
      ' FROM ' +
      organization.tables[channel] +
      ' WHERE org_id=? AND key=?',
    [state.orgId, sqliteEncoded(organization, channel, key)],
    'get',
    state
  )
  return row === undefined
    ? { present: false }
    : {
        present: true,
        value: organization.recordCodec.encode({
          version: 1,
          channel,
          value: channel === 'bytes' ? bytesToBase64(row.value as Uint8Array) : row.value,
          deadline: channel === 'metadata' ? null : row.expires_at
        } as ICollectionsCodecValue)
      }
}
/** Only selected attempts retain first-before images, using the existing physical key codec. */
function sqliteCaptureJournal<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  state: INativeState,
  channel: IChannel,
  key: IStorageKey
): void {
  if (state.journalBefore === undefined) return
  const id = sqliteIdentity(organization, channel, key)
  if (state.journalBefore.has(id)) return
  /** Journal targets survive operation resolution until the enclosing transaction commits. */
  const target: IStorageJournalTarget =
    channel === 'metadata'
      ? { channel, key: encodeFlatStorageKey(key) }
      : sqliteRevisionKey(organization, channel, snapshotStorageKey(key, SqliteNames.backend))
  const before = sqliteJournalImage(organization, state, channel, key)
  state.journalBefore.set(id, { target, before, current: before })
}
/** First observations survive only original physical recovery, not a strategy retry. */
export function sqliteRevision<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  state: INativeState,
  channel: IChannel,
  key: IStorageKey
): void {
  sqliteCaptureJournal(organization, state, channel, key)
  const id = sqliteRevisionIdentity(organization, channel, key)
  if (channel !== 'metadata') state.observed?.set(id, sqliteRevisionKey(organization, channel, key))
  if (!state.baseline.has(id))
    state.baseline.set(id, sqliteCurrentRevision(organization, state, channel, id))
}
/** Every real mutation is tracked once for revision updates and post-commit publication. */
export function sqliteChanged<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  state: INativeState,
  channel: IChannel,
  key: IStorageKey
): void {
  sqliteRevision(organization, state, channel, key)
  let keys = state.changed.get(channel)
  if (!keys) {
    keys = new Map()
    state.changed.set(channel, keys)
  }
  const id = sqliteIdentity(organization, channel, key)
  // putRecord returns the admitted key before transaction commit; the publication ledger owns its copy.
  if (!keys.has(id)) keys.set(id, snapshotStorageKey(key, SqliteNames.backend))
  if (organization.wal)
    sqliteStatement(
      organization,
      `INSERT INTO ${organization.tables.revisions}(org_id,key,revision,birth) VALUES(?,?,1,lower(hex(randomblob(16)))) ON CONFLICT(org_id,key) DO UPDATE SET revision=revision+1`,
      [state.orgId, sqliteRevisionIdentity(organization, channel, key)],
      'run',
      state
    )
  const first = state.journalBefore?.get(id)
  if (first !== undefined) {
    const after = sqliteJournalImage(organization, state, channel, key)
    state.journalSteps!.push({ target: first.target, before: first.current, after })
    first.current = after
  }
}
/** The shared revision owner advances in the same synchronous turn as successful native COMMIT. */
export function sqliteAdvanceRevisions<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  state: INativeState
): void {
  if (organization.wal) return
  for (const [channel, keys] of state.changed)
    for (const key of keys.values())
      sqliteLocalGroup(organization, state.orgId).revisions.write(
        channel === 'metadata' ? 'record' : channel,
        sqliteRevisionIdentity(organization, channel, key)
      )
}
/** One successful native COMMIT owns all ordinary and expiry change publication. */
export function sqlitePublishChanges<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  state: INativeState
): void {
  for (const channel of ['text', 'bytes', 'record'] as const) {
    const keys = state.changed.get(channel)
    if (!keys?.size) continue
    organization.controller.publish({
      channel: channel === 'text' ? 'value' : channel,
      kind: 'batch',
      keys: [...keys.values()],
      orgId: state.orgId
    })
  }
}
