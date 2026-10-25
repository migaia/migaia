import {
  StorageContractError,
  StorageContractErrorCode,
  type IConcurrencyAttemptContext,
  type IConcurrencyHolder,
  type ILockKey,
  type ILockHolding,
  type IStorageKey,
  type ISqlRow
} from '@migaia/storage-contract'
import {
  readConcurrencyLockIdentities,
  snapshotConcurrencyLockKeys,
  snapshotConcurrencyLockRange,
  snapshotConcurrencyLockHoldings
} from '@migaia/storage-host/authoring/concurrency'
import { sleep } from '@migaia/utils/promise'
import { throwIfAborted } from '@migaia/storage-host/authoring/backend'
import type { IPgConfiguration, IPgTables } from './schema.js'
import type { IPgConnection } from './types.js'
import { pgTextKey } from './codec.js'
import { PgNames } from './constants.js'
import { normalizeTransactionFailure, postgresError } from './errors.js'
import { PostgresErrorCode } from './error-code.js'
import { PostgresErrorText } from './error-text.js'
/** A backend-created lock conflict is consumed before it can leave the original attempt. */
export class PgLockConflict extends Error {
  constructor(
    readonly keys: readonly ILockKey[],
    readonly holder: IConcurrencyHolder | undefined
  ) {
    super(PostgresErrorText.transactionFailed)
  }
}
/** Complete native attempt identity is retained only across its own physical replays. */
export type IPgLockLease = {
  readonly token: string
  readonly owner: string
  readonly keys: readonly ILockKey[]
  readonly identities: readonly string[]
}
/** Original fixed channel bounds decode inspection identities without a second key codec. */
const channelRanges = (['text', 'bytes', 'record', 'vector'] as const).map((channel) => ({
  channel,
  ...snapshotConcurrencyLockRange({ channel }, PgNames.backend)
}))
/** Decode native identities through canonical key and lock admission; no caller storage is borrowed. */
function decodeLock(id: string): ILockKey {
  const range = channelRanges.find((entry) => id >= entry.lower && id < entry.upper)
  if (!range) throw postgresError(PostgresErrorCode.decodeFailed)
  const key = pgTextKey(id.slice(range.lower.length))
  if (range.channel === 'vector') {
    if (
      !Array.isArray(key) ||
      key.length !== 2 ||
      typeof key[0] !== 'string' ||
      typeof key[1] !== 'string'
    )
      throw postgresError(PostgresErrorCode.decodeFailed)
    return snapshotConcurrencyLockKeys(
      [{ channel: range.channel, collection: key[0], id: key[1] }],
      PgNames.backend
    ).keys[0]!
  }
  return snapshotConcurrencyLockKeys([{ channel: range.channel, key }], PgNames.backend).keys[0]!
}
/** Holder facts never expose the attempt token or confer acquisition authority. */
function holder(row: ISqlRow, owner: string): IConcurrencyHolder {
  return {
    owner: String(row.owner),
    ...(typeof row.label === 'string' ? { label: row.label } : {}),
    ...(typeof row.pid === 'number' ? { pid: row.pid } : {}),
    since: Number(row.since),
    status: 'held',
    scope: row.owner === owner ? 'local' : 'remote'
  }
}
/** Native revision rows serialize one key's lock creation against actual standard writes. */
async function keyGuard(
  client: IPgConnection,
  tables: IPgTables,
  orgId: string,
  identities: readonly string[]
): Promise<void> {
  if (identities.length === 0) return
  await client.query(
    'INSERT INTO ' +
      tables.revisions +
      ' (org_id,key,version) SELECT $1,key,0 FROM unnest($2::text[]) AS key ORDER BY key ON CONFLICT(org_id,key) DO NOTHING',
    [orgId, { arrayType: 'text', values: identities }]
  )
  await client.query(
    'SELECT key FROM ' +
      tables.revisions +
      ' WHERE org_id=$1 AND key=ANY($2::text[]) ORDER BY key FOR UPDATE',
    [orgId, { arrayType: 'text', values: identities }]
  )
}
/** Native locks use database time, one real short transaction and a complete attempt identity. */
export async function acquirePgLocks(
  configuration: IPgConfiguration,
  tables: IPgTables,
  orgId: string,
  owner: string,
  context: IConcurrencyAttemptContext
): Promise<IPgLockLease | PgLockConflict | undefined> {
  if (context.locking === 'optimistic' || !context.lock?.length) return
  const identities = readConcurrencyLockIdentities(context)
  const token = String(
    (await configuration.driver.query('SELECT gen_random_uuid()::text AS token', [], context))
      .rows[0]?.token
  )
  for (;;) {
    throwIfAborted(context.signal)
    const client = await configuration.driver.connect(context)
    let begun = false
    let conflict: PgLockConflict | undefined
    try {
      await client.query('BEGIN', [], context)
      begun = true
      await keyGuard(client, tables, orgId, identities)
      const rows = (
        await client.query(
          'SELECT key,owner,label,pid,since,expires_at FROM ' +
            tables.locks +
            ' WHERE org_id=$1 AND key=ANY($2::text[]) AND expires_at>extract(epoch FROM clock_timestamp())*1000 ORDER BY key',
          [orgId, { arrayType: 'text', values: identities }],
          context
        )
      ).rows
      if (rows.length !== 0) conflict = new PgLockConflict(context.lock, holder(rows[0]!, owner))
      else {
        await client.query(
          'INSERT INTO ' +
            tables.locks +
            ' (org_id,key,owner,attempt_token,label,pid,since,expires_at) SELECT $1,key,$3,$4,$5,pg_backend_pid(),clock.now,clock.now+$6::float8 FROM unnest($2::text[]) AS key CROSS JOIN (SELECT extract(epoch FROM clock_timestamp())*1000 AS now) AS clock ON CONFLICT(org_id,key) DO UPDATE SET owner=excluded.owner,attempt_token=excluded.attempt_token,label=excluded.label,pid=excluded.pid,since=excluded.since,expires_at=excluded.expires_at',
          [
            orgId,
            { arrayType: 'text', values: identities },
            owner,
            token,
            configuration.label ?? null,
            configuration.maxLockMs
          ],
          context
        )
        await client.query('COMMIT', [])
        begun = false
        return { token, owner, keys: context.lock, identities }
      }
      await client.query('ROLLBACK', [])
      begun = false
    } catch (cause) {
      if (begun)
        try {
          await client.query('ROLLBACK', [])
        } catch (secondary) {
          throw normalizeTransactionFailure(
            new AggregateError([cause, secondary], PostgresErrorText.transactionFailed)
          )
        }
      throw cause
    } finally {
      await client.dispose()
    }
    if (context.admission === 'try') return conflict
    await context.wait(sleep(10, { signal: context.signal }))
  }
}
/** A live lease must match every original key, owner and token at work start and before commit. */
export async function verifyPgLocks(
  client: IPgConnection,
  tables: IPgTables,
  orgId: string,
  lease: IPgLockLease | undefined
): Promise<void> {
  if (!lease) return
  const row = (
    await client.query(
      'SELECT count(*)::int4 AS count FROM ' +
        tables.locks +
        ' WHERE org_id=$1 AND key=ANY($2::text[]) AND owner=$3 AND attempt_token=$4 AND expires_at>extract(epoch FROM clock_timestamp())*1000',
      [orgId, { arrayType: 'text', values: lease.identities }, lease.owner, lease.token]
    )
  ).rows[0]
  if (row?.count !== lease.identities.length)
    throw new StorageContractError(StorageContractErrorCode.lockLost, { backend: PgNames.backend })
}
/** Expired or late release cannot delete a successor's native lock rows. */
export async function releasePgLocks(
  configuration: IPgConfiguration,
  tables: IPgTables,
  orgId: string,
  lease: IPgLockLease | undefined
): Promise<void> {
  if (lease)
    await configuration.driver.query(
      'DELETE FROM ' +
        tables.locks +
        ' WHERE org_id=$1 AND key=ANY($2::text[]) AND owner=$3 AND attempt_token=$4',
      [orgId, { arrayType: 'text', values: lease.identities }, lease.owner, lease.token]
    )
}
/** Standard writes share real per-key revision guards with the lock acquisition transaction. */
export async function guardPgKeys(
  client: IPgConnection,
  tables: IPgTables,
  orgId: string,
  owner: string,
  lease: IPgLockLease | undefined,
  keys: readonly ILockKey[]
): Promise<void> {
  /** Canonical lock projection sorts identities and holds the same key set across two native awaits. */
  const captured = snapshotConcurrencyLockKeys(keys, PgNames.backend)
  await keyGuard(client, tables, orgId, captured.identities)
  const rows = (
    await client.query(
      'SELECT key,owner,attempt_token,label,pid,since FROM ' +
        tables.locks +
        ' WHERE org_id=$1 AND key=ANY($2::text[]) AND expires_at>extract(epoch FROM clock_timestamp())*1000',
      [orgId, { arrayType: 'text', values: captured.identities }]
    )
  ).rows
  const other = rows.find((row) => row.owner !== lease?.owner || row.attempt_token !== lease?.token)
  if (other) throw new PgLockConflict(captured.keys, holder(other, owner))
}
/** D-SQL-CLEAR uses the engine table lock to prevent new lock rows during its range check and write. */
export async function guardPgRange(
  client: IPgConnection,
  tables: IPgTables,
  orgId: string,
  owner: string,
  lease: IPgLockLease | undefined,
  channel: 'text' | 'bytes' | 'record',
  prefix?: IStorageKey
): Promise<void> {
  /** Canonical lock projection owns the channel/prefix bounds used after the table-lock await. */
  const range = snapshotConcurrencyLockRange({ channel, prefix }, PgNames.backend)
  await client.query('LOCK TABLE ' + tables.locks + ' IN SHARE MODE', [])
  const rows = (
    await client.query(
      'SELECT key,owner,attempt_token,label,pid,since FROM ' +
        tables.locks +
        ' WHERE org_id=$1 AND key>=$2 AND key<$3 AND expires_at>extract(epoch FROM clock_timestamp())*1000 ORDER BY key',
      [orgId, range.lower, range.upper]
    )
  ).rows
  const other = rows.find((row) => row.owner !== lease?.owner || row.attempt_token !== lease?.token)
  if (other) throw new PgLockConflict([decodeLock(String(other.key))], holder(other, owner))
}
/** Read-only native inspection retains expired holders and delegates final ordering to the contract. */
export async function inspectPgLocks(
  configuration: IPgConfiguration,
  tables: IPgTables,
  orgId: string,
  owner: string
): Promise<readonly ILockHolding[]> {
  const rows = (
    await configuration.driver.query(
      'SELECT key,owner,label,pid,since,expires_at,expires_at<=extract(epoch FROM clock_timestamp())*1000 AS expired FROM ' +
        tables.locks +
        ' WHERE org_id=$1',
      [orgId]
    )
  ).rows
  /** Canonical projection validates and sorts native inspection facts; no caller input is copied. */
  return snapshotConcurrencyLockHoldings(
    rows.map((row) => ({
      key: decodeLock(String(row.key)),
      holder: holder(row, owner),
      expired: row.expired === true,
      expiresAt: Number(row.expires_at)
    }))
  )
}
