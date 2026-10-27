import {
  snapshotStorageKey,
  snapshotStorageKeyPrefix,
  snapshotConcurrencyLockKeys,
  lockKey
} from '@migaia/storage-host/sdk'
import {
  type IStorageKey,
  type IStorageBatchKey,
  type ILockKey,
  type IKeyRange,
  type IOperationContext,
  type ISqlValue,
  type ISqlRow
} from '@migaia/storage-contract'
import type { IPgConnection, IPgNativeParameter } from './types.js'
import type { IPgTables } from './schema.js'
import { pgKey, pgKeyHex, pgRecordKey, pgTextKey } from './codec.js'
import { postgresError } from './errors.js'
import { PostgresErrorCode } from './error-code.js'
import { PgNames } from './constants.js'
/** These channels are real physical tables, rather than a second public data model. */
export type IPgChannel = 'text' | 'bytes' | 'record' | 'metadata'
/** Selected native vectors share the original revision ledger without a fixed data table. */
export type IPgMutationChannel = IPgChannel | 'vector'
/** A row's immutable native birth survives ordinary updates and distinguishes drop/recreation. */
export type IPgRevision = { readonly version: bigint; readonly birth: string | undefined }
/** An original native attempt retains observations only until its real COMMIT or ROLLBACK. */
export type IPgState = {
  /** Complete journal facts belong only to this original native attempt. */
  journal?: import('./journal.js').IPgJournalCapture
  /** Native terminal listeners have no independent commit or admission authority. */
  readonly terminal: {
    readonly committed: Set<() => void>
    readonly rolledBack: Set<() => void>
    /** Resource completion is distinct from a proved commit or rollback outcome. */
    readonly ended: Set<() => void>
    settled: boolean
  }
  readonly codecs: ReturnType<typeof import('./codec.js').createPgCodecs>
  readonly client: IPgConnection
  readonly orgId: string
  readonly ctx: IOperationContext | undefined
  readonly baseline: Map<string, IPgRevision>
  readonly observed: Map<string, ILockKey>
  readonly changed: Map<IPgMutationChannel, Map<string, IStorageKey>>
  readonly expirations: Map<string, number>
  readonly guardKeys: (keys: readonly ILockKey[]) => Promise<void>
  readonly guardRange: (
    channel: Exclude<IPgChannel, 'metadata'>,
    prefix?: IStorageKey
  ) => Promise<void>
  failure: unknown
}
/** Channel labels distinguish revision tombstones while key bytes keep the sole canonical identity. */
export function pgIdentity(channel: IPgMutationChannel, key: IStorageKey): string {
  /** Canonical lock projection owns channel identity encoding; this is not another input snapshot. */
  return channel === 'metadata'
    ? PgNames.metadataRevisionPrefix + pgKey(key).hex
    : snapshotConcurrencyLockKeys([pgLockKey(channel, key)], PgNames.backend).identities[0]!
}
/** The three user channels retain the original finite lock-key constructors. */
export function pgLockKey(channel: IPgMutationChannel, key: IStorageKey): ILockKey {
  if (channel === 'metadata') return lockKey.record([PgNames.metadataLockNamespace, key])
  if (channel === 'vector') {
    if (
      !Array.isArray(key) ||
      key.length !== 2 ||
      typeof key[0] !== 'string' ||
      typeof key[1] !== 'string'
    )
      throw postgresError(PostgresErrorCode.decodeFailed)
    return lockKey.vector(key[0], key[1])
  }
  return channel === 'text'
    ? lockKey.text(key)
    : channel === 'bytes'
      ? lockKey.bytes(key as string)
      : lockKey.record(key)
}
/** Native key binding changes presentation only for the bytea record primary key. */
function encoded(channel: IPgChannel, key: IStorageKey): ISqlValue {
  const captured = pgKey(key)
  return channel === 'record' ? captured.bytes : captured.hex
}
/** Absent revisions remain zero; persisted rows require their complete native birth identity. */
function revision(row: ISqlRow | undefined): IPgRevision {
  if (row === undefined) return { version: 0n, birth: undefined }
  if (typeof row.version !== 'bigint' || typeof row.birth !== 'string')
    throw postgresError(PostgresErrorCode.decodeFailed)
  return { version: row.version, birth: row.birth }
}
/** Original bounded native reads serve point/batch observation, recovery and journal mirrors. */
export async function readPgRevisionRows(
  state: IPgState,
  tables: IPgTables,
  identities: readonly string[],
  forUpdate = false
): Promise<ReadonlyMap<string, IPgRevision>> {
  if (identities.length === 0) return new Map()
  /** Only these original identities are read; birth is returned as portable text by native SQL. */
  const rows = (
    await state.client.query(
      'SELECT key,version,birth::text AS birth FROM ' +
        tables.revisions +
        ' WHERE org_id=$1 AND key=ANY($2::text[])' +
        (forUpdate ? ' ORDER BY key FOR UPDATE' : ''),
      [state.orgId, { arrayType: 'text', values: identities }],
      state.ctx
    )
  ).rows
  return new Map(
    rows.flatMap((row) => (typeof row.key === 'string' ? [[row.key, revision(row)] as const] : []))
  )
}
/** One existing row-creation statement owns immutable birth allocation, including metadata. */
export async function preparePgRevisionRows(
  state: IPgState,
  tables: IPgTables,
  identities: readonly string[]
): Promise<void> {
  if (identities.length === 0) return
  await state.client.query(
    'INSERT INTO ' +
      tables.revisions +
      ' (org_id,key,version) SELECT $1,key,0 FROM unnest($2::text[]) AS key ORDER BY key ON CONFLICT(org_id,key) DO NOTHING',
    [state.orgId, { arrayType: 'text', values: identities }],
    state.ctx
  )
}
/** A missing first observation permits this attempt's own zero row; existing births never reset. */
function sameRevision(expected: IPgRevision, actual: IPgRevision | undefined): boolean {
  return (
    expected.version === (actual?.version ?? 0n) &&
    (expected.birth === undefined || expected.birth === actual?.birth)
  )
}
/** A point's first complete observation survives physical recovery; own writes never advance it. */
export async function observePgRevision(
  state: IPgState,
  tables: IPgTables,
  channel: IPgMutationChannel,
  key: IStorageKey
): Promise<void> {
  await state.journal?.capture(channel, [key])
  const identity = pgIdentity(channel, key)
  if (!state.baseline.has(identity)) {
    state.baseline.set(
      identity,
      (await readPgRevisionRows(state, tables, [identity])).get(identity) ?? revision(undefined)
    )
    state.observed.set(identity, pgLockKey(channel, key))
  }
}
/** A range retains the same complete original epoch row rather than a full result set. */
export async function observePgRange(
  state: IPgState,
  tables: IPgTables,
  channel: Exclude<IPgMutationChannel, 'metadata'>
): Promise<void> {
  const identity = channel + ':*'
  if (!state.baseline.has(identity))
    state.baseline.set(
      identity,
      (await readPgRevisionRows(state, tables, [identity])).get(identity) ?? revision(undefined)
    )
}
/** Only actual affected rows contribute to revisions and after-commit invalidation. */
export function markPgChanged(
  state: IPgState,
  channel: IPgMutationChannel,
  key: IStorageKey,
  after?: ISqlRow
): void {
  let changed = state.changed.get(channel)
  if (!changed) {
    changed = new Map()
    state.changed.set(channel, changed)
  }
  /**
   * PutRecord returns its compound key before the transaction awaits commit; retain an independent
   * ledger key.
   */
  changed.set(pgKey(key).hex, snapshotStorageKey(key, PgNames.backend))
  state.journal?.stage(channel, key, after)
}
/** Expiry cleanup is a real write in the same native transaction, leaving the original tombstone. */
export async function prunePg(
  state: IPgState,
  tables: IPgTables,
  channel: IPgChannel,
  key: IStorageKey
): Promise<void> {
  if (channel === 'metadata') return
  await observePgRevision(state, tables, channel, key)
  const expired =
    (
      await state.client.query(
        'SELECT key FROM ' +
          tables[channel] +
          ' WHERE org_id=$1 AND key=$2 AND expires_at<=clock_timestamp()',
        [state.orgId, encoded(channel, key)],
        state.ctx
      )
    ).rows.length !== 0
  if (!expired) return
  await state.guardKeys([pgLockKey(channel, key)])
  const result = await state.client.query(
    'DELETE FROM ' +
      tables[channel] +
      ' WHERE org_id=$1 AND key=$2 AND expires_at<=clock_timestamp() RETURNING key',
    [state.orgId, encoded(channel, key)],
    state.ctx
  )
  if (result.rowCount !== 0) markPgChanged(state, channel, key)
}
/** Reads use the database clock and the canonical codec, never PostgreSQL JSON coercion. */
export async function readPg(
  state: IPgState,
  tables: IPgTables,
  channel: IPgChannel,
  key: IStorageKey
): Promise<unknown> {
  await prunePg(state, tables, channel, key)
  const row = (
    await state.client.query(
      'SELECT value' +
        (channel === 'metadata' ? '' : ',extract(epoch FROM expires_at)*1000 AS deadline') +
        ' FROM ' +
        tables[channel] +
        ' WHERE org_id=$1 AND key=$2' +
        (channel === 'metadata' ? '' : ' AND (expires_at IS NULL OR expires_at>clock_timestamp())'),
      [state.orgId, encoded(channel, key)],
      state.ctx
    )
  ).rows[0]
  if (!row) return channel === 'text' || channel === 'bytes' ? null : undefined
  if (channel !== 'metadata' && row.deadline !== null && row.deadline !== undefined)
    state.expirations.set(pgIdentity(channel, key), Number(row.deadline))
  if (channel === 'bytes') return row.value instanceof Uint8Array ? row.value.slice() : undefined
  return channel === 'text'
    ? state.codecs.decodeText(row.value)
    : state.codecs.decodeRecord(row.value)
}
/** Writes atomically resolve cross-channel identity, preserve live TTL, and retain portable bytes. */
export async function writePg(
  state: IPgState,
  tables: IPgTables,
  channel: IPgChannel,
  key: IStorageKey,
  value: unknown,
  policy: 'conflict' | 'replace',
  ttlMs?: number
): Promise<void> {
  const raw =
    channel === 'bytes'
      ? value instanceof Uint8Array
        ? value.slice()
        : value
      : channel === 'text'
        ? state.codecs.encodeText(value as string)
        : state.codecs.encodeRecord(value)
  if (channel !== 'metadata') {
    const affected = (['text', 'bytes', 'record'] as const).filter(
      (other) => other !== 'bytes' || typeof key === 'string'
    )
    for (const other of affected) await observePgRevision(state, tables, other, key)
    await state.guardKeys(affected.map((other) => pgLockKey(other, key)))
    for (const other of ['text', 'bytes', 'record'] as const) {
      if (other === 'bytes' && typeof key !== 'string') continue
      await prunePg(state, tables, other, key)
      if (other === channel) continue
      const present =
        (
          await state.client.query(
            'SELECT key FROM ' + tables[other] + ' WHERE org_id=$1 AND key=$2',
            [state.orgId, encoded(other, key)],
            state.ctx
          )
        ).rows.length !== 0
      if (present) {
        if (policy !== 'replace') throw postgresError(PostgresErrorCode.duplicateKey)
        await removePg(state, tables, other, key)
      }
    }
  }
  if (channel === 'metadata') {
    await observePgRevision(state, tables, channel, key)
    await state.guardKeys([pgLockKey(channel, key)])
  }
  const expiry = channel === 'metadata' ? '' : ',expires_at'
  const deadline =
    ttlMs === undefined ? 'NULL' : "clock_timestamp()+($4::float8*interval '1 millisecond')"
  const values: IPgNativeParameter[] = [
    state.orgId,
    encoded(channel, key),
    raw as ISqlValue,
    ...(ttlMs === undefined ? [] : [ttlMs])
  ]
  const written = await state.client.query(
    'INSERT INTO ' +
      tables[channel] +
      ' (org_id,key,value' +
      expiry +
      ') VALUES($1,$2,$3' +
      (channel === 'metadata' ? '' : ',' + deadline) +
      ') ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value' +
      (channel === 'metadata'
        ? ''
        : ',expires_at=' +
          (ttlMs === undefined ? tables[channel] + '.expires_at' : 'excluded.expires_at')) +
      (state.journal === undefined
        ? ''
        : ' RETURNING key,value' + (channel === 'metadata' ? '' : ',expires_at::text AS deadline')),
    values,
    state.ctx
  )
  markPgChanged(state, channel, key, written.rows[0])
}
/** Deleting an absent key is a no-op; actual deletions preserve their revision identity. */
export async function removePg(
  state: IPgState,
  tables: IPgTables,
  channel: IPgChannel,
  key: IStorageKey
): Promise<boolean> {
  await observePgRevision(state, tables, channel, key)
  await state.guardKeys([pgLockKey(channel, key)])
  const result = await state.client.query(
    'DELETE FROM ' + tables[channel] + ' WHERE org_id=$1 AND key=$2 RETURNING key',
    [state.orgId, encoded(channel, key)],
    state.ctx
  )
  if (result.rowCount !== 0) markPgChanged(state, channel, key)
  return result.rowCount !== 0
}
/** Native bytea range clauses are reused by bounded scans and native range deletion. */
export function pgRange(
  orgId: string,
  range: IKeyRange | undefined,
  after?: Uint8Array
): { readonly text: string; readonly params: IPgNativeParameter[] } {
  const clauses = ['org_id=$1']
  const params: IPgNativeParameter[] = [orgId]
  if (range?.lower !== undefined) {
    params.push(pgKey(range.lower).bytes)
    clauses.push('key' + (range.lowerOpen ? '>' : '>=') + '$' + params.length)
  }
  if (range?.upper !== undefined) {
    params.push(pgKey(range.upper).bytes)
    clauses.push('key' + (range.upperOpen ? '<' : '<=') + '$' + params.length)
  }
  if (after !== undefined) {
    params.push(after)
    clauses.push('key>$' + params.length)
  }
  return { text: clauses.join(' AND '), params }
}
/**
 * A page keeps the key index and output lower bound in PostgreSQL, without all-record
 * materialization.
 */
