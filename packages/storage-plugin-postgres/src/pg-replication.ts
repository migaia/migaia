import type { Pool, PoolClient } from 'pg'
import type { Pgoutput } from 'pg-logical-replication'
import { deferred, sleep } from '@migaia/utils/promise'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IDurableStorageChange
} from '@migaia/storage-contract'
import {
  throwIfAborted,
  subscribeToAbort,
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
import type {
  IPgLogicalReplicationPort,
  IPgLogicalReplicationRoute,
  IPgNativeParameter,
  IPgResult
} from './types.js'
import { pgResource } from './driver-resource.js'
import { invalidArgument, normalizePostgresError } from './errors.js'
import { PgNames } from './constants.js'
import { quotePgIdentifier } from './copy-command.js'

/** Durable positions contain no row values and are scoped to one original store/slot/route. */
type IPgCursor = {
  readonly version: 1
  readonly identity: string
  readonly end: string
  readonly ordinal: number
}
/** Only pgoutput COMMIT's exclusive end is a complete checkpoint; ordinals never alter the LSN. */
function position(value: string): bigint {
  if (!/^[0-9A-F]+\/[0-9A-F]+$/i.test(value)) throw invalidArgument()
  const [high, low] = value.split('/')
  return BigInt('0x' + high) * 0x100000000n + BigInt('0x' + low)
}
/** Opaque strings persist the finite item position without introducing another checkpoint owner. */
function encode(cursor: IPgCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}
/** Cursor syntax is rejected before any native query; route matching follows native store identity. */
function decode(value: string | undefined): IPgCursor | undefined {
  if (value === undefined) return undefined
  try {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw invalidArgument()
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (parsed === null || typeof parsed !== 'object') throw invalidArgument()
    const version = Reflect.get(parsed, 'version')
    const identity = Reflect.get(parsed, 'identity')
    const end = Reflect.get(parsed, 'end')
    const ordinal = Reflect.get(parsed, 'ordinal')
    if (
      version !== 1 ||
      typeof identity !== 'string' ||
      typeof end !== 'string' ||
      !Number.isSafeInteger(ordinal) ||
      ordinal < 0
    )
      throw invalidArgument()
    position(end)
    return { version, identity, end, ordinal }
  } catch (cause) {
    throw invalidArgument(cause)
  }
}
/** WAL loss is an existing shared cursor failure, independent from ordinary SQL failures. */
function expired(): StorageContractError {
  return new StorageContractError(StorageContractErrorCode.changeCursorExpired, {
    backend: PgNames.backend
  })
}
/** Deployment configuration cannot be silently replaced by a different plugin or publication. */
function unsupported(): StorageContractError {
  return new StorageContractError(StorageContractErrorCode.unsupported, {
    backend: PgNames.backend
  })
}
/** The original decoder emits business rows transiently; this owner retains only ordered org IDs. */
function accumulator(route: IPgLogicalReplicationRoute) {
  /** A Map retains the first native WAL occurrence of each organization within one COMMIT. */
  const organizations = new Map<string, true>()
  /** Only public store tables and managed native vector tables contribute invalidations. */
  const accepted = (schema: string, name: string) =>
    schema === route.schema &&
    (name === route.prefix + '_kv' ||
      name === route.prefix + '_bytes' ||
      name === route.prefix + '_records' ||
      (name.startsWith(route.prefix + '_v') && name !== route.prefix + '_vector_config'))
  /** Copy only the routing scalar and discard the decoder's row object immediately. */
  const add = (row: unknown) => {
    if (row === null || typeof row !== 'object') return
    const orgId: unknown = Reflect.get(row, 'org_id')
    if (typeof orgId !== 'string') throw unsupported()
    organizations.set(orgId, true)
  }
  return {
    accept(
      message: Pgoutput.Message
    ): { readonly end: string; readonly orgs: readonly string[] } | undefined {
      if (message.tag === 'begin') organizations.clear()
      else if (message.tag === 'insert' && accepted(message.relation.schema, message.relation.name))
        add(message.new)
      else if (
        message.tag === 'update' &&
        accepted(message.relation.schema, message.relation.name)
      ) {
        add(message.key ?? message.old)
        add(message.new)
      } else if (
        message.tag === 'delete' &&
        accepted(message.relation.schema, message.relation.name)
      )
        add(message.key ?? message.old)
      else if (
        message.tag === 'truncate' &&
        message.relations.some((relation) => accepted(relation.schema, relation.name))
      ) {
        // TRUNCATE has no row identities. A routed view can invalidate only its own known org.
        if (route.orgId !== undefined) organizations.set(route.orgId, true)
        else throw unsupported()
      } else if (message.tag === 'commit') {
        if (message.commitEndLsn === null) throw unsupported()
        position(message.commitEndLsn)
        return {
          end: message.commitEndLsn,
          orgs: [...organizations.keys()].filter(
            (orgId) => route.orgId === undefined || orgId === route.orgId
          )
        }
      }
      return undefined
    }
  }
}
/** Only the pg adapter loads this peer; ordinary backend imports stay independent from replication. */
export function createPgReplication(
  pool: Pool,
  query: (
    client: Pool | PoolClient,
    text: string,
    params: readonly IPgNativeParameter[]
  ) => Promise<IPgResult>
): IPgLogicalReplicationPort {
  const report = createStorageOperationReporter()
  /** Native facts are read-only and contain no caller credentials. */
  const inspect = async (
    options: { slot: string; publication: string } & IPgLogicalReplicationRoute,
    cursor?: IPgCursor
  ) => {
    const result = await query(
      pool,
      `SELECT current_database() AS database,d.oid::text AS database_oid,
      inet_server_addr()::text AS address,inet_server_port()::text AS port,
      s.confirmed_flush_lsn::text AS confirmed,s.restart_lsn::text AS restart,s.wal_status,
      s.plugin,s.temporary,s.database AS slot_database,p.puballtables,
      current_setting('wal_level') AS wal_level,current_setting('max_slot_wal_keep_size') AS max_keep,
      r.rolreplication OR r.rolsuper AS replication
      FROM pg_database d JOIN pg_roles r ON r.rolname=current_user
      LEFT JOIN pg_replication_slots s ON s.slot_name=$1
      LEFT JOIN pg_publication p ON p.pubname=$2 WHERE d.datname=current_database()`,
      [options.slot, options.publication]
    )
    const row = result.rows[0]
    if (
      !row ||
      row.plugin !== 'pgoutput' ||
      row.temporary !== false ||
      row.puballtables !== true ||
      row.wal_level !== 'logical' ||
      row.replication !== true ||
      row.slot_database !== row.database
    )
      throw unsupported()
    if (
      row.wal_status === 'lost' ||
      typeof row.restart !== 'string' ||
      typeof row.confirmed !== 'string'
    )
      throw expired()
    const identity = JSON.stringify([
      row.database,
      row.database_oid,
      row.address,
      row.port,
      options.schema,
      options.prefix,
      options.slot,
      options.orgId ?? null
    ])
    if (cursor !== undefined && cursor.identity !== identity) throw invalidArgument()
    if (
      cursor !== undefined &&
      (position(cursor.end) < position(row.confirmed) ||
        (cursor.ordinal > 0 && position(cursor.end) === position(row.confirmed)))
    )
      throw expired()
    return { identity, confirmed: row.confirmed, maxSlotWalKeepSize: String(row.max_keep) }
  }
  /** Caller-persisted complete positions alone may advance the original native slot. */
  const confirm = async (slot: string, confirmed: string, cursor: IPgCursor | undefined) => {
    if (cursor !== undefined && cursor.ordinal === 0 && position(cursor.end) > position(confirmed))
      await query(pool, 'SELECT end_lsn::text FROM pg_replication_slot_advance($1,$2::pg_lsn)', [
        slot,
        cursor.end
      ])
  }
  /** Summaries are broad invalidations, never decoded business values. */
  const changes = (
    identity: string,
    end: string,
    orgs: readonly string[],
    start: number
  ): readonly IDurableStorageChange[] =>
    orgs.slice(start).map((orgId, index) => ({
      sequence: start + index + 1,
      origin: PgNames.backend + ':wal',
      orgId,
      channel: 'all',
      kind: 'batch',
      cursor: encode({
        version: 1,
        identity,
        end,
        ordinal: start + index + 1 === orgs.length ? 0 : start + index + 1
      })
    }))
  return {
    detect: async (options, ctx) => {
      throwIfAborted(ctx?.signal)
      return inspect(options)
    },
    read: async (options, ctx) => {
      const cursor = decode(options.after)
      const limit = options.limit ?? 100
      if (!Number.isSafeInteger(limit) || limit < 1) throw invalidArgument()
      throwIfAborted(ctx?.signal)
      const facts = await inspect(options, cursor)
      await confirm(options.slot, facts.confirmed, cursor)
      const { PgoutputPlugin } = await import('pg-logical-replication')
      const decoder = new PgoutputPlugin({
        protoVersion: 1,
        publicationNames: [quotePgIdentifier(options.publication).replaceAll("'", "''")]
      })
      const commits = accumulator(options)
      const client = await pool.connect()
      let begun = false
      const outcome = await (async () => {
        await query(client, 'BEGIN READ ONLY', [])
        begun = true
        // The SQL SRF peeks, never consumes. FETCH bounds client buffering; native pgoutput owns decoding.
        await query(
          client,
          `DECLARE storage_wal_read NO SCROLL CURSOR FOR
          SELECT data FROM pg_logical_slot_peek_binary_changes($1,pg_current_wal_lsn(),NULL,
          'proto_version','1','publication_names',$2)`,
          [options.slot, quotePgIdentifier(options.publication)]
        )
        for (;;) {
          throwIfAborted(ctx?.signal)
          const rows = (await query(client, 'FETCH FORWARD 128 FROM storage_wal_read', [])).rows
          if (rows.length === 0)
            return {
              changes: [],
              cursor:
                options.after ??
                encode({ version: 1, identity: facts.identity, end: facts.confirmed, ordinal: 0 })
            }
          for (const row of rows) {
            if (!(row.data instanceof Uint8Array)) throw unsupported()
            const commit = commits.accept(decoder.parse(Buffer.from(row.data)))
            if (commit === undefined || commit.orgs.length === 0) continue
            if (
              cursor !== undefined &&
              (position(commit.end) < position(cursor.end) ||
                (cursor.ordinal === 0 && position(commit.end) === position(cursor.end)))
            )
              continue
            const start = cursor !== undefined && commit.end === cursor.end ? cursor.ordinal : 0
            if (
              cursor !== undefined &&
              cursor.ordinal > 0 &&
              position(commit.end) > position(cursor.end)
            )
              throw expired()
            if (start >= commit.orgs.length) throw invalidArgument()
            const selected = changes(facts.identity, commit.end, commit.orgs, start).slice(0, limit)
            return { changes: selected, cursor: selected.at(-1)!.cursor }
          }
        }
      })().then(
        (value) => ({ failed: false as const, value }),
        (cause: unknown) => ({ failed: true as const, cause: normalizePostgresError(cause) })
      )
      try {
        if (begun) await query(client, 'ROLLBACK', [])
      } catch (cause) {
        throw normalizePostgresError(
          outcome.failed ? attachSecondaryErrors(outcome.cause, [cause]) : cause
        )
      } finally {
        client.release()
      }
      if (outcome.failed) throw outcome.cause
      return outcome.value
    },
    open: async (options, ctx) => {
      const cursor = options.from === 'now' ? undefined : decode(options.from)
      throwIfAborted(ctx?.signal)
      const facts = await inspect(options, cursor)
      await confirm(options.slot, facts.confirmed, cursor)
      const { LogicalReplicationService, PgoutputPlugin } = await import('pg-logical-replication')
      const service = new LogicalReplicationService(pool.options, {
        acknowledge: { auto: false, timeoutSeconds: 0 },
        flowControl: { enabled: true }
      })
      const ready = deferred<void>()
      const commits = accumulator(options)
      /** A partial item position applies once, then the live stream follows later commits normally. */
      let resume = cursor
      let failed = false
      let stopAbort = () => {}
      let streaming: Promise<unknown> | undefined
      /**
       * Native slot ownership identifies only this connection, so cleanup never waits on a
       * successor.
       */
      let nativePid: number | undefined
      const resource = pgResource(async () => {
        stopAbort()
        await service.stop()
        await streaming
        while (
          nativePid !== undefined &&
          (
            await query(pool, 'SELECT active_pid FROM pg_replication_slots WHERE slot_name=$1', [
              options.slot
            ])
          ).rows[0]?.active_pid === nativePid
        )
          await sleep(1)
        service.removeAllListeners()
      })
      /** Stop after the original callback drains; the failed commit remains unacknowledged. */
      const fail = (cause: unknown) => {
        if (failed) return
        failed = true
        const error = normalizePostgresError(cause)
        ready.reject(error)
        try {
          if (options.onError === undefined) reportCleanupError(report, error)
          else {
            const result = options.onError(error)
            observeThenableRejection(result, inspectThenable(result), (secondary) =>
              reportCleanupError(report, secondary)
            )
          }
        } catch (secondary) {
          reportCleanupError(report, secondary)
        }
        void resource.dispose().catch((secondary) => reportCleanupError(report, secondary))
      }
      service.on('error', fail)
      service.on('start', () => {
        void (async () => {
          const row = (
            await query(pool, 'SELECT active_pid FROM pg_replication_slots WHERE slot_name=$1', [
              options.slot
            ])
          ).rows[0]
          if (typeof row?.active_pid === 'number') nativePid = row.active_pid
          ready.resolve()
        })().catch(fail)
      })
      service.on('data', (_lsn: string, message: Pgoutput.Message) => {
        if (failed) return
        return resource.run(async () => {
          try {
            const commit = commits.accept(message)
            if (commit === undefined) return
            if (
              resume !== undefined &&
              (position(commit.end) < position(resume.end) ||
                (resume.ordinal === 0 && position(commit.end) === position(resume.end)))
            )
              return
            const start = resume !== undefined && commit.end === resume.end ? resume.ordinal : 0
            if (
              resume !== undefined &&
              resume.ordinal > 0 &&
              position(commit.end) > position(resume.end)
            )
              throw expired()
            if (start > commit.orgs.length) throw invalidArgument()
            for (const change of changes(facts.identity, commit.end, commit.orgs, start))
              await options.onChange(change)
            await service.acknowledge(commit.end)
            resume = undefined
          } catch (cause) {
            fail(cause)
          }
        })
      })
      const from =
        options.from === 'now'
          ? (await query(pool, 'SELECT pg_current_wal_lsn()::text AS lsn', [])).rows[0]?.lsn
          : cursor !== undefined && cursor.ordinal === 0
            ? cursor.end
            : facts.confirmed
      if (typeof from !== 'string') throw unsupported()
      streaming = service
        .subscribe(
          new PgoutputPlugin({
            protoVersion: 1,
            publicationNames: [quotePgIdentifier(options.publication).replaceAll("'", "''")]
          }),
          options.slot,
          from
        )
        .catch(fail)
      try {
        stopAbort = subscribeToAbort(
          ctx?.signal,
          () => {
            try {
              throwIfAborted(ctx?.signal)
            } catch (cause) {
              fail(cause)
            }
          },
          report
        )
        await ready.promise
      } catch (cause) {
        try {
          await resource.dispose()
        } catch (secondary) {
          throw normalizePostgresError(attachSecondaryErrors(cause, [secondary]))
        }
        throw cause
      }
      return {
        dispose: resource.dispose,
        [Symbol.asyncDispose]: resource[Symbol.asyncDispose],
        acknowledge: async (end) => {
          position(end)
          await service.acknowledge(end)
        }
      }
    },
    dropSlot: async (slot, ctx) => {
      throwIfAborted(ctx?.signal)
      await query(pool, 'SELECT pg_drop_replication_slot($1)', [slot])
    }
  }
}
