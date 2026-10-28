import type { Pool, ClientBase } from 'pg'
import type { Pgoutput } from 'pg-logical-replication'
import { deferred, sleep } from '@migaia/utils/promise'
import { attachSecondaryErrors } from '@migaia/utils/error'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IOperationContext,
  type IDurableStorageChange
} from '@migaia/storage-contract'
import {
  throwIfAborted,
  subscribeToAbort,
  createStorageOperationReporter,
  reportCleanupError
} from '@migaia/storage-host/sdk'
import type {
  IPgLogicalReplicationPort,
  IPgLogicalReplicationRoute,
  IPgLogicalReplicationOptions,
  IPgNativeParameter,
  IPgResult
} from './types.js'
import { pgResource } from './driver-resource.js'
import { invalidArgument, normalizePostgresError } from './errors.js'
import { PgNames, PgTruncatePolicy, PgPublicationOperation } from './constants.js'
import { PostgresErrorText } from './error-text.js'
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
function unsupported(message?: string): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.unsupported,
    { backend: PgNames.backend },
    message
  )
}
/** Admission and decoding share the same table scope, including lazily created vector collections. */
function pgReplicationTable(prefix: string, name: string): boolean {
  return (
    name === prefix + '_' + PgNames.text ||
    name === prefix + '_' + PgNames.bytes ||
    name === prefix + '_' + PgNames.record ||
    (name.startsWith(prefix + '_v') && name !== prefix + '_' + PgNames.vectorConfiguration)
  )
}
/** A commit carries either ordered org summaries or one route-wide reset. */
type IPgCommit = {
  readonly end: string
  readonly orgs: readonly (string | undefined)[]
  readonly reset: boolean
}
/** The decoder retains routing scalars only, never caller values or another checkpoint. */
class PgCommitAccumulator {
  /** Immutable route and policy determine the scope of every decoded invalidation. */
  readonly #route: IPgLogicalReplicationRoute & IPgLogicalReplicationOptions
  /** Insertion order preserves each organization's first WAL occurrence in this commit. */
  readonly #organizations = new Set<string>()
  /** TRUNCATE supersedes row summaries because every row in the route becomes invalid. */
  #reset = false

  /** Bind one decoder to its selected store, organization and TRUNCATE policy. */
  constructor(route: IPgLogicalReplicationRoute & IPgLogicalReplicationOptions) {
    this.#route = route
  }