export async function scanPgRecords<T>(
  state: IPgState,
  tables: IPgTables,
  range: IKeyRange | undefined,
  after: Uint8Array | undefined,
  size: number
): Promise<
  readonly { readonly key: IStorageKey; readonly bytes: Uint8Array; readonly value: T }[]
> {
  await observePgRange(state, tables, 'record')
  const filter = pgRange(state.orgId, range, after)
  const expiredCandidates = (
    await state.client.query(
      'SELECT key FROM ' +
        tables.record +
        ' WHERE ' +
        filter.text +
        ' AND expires_at<=clock_timestamp()',
      filter.params,
      state.ctx
    )
  ).rows
  if (expiredCandidates.length !== 0)
    await observePgBatch(
      state,
      tables,
      'record',
      expiredCandidates.map((row) => pgRecordKey(row.key))
    )
  if (expiredCandidates.length !== 0)
    await state.guardKeys(expiredCandidates.map((row) => pgLockKey('record', pgRecordKey(row.key))))
  const expired = await state.client.query(
    'DELETE FROM ' +
      tables.record +
      ' WHERE ' +
      filter.text +
      ' AND expires_at<=clock_timestamp() RETURNING key',
    filter.params,
    state.ctx
  )
  for (const row of expired.rows) {
    const key = pgRecordKey(row.key)
    await observePgRevision(state, tables, 'record', key)
    markPgChanged(state, 'record', key)
  }
  const rows = (
    await state.client.query(
      'SELECT key,value,extract(epoch FROM expires_at)*1000 AS deadline FROM ' +
        tables.record +
        ' WHERE ' +
        filter.text +
        ' AND (expires_at IS NULL OR expires_at>clock_timestamp())' +
        ' ORDER BY key LIMIT $' +
        (filter.params.length + 1),
      [...filter.params, size],
      state.ctx
    )
  ).rows
  const result: { key: IStorageKey; bytes: Uint8Array; value: T }[] = []
  for (const row of rows) {
    const key = pgRecordKey(row.key)
    await observePgRevision(state, tables, 'record', key)
    if (row.deadline !== null && row.deadline !== undefined)
      state.expirations.set(pgIdentity('record', key), Number(row.deadline))
    result.push({ key, bytes: pgKey(key).bytes, value: state.codecs.decodeRecord<T>(row.value) })
  }
  return result
}
/** Full-channel operations use RETURNING and keep only actual output keys for commit publication. */
export async function clearPg(
  state: IPgState,
  tables: IPgTables,
  channel: Exclude<IPgChannel, 'metadata'>
): Promise<void> {
  await observePgRange(state, tables, channel)
  await state.guardRange(channel)
  if (state.journal !== undefined) {
    const before = (
      await state.client.query(
        'SELECT key FROM ' + tables[channel] + ' WHERE org_id=$1',
        [state.orgId],
        state.ctx
      )
    ).rows
    await observePgBatch(
      state,
      tables,
      channel,
      before.map((row) => (channel === 'record' ? pgRecordKey(row.key) : pgTextKey(row.key)))
    )
  }
  const rows = (
    await state.client.query(
      'DELETE FROM ' + tables[channel] + ' WHERE org_id=$1 RETURNING key',
      [state.orgId],
      state.ctx
    )
  ).rows
  for (const row of rows) {
    const key = channel === 'record' ? pgRecordKey(row.key) : pgTextKey(row.key)
    await observePgRevision(state, tables, channel, key)
    markPgChanged(state, channel, key)
  }
}
/** Commit owns one ordered revision-lock acquisition and compares only original observed values. */
export async function commitPgRevisions(
  state: IPgState,
  tables: IPgTables
): Promise<readonly ILockKey[] | undefined> {
  const identities = new Set(state.baseline.keys())
  const increments = new Set<string>()
  for (const [channel, changed] of state.changed) {
    for (const key of changed.values()) increments.add(pgIdentity(channel, key))
    if (channel !== 'metadata' && changed.size !== 0) increments.add(channel + ':*')
  }
  for (const identity of increments) identities.add(identity)
  if (identities.size === 0) return
  const ordered = [...identities].sort()
  await preparePgRevisionRows(state, tables, ordered)
  const rows = await readPgRevisionRows(state, tables, ordered, true)
  const conflicts: ILockKey[] = []
  let rangeConflict = false
  for (const [identity, actual] of rows) {
    const expected = state.baseline.get(identity)
    if (expected !== undefined && !sameRevision(expected, actual)) {
      const key = state.observed.get(identity)
      if (key) conflicts.push(key)
      else rangeConflict = true
    }
  }
  const now = Number(
    (
      await state.client.query(
        'SELECT extract(epoch FROM clock_timestamp())*1000 AS now',
        [],
        state.ctx
      )
    ).rows[0]?.now
  )
  for (const [identity, deadline] of state.expirations) {
    if (deadline <= now && !increments.has(identity)) {
      const key = state.observed.get(identity)
      if (key) conflicts.push(key)
    }
  }
  if (conflicts.length !== 0 || rangeConflict) return conflicts
  if (increments.size !== 0)
    await state.client.query(
      'UPDATE ' +
        tables.revisions +
        ' SET version=version+1 WHERE org_id=$1 AND key=ANY($2::text[])',
      [state.orgId, { arrayType: 'text', values: [...increments] }],
      state.ctx
    )
}
/** Physical failure classification reads the same persistent baseline after actual rollback. */
export async function recheckPgRevisions(state: IPgState, tables: IPgTables): Promise<boolean> {
  const actual = await readPgRevisionRows(state, tables, [...state.baseline.keys()])
  for (const [key, expected] of state.baseline)
    if (!sameRevision(expected, actual.get(key))) return false
  return true
}
/** Native batches capture every missing complete baseline in one ANY query, rather than per-key I/O. */
export async function observePgBatch(
  state: IPgState,
  tables: IPgTables,
  channel: Exclude<IPgMutationChannel, 'metadata'>,
  keys: readonly IStorageKey[]
): Promise<void> {
  await state.journal?.capture(channel, keys)
  const missing = new Map<string, IStorageKey>()
  for (const key of keys) {
    const id = pgIdentity(channel, key)
    if (!state.baseline.has(id)) missing.set(id, key)
  }
  const actual = await readPgRevisionRows(state, tables, [...missing.keys()])
  for (const [id, key] of missing) {
    state.baseline.set(id, actual.get(id) ?? revision(undefined))
    state.observed.set(id, pgLockKey(channel, key))
  }
}
/** One root or scoped batch operation retains canonical duplicate/order facts supplied by the owner. */
export async function getManyPg(
  state: IPgState,
  tables: IPgTables,
  keys: readonly IStorageBatchKey[]
): Promise<readonly (string | undefined)[]> {
  const unique = keys.filter((entry, index) => entry.firstIndex === index)
  if (unique.length === 0) return []
  const byIdentity = new Map(unique.map((entry) => [entry.identity, entry.key]))
  await observePgBatch(
    state,
    tables,
    'text',
    unique.map((entry) => entry.key)
  )
  const params: IPgNativeParameter[] = [
    state.orgId,
    { arrayType: 'text', values: [...byIdentity.keys()] }
  ]
  const expired = (
    await state.client.query(
      'SELECT key FROM ' +
        tables.text +
        ' WHERE org_id=$1 AND key=ANY($2::text[]) AND expires_at<=clock_timestamp()',
      params,
      state.ctx
    )
  ).rows
  if (expired.length !== 0) {
    await state.guardKeys(expired.map((row) => pgLockKey('text', byIdentity.get(String(row.key))!)))
    const removed = await state.client.query(
      'DELETE FROM ' +
        tables.text +
        ' WHERE org_id=$1 AND key=ANY($2::text[]) AND expires_at<=clock_timestamp() RETURNING key',
      params,
      state.ctx
    )
    for (const row of removed.rows) markPgChanged(state, 'text', byIdentity.get(String(row.key))!)
  }
  const rows = (
    await state.client.query(
      'SELECT key,value,extract(epoch FROM expires_at)*1000 AS deadline FROM ' +
        tables.text +
        ' WHERE org_id=$1 AND key=ANY($2::text[]) AND (expires_at IS NULL OR expires_at>clock_timestamp())',
      params,
      state.ctx
    )
  ).rows
  const values = new Map<string, string>()
  for (const row of rows) {
    const id = String(row.key)
    values.set(id, state.codecs.decodeText(row.value))
    if (row.deadline !== null)
      state.expirations.set(pgIdentity('text', byIdentity.get(id)!), Number(row.deadline))
  }
  return keys.map((entry) => values.get(entry.identity))
}
/** All batch rows are detached and validated before this one native unnest write starts. */
export async function setManyPg(
  state: IPgState,
  tables: IPgTables,
  entries: readonly {
    readonly key: IStorageKey
    readonly identity: string
    readonly value: string
    readonly ttlMs: number | undefined
  }[]
): Promise<void> {
  if (entries.length === 0) return
  const keys = entries.map((entry) => entry.key)
  for (const channel of ['text', 'bytes', 'record'] as const)
    await observePgBatch(
      state,
      tables,
      channel,
      channel === 'bytes' ? keys.filter((key) => typeof key === 'string') : keys
    )
  await state.guardKeys(
    keys.flatMap((key) =>
      (['text', 'bytes', 'record'] as const)
        .filter((channel) => channel !== 'bytes' || typeof key === 'string')
        .map((channel) => pgLockKey(channel, key))
    )
  )
  const byIdentity = new Map(entries.map((entry) => [entry.identity, entry.key]))
  const params: IPgNativeParameter[] = [
    state.orgId,
    { arrayType: 'text', values: [...byIdentity.keys()] }
  ]
  for (const channel of ['text', 'bytes', 'record'] as const) {
    const returned = channel === 'record' ? "encode(key,'hex')" : 'key'
    const predicate =
      channel === 'record'
        ? "key=ANY(ARRAY(SELECT decode(item,'hex') FROM unnest($2::text[]) AS item))"
        : 'key=ANY($2::text[])'
    const removed = await state.client.query(
      'DELETE FROM ' +
        tables[channel] +
        ' WHERE org_id=$1 AND ' +
        predicate +
        ' AND expires_at<=clock_timestamp() RETURNING ' +
        returned +
        ' AS key',
      params,
      state.ctx
    )
    for (const row of removed.rows) markPgChanged(state, channel, byIdentity.get(String(row.key))!)
  }
  const conflicting = (
    await state.client.query(
      'SELECT key FROM ' +
        tables.bytes +
        " WHERE org_id=$1 AND key=ANY($2::text[]) UNION ALL SELECT encode(key,'hex') AS key FROM " +
        tables.record +
        " WHERE org_id=$1 AND key=ANY(ARRAY(SELECT decode(item,'hex') FROM unnest($2::text[]) AS item))",
      params,
      state.ctx
    )
  ).rows
  if (conflicting.length !== 0) throw postgresError(PostgresErrorCode.duplicateKey)
  const written = await state.client.query(
    'INSERT INTO ' +
      tables.text +
      " (org_id,key,value,expires_at) SELECT $1,input.key,input.value,CASE WHEN input.duration IS NULL THEN NULL ELSE clock.now+input.duration*interval '1 millisecond' END FROM unnest($2::text[],$3::text[],$4::float8[]) AS input(key,value,duration) CROSS JOIN (SELECT clock_timestamp() AS now) AS clock ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value,expires_at=coalesce(excluded.expires_at," +
      tables.text +
      '.expires_at)' +
      (state.journal === undefined ? '' : ' RETURNING key,value,expires_at::text AS deadline'),
    [
      state.orgId,
      { arrayType: 'text', values: entries.map((entry) => entry.identity) },
      { arrayType: 'text', values: entries.map((entry) => state.codecs.encodeText(entry.value)) },
      { arrayType: 'float8', values: entries.map((entry) => entry.ttlMs ?? null) }
    ],
    state.ctx
  )
  const after =
    state.journal === undefined
      ? undefined
      : new Map(written.rows.map((row) => [String(row.key), row]))
  for (const entry of entries) markPgChanged(state, 'text', entry.key, after?.get(entry.identity))
}
/** Native ANY deletion returns actual distinct physical removals, including expired rows. */
export async function removeManyPg(
  state: IPgState,
  tables: IPgTables,
  keys: readonly IStorageBatchKey[]
): Promise<number> {
  const unique = keys.filter((entry, index) => entry.firstIndex === index)
  if (unique.length === 0) return 0
  await observePgBatch(
    state,
    tables,
    'text',
    unique.map((entry) => entry.key)
  )
  await state.guardKeys(unique.map((entry) => pgLockKey('text', entry.key)))
  const byIdentity = new Map(unique.map((entry) => [entry.identity, entry.key]))
  const removed = await state.client.query(
    'DELETE FROM ' + tables.text + ' WHERE org_id=$1 AND key=ANY($2::text[]) RETURNING key',
    [state.orgId, { arrayType: 'text', values: [...byIdentity.keys()] }],
    state.ctx
  )
  for (const row of removed.rows) markPgChanged(state, 'text', byIdentity.get(String(row.key))!)
  return removed.rowCount
}
/** Prefix deletion consumes the canonical half-open byte range and preserves all key type domains. */
export async function removePrefixPg(
  state: IPgState,
  tables: IPgTables,
  channel: 'text' | 'record',
  prefix: IStorageKey
): Promise<number> {
  /** The canonical prefix projection owns native ordered bounds used across scan and delete awaits. */
  const range = snapshotStorageKeyPrefix(prefix, PgNames.backend)
  await observePgRange(state, tables, channel)
  await state.guardRange(channel, range.key)
  const lower = channel === 'record' ? range.lower : pgKeyHex(range.lower)
  const upper = channel === 'record' ? range.upper : pgKeyHex(range.upper)
  if (state.journal !== undefined) {
    const before = (
      await state.client.query(
        'SELECT key FROM ' + tables[channel] + ' WHERE org_id=$1 AND key>=$2 AND key<$3',
        [state.orgId, lower, upper],
        state.ctx
      )
    ).rows
    await observePgBatch(
      state,
      tables,
      channel,
      before.map((row) => (channel === 'record' ? pgRecordKey(row.key) : pgTextKey(row.key)))
    )
  }
  const rows = (
    await state.client.query(
      'DELETE FROM ' + tables[channel] + ' WHERE org_id=$1 AND key>=$2 AND key<$3 RETURNING key',
      [state.orgId, lower, upper],
      state.ctx
    )
  ).rows
  const keys = rows.map((row) => (channel === 'record' ? pgRecordKey(row.key) : pgTextKey(row.key)))
  await observePgBatch(state, tables, channel, keys)
  for (const key of keys) markPgChanged(state, channel, key)
  return rows.length
}