  /** Ignore internal bookkeeping tables and unrelated stores before copying route identities. */
  #accepted(schema: string, name: string): boolean {
    return schema === this.#route.schema && pgReplicationTable(this.#route.prefix, name)
  }

  /** Copy only the routing scalar and immediately discard the peer's row object. */
  #add(row: unknown): void {
    if (row === null || typeof row !== 'object') return
    const orgId: unknown = Reflect.get(row, 'org_id')
    if (typeof orgId !== 'string') throw unsupported()
    this.#organizations.add(orgId)
  }

  /** Emit only complete commits, keeping reset on the same acknowledgement path as DML. */
  accept(message: Pgoutput.Message): IPgCommit | undefined {
    if (message.tag === 'begin') {
      this.#organizations.clear()
      this.#reset = false
    } else if (
      message.tag === 'insert' &&
      this.#accepted(message.relation.schema, message.relation.name)
    )
      this.#add(message.new)
    else if (
      message.tag === 'update' &&
      this.#accepted(message.relation.schema, message.relation.name)
    ) {
      this.#add(message.key ?? message.old)
      this.#add(message.new)
    } else if (
      message.tag === 'delete' &&
      this.#accepted(message.relation.schema, message.relation.name)
    )
      this.#add(message.key ?? message.old)
    else if (
      message.tag === 'truncate' &&
      message.relations.some((relation) => this.#accepted(relation.schema, relation.name))
    ) {
      if (this.#route.truncate === PgTruncatePolicy.block) throw unsupported()
      this.#reset = true
    } else if (message.tag === 'commit') {
      if (message.commitEndLsn === null) throw unsupported()
      position(message.commitEndLsn)
      return {
        end: message.commitEndLsn,
        reset: this.#reset,
        orgs: this.#reset
          ? [this.#route.orgId]
          : [...this.#organizations].filter(
              (orgId) => this.#route.orgId === undefined || orgId === this.#route.orgId
            )
      }
    }
    return undefined
  }
}
/** Immutable native ports shared by polling reads and independently owned live sessions. */
type IPgReplicationContext = {
  readonly pool: Pool
  readonly query: (
    client: Pool | ClientBase,
    text: string,
    params: readonly IPgNativeParameter[]
  ) => Promise<IPgResult>
  readonly report: ReturnType<typeof createStorageOperationReporter>
}
/** Inspect the existing slot and WAL retention without changing deployment configuration. */
async function inspectPgReplication(
  context: IPgReplicationContext,
  options: IPgLogicalReplicationOptions & IPgLogicalReplicationRoute,
  cursor?: IPgCursor
) {
  const result = await context.query(
    context.pool,
    `SELECT current_database() AS database,d.oid::text AS database_oid,
      inet_server_addr()::text AS address,inet_server_port()::text AS port,
      s.confirmed_flush_lsn::text AS confirmed,s.restart_lsn::text AS restart,s.wal_status,
      pg_wal_lsn_diff(pg_current_wal_lsn(),s.confirmed_flush_lsn)::text AS flush_lag,
      pg_wal_lsn_diff(pg_current_wal_lsn(),s.restart_lsn)::text AS retained_wal,
      s.plugin,s.temporary,s.database AS slot_database,
      p.pubinsert,p.pubupdate,p.pubdelete,p.pubtruncate,
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
  for (const [operation, enabled] of [
    [PgPublicationOperation.insert, row.pubinsert],
    [PgPublicationOperation.update, row.pubupdate],
    [PgPublicationOperation.delete, row.pubdelete],
    [PgPublicationOperation.truncate, row.pubtruncate]
  ] as const)
    if (enabled !== true)
      throw unsupported(
        PostgresErrorText.publicationOperationMissing(options.publication, operation)
      )
  /** This expanded view treats explicit, schema-wide and all-table publications uniformly. */
  const tables = await context.query(
    context.pool,
    `SELECT c.relname AS table_name,p.tablename AS published
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_publication_tables p
        ON p.pubname=$1 AND p.schemaname=n.nspname AND p.tablename=c.relname
      WHERE n.nspname=$2 AND c.relkind IN ('r','p')`,
    [options.publication, options.schema]
  )
  /** Base channels always belong to a store; vector collections join once their table exists. */
  const required = new Set([
    options.prefix + '_' + PgNames.text,
    options.prefix + '_' + PgNames.bytes,
    options.prefix + '_' + PgNames.record
  ])
  for (const table of tables.rows)
    if (pgReplicationTable(options.prefix, String(table.table_name)))
      required.add(String(table.table_name))
  for (const table of required)
    if (!tables.rows.some((entry) => entry.table_name === table && entry.published === table))
      throw unsupported(
        PostgresErrorText.publicationTableMissing(options.publication, options.schema, table)
      )
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
  return {
    identity,
    confirmed: row.confirmed,
    maxSlotWalKeepSize: String(row.max_keep),
    confirmedFlushLagBytes: String(row.flush_lag),
    retainedWalBytes: String(row.retained_wal)
  }
}
/** Confirm only a complete position that the caller already persisted. */
async function confirmPgReplication(
  context: IPgReplicationContext,
  slot: string,
  confirmed: string,
  cursor: IPgCursor | undefined
) {
  if (cursor !== undefined && cursor.ordinal === 0 && position(cursor.end) > position(confirmed))
    await context.query(
      context.pool,
      'SELECT end_lsn::text FROM pg_replication_slot_advance($1,$2::pg_lsn)',
      [slot, cursor.end]
    )
}
/** Produce bounded invalidations and opaque transaction positions without retaining business values. */
function pgCommitChanges(
  identity: string,
  end: string,
  orgs: readonly (string | undefined)[],
  start: number,
  reset: boolean
): readonly IDurableStorageChange[] {
  return orgs.slice(start).map((orgId, index) => ({
    sequence: start + index + 1,
    origin: PgNames.backend + ':wal',
    ...(orgId === undefined ? {} : { orgId }),
    channel: 'all',
    kind: reset ? 'reset' : 'batch',
    cursor: encode({
      version: 1,
      identity,
      end,
      ordinal: start + index + 1 === orgs.length ? 0 : start + index + 1
    })
  }))
}
/** Peek bounded native pages; the next persisted cursor alone advances the slot. */
async function readPgReplication(
  context: IPgReplicationContext,
  options: Parameters<IPgLogicalReplicationPort['read']>[0],
  ctx: IOperationContext | undefined
) {
  const cursor = decode(options.after)
  const limit = options.limit ?? 100
  if (!Number.isSafeInteger(limit) || limit < 1) throw invalidArgument()
  throwIfAborted(ctx?.signal)
  const facts = await inspectPgReplication(context, options, cursor)
  await confirmPgReplication(context, options.slot, facts.confirmed, cursor)
  const { PgoutputPlugin } = await import('pg-logical-replication')
  const decoder = new PgoutputPlugin({
    protoVersion: 1,
    publicationNames: [quotePgIdentifier(options.publication).replaceAll("'", "''")]
  })
  const commits = new PgCommitAccumulator(options)
  const client = await context.pool.connect()
  let begun = false
  const outcome = await (async () => {
    await context.query(client, 'BEGIN READ ONLY', [])
    begun = true
    // The SQL SRF peeks, never consumes. FETCH bounds client buffering; native pgoutput owns decoding.
    await context.query(
      client,
      `DECLARE storage_wal_read NO SCROLL CURSOR FOR
          SELECT data FROM pg_logical_slot_peek_binary_changes($1,pg_current_wal_lsn(),NULL,
          'proto_version','1','publication_names',$2)`,
      [options.slot, quotePgIdentifier(options.publication)]
    )
    for (;;) {
      throwIfAborted(ctx?.signal)
      const rows = (await context.query(client, 'FETCH FORWARD 128 FROM storage_wal_read', [])).rows
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
        const selected = pgCommitChanges(
          facts.identity,
          commit.end,
          commit.orgs,
          start,
          commit.reset
        ).slice(0, limit)
        return { changes: selected, cursor: selected.at(-1)!.cursor }
      }
    }
  })().then(
    (value) => ({ failed: false as const, value }),
    (cause: unknown) => ({ failed: true as const, cause: normalizePostgresError(cause) })
  )
  try {
    if (begun) await context.query(client, 'ROLLBACK', [])
  } catch (cause) {
    throw normalizePostgresError(
      outcome.failed ? attachSecondaryErrors(outcome.cause, [cause]) : cause
    )
  } finally {
    client.release()
  }
  if (outcome.failed) throw outcome.cause
  return outcome.value
}
/** One native live session owns startup, acknowledgement and native connection disposal. */
class PgLiveFeed {
  /** Immutable native pool and query ports are borrowed from the original driver. */
  readonly #context: IPgReplicationContext
  /** The selected slot, route and callbacks stay fixed for this session. */
  readonly #options: Parameters<IPgLogicalReplicationPort['open']>[0]
  /** Caller cancellation follows the original storage operation context. */
  readonly #operation: IOperationContext | undefined
  /** The real peer alone owns replication transport and explicit acknowledgements. */
  readonly #service: import('pg-logical-replication').LogicalReplicationService
  /** The original peer parser supplies ordered pgoutput transactions. */
  readonly #decoder: import('pg-logical-replication').PgoutputPlugin
  /** Readiness settles only after the actual slot backend is identified. */
  readonly #ready = deferred<void>()
  /** Only routing scalars survive native row decoding. */
  readonly #commits: PgCommitAccumulator
  /** One original resource serializes accepted callbacks and stable disposal promises. */
  readonly #resource: ReturnType<typeof pgResource>
  /** A partial cursor is applied once before later commits follow normally. */
  #resume: IPgCursor | undefined
  /** The first failure stops new deliveries and is reported once. */
  #failed = false
  /** Native abort subscription belongs to this session and is removed at shutdown. */
  #stopAbort: () => void = () => {}
  /** The peer's streaming promise drains before connection cleanup completes. */
  #streaming: Promise<unknown> | undefined
  /** Accepted readiness work also drains during failed startup. */
  #startup: Promise<void> | undefined
  /** Cleanup waits for this exact native backend, never another consumer using the same slot. */
  #nativePid: number | undefined

  /** Bind the real peer without loading it from the runtime-neutral package root. */
  constructor(
    context: IPgReplicationContext,
    options: Parameters<IPgLogicalReplicationPort['open']>[0],
    operation: IOperationContext | undefined,
    peer: typeof import('pg-logical-replication'),
    cursor: IPgCursor | undefined
  ) {
    this.#context = context
    this.#options = options
    this.#operation = operation
    this.#resume = cursor
    this.#commits = new PgCommitAccumulator(options)
    this.#service = new peer.LogicalReplicationService(context.pool.options, {
      acknowledge: { auto: false, timeoutSeconds: 0 },
      flowControl: { enabled: true }
    })
    this.#decoder = createTrackedPgOutput(peer.PgoutputPlugin, options.publication, (client) =>
      this.#identify(client)
    )
    this.#resource = pgResource(() => this.#close())
    this.#service.on('error', (cause) => this.#fail(cause))
    this.#service.on('start', () => this.#started())
    this.#service.on('data', (_lsn: string, message: Pgoutput.Message) => this.#receive(message))
  }
  /** Capture the peer's actual client before COPY begins. */
  async #identify(
    client: Parameters<import('pg-logical-replication').PgoutputPlugin['start']>[0]
  ): Promise<void> {
    const row = (await this.#context.query(client, 'SELECT pg_backend_pid() AS native_pid', []))
      .rows[0]
    if (typeof row?.native_pid !== 'number') throw unsupported()
    this.#nativePid = row.native_pid
  }
  /** Confirm this session's original backend owns the selected slot before reporting readiness. */
  #started(): void {
    this.#startup = (async () => {
      const row = (
        await this.#context.query(
          this.#context.pool,
          'SELECT active_pid FROM pg_replication_slots WHERE slot_name=$1',
          [this.#options.slot]
        )
      ).rows[0]
      if (row?.active_pid !== this.#nativePid) throw unsupported()
      this.#ready.resolve()
    })().catch((cause) => this.#fail(cause))
  }
  /** Report the first failure and close the existing resource without acknowledging its commit. */
  #fail(cause: unknown): void {
    if (this.#failed) return
    this.#failed = true
    const error = normalizePostgresError(cause)
    this.#ready.reject(error)
    try {
      if (this.#options.onError === undefined) reportCleanupError(this.#context.report, error)
      else
        void Promise.resolve(this.#options.onError(error)).catch((secondary) =>
          reportCleanupError(this.#context.report, secondary)
        )
    } catch (secondary) {
      reportCleanupError(this.#context.report, secondary)
    }
    void this.#resource
      .dispose()
      .catch((secondary) => reportCleanupError(this.#context.report, secondary))
  }
  /** Native flow control awaits each original callback before requesting more peer data. */
  #receive(message: Pgoutput.Message): Promise<void> | undefined {
    if (this.#failed) return
    return this.#resource.run(async () => {
      try {
        await this.#deliver(message)
      } catch (cause) {
        this.#fail(cause)
      }
    })
  }
  /** Only a complete, successfully processed commit advances its exclusive native end. */
  async #deliver(message: Pgoutput.Message): Promise<void> {
    const commit = this.#commits.accept(message)
    if (commit === undefined) return
    const resume = this.#resume
    if (
      resume !== undefined &&
      (position(commit.end) < position(resume.end) ||
        (resume.ordinal === 0 && position(commit.end) === position(resume.end)))
    )
      return
    const start = resume !== undefined && commit.end === resume.end ? resume.ordinal : 0
    if (resume !== undefined && resume.ordinal > 0 && position(commit.end) > position(resume.end))
      throw expired()
    if (start > commit.orgs.length) throw invalidArgument()
    for (const change of pgCommitChanges(
      this.#identity,
      commit.end,
      commit.orgs,
      start,
      commit.reset
    ))
      await this.#options.onChange(change)
    await this.#service.acknowledge(commit.end)
    this.#resume = undefined
  }
  /** The native inspection supplies the opaque cursor identity before streaming begins. */
  #identity = ''
  /** Start at the original native checkpoint and reject only after failed startup drains. */
  async open(
    facts: Awaited<ReturnType<typeof inspectPgReplication>>
  ): Promise<Awaited<ReturnType<IPgLogicalReplicationPort['open']>>> {
    this.#identity = facts.identity
    const cursor = this.#resume
    const from =
      this.#options.from === 'now'
        ? (
            await this.#context.query(
              this.#context.pool,
              'SELECT pg_current_wal_lsn()::text AS lsn',
              []
            )
          ).rows[0]?.lsn
        : cursor !== undefined && cursor.ordinal === 0
          ? cursor.end
          : facts.confirmed
    if (typeof from !== 'string') throw unsupported()
    this.#streaming = this.#service
      .subscribe(this.#decoder, this.#options.slot, from)
      .catch((cause) => this.#fail(cause))
    try {
      this.#stopAbort = subscribeToAbort(
        this.#operation?.signal,
        () => {
          try {
            throwIfAborted(this.#operation?.signal)
          } catch (cause) {
            this.#fail(cause)
          }
        },
        this.#context.report
      )
      await this.#ready.promise
    } catch (cause) {
      try {
        await this.#resource.dispose()
      } catch (secondary) {
        throw normalizePostgresError(attachSecondaryErrors(cause, [secondary]))
      }
      throw cause
    }
    return {
      dispose: this.#resource.dispose,
      [Symbol.asyncDispose]: this.#resource[Symbol.asyncDispose],
      acknowledge: async (end) => {
        position(end)
        await this.#service.acknowledge(end)
      }
    }
  }
  /** Drain only this session's accepted I/O and release the peer's original listeners. */
  async #close(): Promise<void> {
    this.#stopAbort()
    await this.#service.stop()
    await this.#streaming
    await this.#startup
    while (
      this.#nativePid !== undefined &&
      (
        await this.#context.query(
          this.#context.pool,
          'SELECT pid FROM pg_stat_activity WHERE pid=$1',
          [this.#nativePid]
        )
      ).rows.length !== 0
    )
      await sleep(1)
    this.#service.removeAllListeners()
  }
}

/** A native subclass preserves receiver semantics while observing the peer's original start. */
function createTrackedPgOutput(
  Peer: typeof import('pg-logical-replication').PgoutputPlugin,
  publication: string,
  beforeStart: (
    client: Parameters<import('pg-logical-replication').PgoutputPlugin['start']>[0]
  ) => Promise<void>
): import('pg-logical-replication').PgoutputPlugin {
  class PgTrackedOutput extends Peer {
    /** The callback records the native backend and does not own another connection. */
    readonly #beforeStart: typeof beforeStart
    /** Keep peer options and the native identity observation with the actual parser instance. */
    constructor() {
      super({
        protoVersion: 1,
        publicationNames: [quotePgIdentifier(publication).replaceAll("'", "''")]
      })
      this.#beforeStart = beforeStart
    }
    /** Continue the inherited peer start after identifying the original client. */
    override async start(
      client: Parameters<import('pg-logical-replication').PgoutputPlugin['start']>[0],
      slot: string,
      lastLsn: string
    ) {
      await this.#beforeStart(client)
      return super.start(client, slot, lastLsn)
    }
  }
  return new PgTrackedOutput()
}

/** Only the pg adapter loads replication; the package root remains client independent. */
export function createPgReplication(
  pool: Pool,
  query: IPgReplicationContext['query']
): IPgLogicalReplicationPort {
  const context: IPgReplicationContext = { pool, query, report: createStorageOperationReporter() }
  return {
    detect: async (options, ctx) => {
      throwIfAborted(ctx?.signal)
      const facts = await inspectPgReplication(context, options)
      return {
        maxSlotWalKeepSize: facts.maxSlotWalKeepSize,
        confirmedFlushLagBytes: facts.confirmedFlushLagBytes,
        retainedWalBytes: facts.retainedWalBytes
      }
    },
    read: (options, ctx) => readPgReplication(context, options, ctx),
    open: async (options, ctx) => {
      const cursor = options.from === 'now' ? undefined : decode(options.from)
      throwIfAborted(ctx?.signal)
      const facts = await inspectPgReplication(context, options, cursor)
      await confirmPgReplication(context, options.slot, facts.confirmed, cursor)
      const peer = await import('pg-logical-replication')
      return new PgLiveFeed(context, options, ctx, peer, cursor).open(facts)
    },
    dropSlot: async (slot, ctx) => {
      throwIfAborted(ctx?.signal)
      await query(pool, 'SELECT pg_drop_replication_slot($1)', [slot])
    }
  }
}
