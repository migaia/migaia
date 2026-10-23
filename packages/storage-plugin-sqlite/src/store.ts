import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  snapshotStorageKey,
  encodeOrderedStorageKey,
  snapshotStorageKeyPrefix,
  snapshotOperationContext,
  snapshotSyncWriteOptions,
  assertTransactionCallback,
  readTransactionConflictPolicy,
  createTransactionOwner,
  runTransactionOperation,
  assertTransactionOwner,
  useTransactionCapability,
  createTransactionBuilder,
  runWithConcurrency,
  readConcurrencyLockIdentities,
  snapshotConcurrencyLockKeys,
  snapshotConcurrencyLockRange,
  snapshotConcurrencyLockHoldings,
  lockKey,
  provideCapabilities,
  implement,
  kv,
  records,
  createRecordQuery,
  type IStorageKey,
  type IOperationContext,
  type IKeyRange,
  type IStorageIterator,
  type ITransactionOptions,
  type ITransactionRecordsApi,
  type IRecordsApi,
  type ICapabilityInstallPort,
  type ICompiledStorageSql,
  type IConcurrencyAttemptContext,
  type IConcurrencyAttempt,
  type IConcurrencyHolder,
  type ILockKey,
  type IBackendStageBindings
} from '@migaia/storage-contract'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { createAbortController } from '@migaia/lifecycle'
import { walkErrorCauses } from '@migaia/utils/error'
import type { IStoragePluginCore } from '@migaia/storage-host'
import {
  createStorageOperationReporter,
  reportCleanupError,
  throwIfAborted,
  withAbort,
  subscribeToAbort,
  readAbortReason,
  snapshotKeyRange,
  type IBackendChangeController,
  type IBackendKeyLockPort,
  type IBackendRevisionPort
} from '@migaia/storage-host/authoring/backend'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import {
  defineCollectionsJsonCodec,
  type ICollectionsCodecValue
} from '@migaia/serialize/codecs/collections-json'
import { createConcurrencyLimiter, sleep, deferred } from '@migaia/utils/promise'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import {
  SqliteNames,
  SqliteControl,
  SqliteLimits,
  SqliteOperation,
  quoteSqliteIdentifier
} from './constants.js'
import {
  sqliteError,
  normalizeTransactionFailure,
  normalizeSqliteFailure,
  transactionCleanupFailure
} from './errors.js'
import { SqliteErrorCode } from './error-code.js'
import { SqliteErrorText } from './error-text.js'
import { decodeKey, decodeHexKey, keyHex } from './key-codec.js'
import { createSqliteStatements, createSqliteExecutor } from './sql.js'
import type {
  ISqliteOptions,
  ISqliteStore,
  ISqliteNativeStore,
  ISqliteDriver,
  ISqliteTransactionScope,
  ISqliteRow,
  ISqliteValue
} from './types.js'

/** Physical driver ownership is exclusive and released only after its store has drained. */
const claimedDrivers = new WeakSet<object>()
/** File/table/org groups share the existing host lock provider, independent of driver handles. */
const physicalGroups = new Map<
  object | string,
  Map<
    string,
    {
      readonly locks: IBackendKeyLockPort
      readonly revisions: IBackendRevisionPort
      references: number
    }
  >
>()
/** Public channels have distinct storage tables but share cross-channel string identity. */
type IChannel = 'text' | 'bytes' | 'record' | 'metadata'
/** Trusted short control segments use the same connection owner field without granting a scope. */
const SQLITE_CONTROL_ACTIVE = Symbol('sqlite-control-active')
/** A native callback and every short view refer to one actual active transaction. */
type INativeState = {
  readonly orgId: string
  readonly context: IConcurrencyAttemptContext | undefined
  readonly baseline: Map<string, number>
  readonly changed: Map<IChannel, Map<string, IStorageKey>>
  readonly expiresAt: number | undefined
  mode: 'deferred' | 'immediate'
  failure: unknown
}
/** Only native write failures created here trigger physical optimistic recovery. */
class SqlitePhysicalBusy extends Error {
  /** Preserve native BUSY identity without classifying arbitrary user callback errors. */
  constructor(cause: unknown) {
    super(SqliteErrorText.sqliteFailed, { cause })
  }
}
/** Native range deletion reports real intersecting holders to the original decision loop. */
class SqliteLogicalConflict extends Error {
  /** Only this backend-created evidence can turn an internal clear into an acquire conflict. */
  constructor(
    readonly keys: readonly ILockKey[],
    readonly holder: IConcurrencyHolder | undefined
  ) {
    super(SqliteErrorText.transactionFailed)
  }
}
/** Clear and prefix operations inspect only their actual public channel range. */
type IWriteGuard = {
  readonly channels: readonly ('text' | 'bytes' | 'record')[]
  readonly prefix?: IStorageKey
}
/** A root operation prepares its payload and exact protected range before any admission can wait. */
type IRootMutation<R> = {
  readonly keys: readonly ILockKey[]
  readonly guard?: IWriteGuard
  run(state: INativeState): R
}
/** Backend authoring state is supplied only by the original installation window. */
export type ISqliteRuntime = { readonly core: IStoragePluginCore; readonly orgId: string }
/** Construction returns only exact provider/controller handles needed for original host admission. */
export type ISqliteConstruction<TValue> = {
  readonly store: ISqliteStore<TValue>
  readonly controller: IBackendChangeController
  readonly installer: ICapabilityInstallPort
  getTransactionClient(scope: ISqliteTransactionScope): ISqliteDriver
}

/** Create a synchronous native backend while borrowing the injected connection. */
export function createSqliteStore<TValue>(
  input: ISqliteOptions,
  runtime: ISqliteRuntime
): ISqliteConstruction<TValue> {
  /** Capture public configuration once before schema or native calls. */
  const {
    driver,
    table = SqliteNames.table,
    concurrency,
    owner,
    maxLockMs = SqliteLimits.maxLockMs,
    wal: requestedWal
  } = input
  /** Nested owner metadata is captured once and never read during later attempts. */
  const label = owner?.label
  if (
    !driver ||
    typeof driver.exec !== 'function' ||
    typeof driver.prepare !== 'function' ||
    typeof table !== 'string' ||
    !table ||
    typeof maxLockMs !== 'number' ||
    !Number.isSafeInteger(maxLockMs) ||
    maxLockMs < 1 ||
    (requestedWal !== undefined && typeof requestedWal !== 'boolean') ||
    (label !== undefined && typeof label !== 'string')
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend,
      cause: new TypeError(SqliteErrorText.invalidOptions)
    })
  if (claimedDrivers.has(driver))
    throw sqliteError(SqliteErrorCode.sqliteFailed, new Error(SqliteErrorText.connectionClaimed))
  claimedDrivers.add(driver)
  /** Original host observation and execution ports carry no backend-owned subscriber registry. */
  const { core } = runtime
  /** One final reporting boundary observes cleanup and observer failures. */
  const report = createStorageOperationReporter()
  /** A single bounded statement Map belongs to this store and is cleared at release. */
  const statements = createSqliteStatements(driver)
  /** Physical table names are quoted only after their complete suffix has been assembled. */
  const tables = {
    text: quoteSqliteIdentifier(`${table}_${SqliteNames.text}`),
    bytes: quoteSqliteIdentifier(`${table}_${SqliteNames.bytes}`),
    record: quoteSqliteIdentifier(`${table}_${SqliteNames.record}`),
    metadata: quoteSqliteIdentifier(`${table}_${SqliteNames.metadata}`),
    locks: quoteSqliteIdentifier(`${table}_${SqliteNames.locks}`),
    revisions: quoteSqliteIdentifier(`${table}_${SqliteNames.revisions}`),
    journal: quoteSqliteIdentifier(`${table}_${SqliteNames.journal}`),
    markers: quoteSqliteIdentifier(`${table}_${SqliteNames.markers}`)
  }
  /** The original channel owner supplies native identity bounds and inverse channel recognition. */
  const channelRanges = (['text', 'bytes', 'record'] as const).map((channel) => ({
    channel,
    ...snapshotConcurrencyLockRange({ channel }, SqliteNames.backend)
  }))
  /** The builtin driver reports the actual physical file, not the caller's path spelling. */
  let physical: object | string = driver
  /** Actual WAL result determines which approved concurrency primitive is selected. */
  let wal = false
  /** Shared lock provider is created only within this installation window. */
  let group:
    | {
        readonly locks: IBackendKeyLockPort
        readonly revisions: IBackendRevisionPort
        references: number
      }
    | undefined
  /** Group identity encodes only package-owned configuration, never business values. */
  const groupId = JSON.stringify([table, runtime.orgId])
  try {
    /** PRAGMA database_list returns an empty main filename for an in-memory connection. */
    const main = statements
      .get(SqliteControl.databases)
      .all()
      .find((row) => row.name === 'main')
    if (typeof main?.file === 'string' && main.file !== '') physical = main.file
    wal = requestedWal ?? typeof physical === 'string'
    /** OFF cannot support the package's rollback guarantee, even when WAL was disabled explicitly. */
    const current = statements.get(SqliteControl.journal).get()
    if (String(current?.journal_mode).toLowerCase() === 'off')
      throw new Error(SqliteErrorText.walUnavailable)
    if (wal) {
      const actual = statements.get(SqliteControl.wal).get()
      if (String(actual?.journal_mode).toLowerCase() !== 'wal')
        throw new Error(SqliteErrorText.walUnavailable)
    }
    driver.exec(SqliteControl.busy)
    for (const channel of [
      SqliteNames.text,
      SqliteNames.bytes,
      'record',
      SqliteNames.metadata
    ] as const) {
      /** Metadata is isolated from public-channel expiry and conflict checks. */
      const metadata = channel === SqliteNames.metadata
      driver.exec(
        `CREATE TABLE IF NOT EXISTS ${tables[channel]}(org_id TEXT NOT NULL,key ${channel === 'record' ? 'BLOB' : 'TEXT'} NOT NULL,value ${channel === SqliteNames.bytes ? 'BLOB' : 'TEXT'} NOT NULL${metadata ? '' : ',expires_at INTEGER'},PRIMARY KEY(org_id,key))`
      )
      if (!metadata)
        driver.exec(
          `CREATE INDEX IF NOT EXISTS ${quoteSqliteIdentifier(`${table}_${channel}_expiry`)} ON ${tables[channel]}(org_id,expires_at,key)`
        )
    }
    driver.exec(
      `CREATE TABLE IF NOT EXISTS ${tables.journal}(org_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(org_id,key));CREATE TABLE IF NOT EXISTS ${tables.markers}(org_id TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(org_id,key))`
    )
    if (wal)
      driver.exec(
        `CREATE TABLE IF NOT EXISTS ${tables.locks}(org_id TEXT NOT NULL,key TEXT NOT NULL,owner TEXT NOT NULL,attempt_token TEXT NOT NULL,label TEXT,pid INTEGER,since INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(org_id,key));CREATE TABLE IF NOT EXISTS ${tables.revisions}(org_id TEXT NOT NULL,key TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(org_id,key))`
      )
    else {
      /** Different handles to one file share logical locks; memory connections stay independent. */
      let groups = physicalGroups.get(physical)
      if (!groups) {
        groups = new Map()
        physicalGroups.set(physical, groups)
      }
      group = groups.get(groupId)
      if (!group) {
        group = {
          locks: core.createKeyLockPort(),
          revisions: core.createRevisionPort(),
          references: 0
        }
        groups.set(groupId, group)
      }
      group.references++
    }
  } catch (cause) {
    statements.clear()
    claimedDrivers.delete(driver)
    throw normalizeSqliteFailure(cause)
  }
  /** The utility limiter owns only this synchronous driver's physical transaction admission. */
  const physicalAdmission = createConcurrencyLimiter({ concurrency: 1 })
  /** Active connection protects roots from accidentally joining another callback's transaction. */
  let active: INativeState | typeof SQLITE_CONTROL_ACTIVE | undefined
  /** The original controller releases detached root snapshots when this store drains. */
  const snapshots = new Set<() => Promise<void>>()
  /** The host's original controller owns logical closure and draining accepted backend work. */
  const controller = core.createChangeController({
    backend: SqliteNames.backend,
    platform: driver,
    options: input,
    finalize: async () => {
      await physicalAdmission.dispose()
      for (const dispose of snapshots) await dispose()
      statements.clear()
      claimedDrivers.delete(driver)
      if (group && --group.references === 0) {
        physicalGroups.get(physical)?.delete(groupId)
        if (physicalGroups.get(physical)?.size === 0) physicalGroups.delete(physical)
        await group.locks.dispose()
      }
    }
  })
  /** Text storage uses the existing surrogate-safe JSON codec. */
  const textCodec = defineJsonCodec({ version: 1 })
  /** Collections and class projection use the sole portable codec implementation. */
  const recordCodec = defineCollectionsJsonCodec({ version: 1 })
  /** Actual published store is assigned before observer bindings or owner registration. */
  let store!: ISqliteStore<TValue>
  /** Capability installation remains provider-owned and is transferred to the host once. */
  let installer!: ICapabilityInstallPort
  /** Private owner registration is the only source of scope authority and lifecycle. */
  let transactionOwner!: ReturnType<
    typeof createTransactionOwner<TValue, ISqliteTransactionScope<TValue>>
  >
  /** Observer factories are bound after the complete store exists. */
  let stages!: IBackendStageBindings
  /** Current observer values remain host-owned live getters. */
  let operationStages!: ReturnType<IBackendStageBindings['operationStages']>
  /** SQL observes only compiled statistics after operation admission. */
  let sqlStages!: ReturnType<IBackendStageBindings['sqlStages']>
  /** Codec observers bind each actual conversion to its current short view. */
  let codecStages!: ReturnType<IBackendStageBindings['codecStages']>
  /** Concurrency observations are passed into the same shared lock provider. */
  let concurrencyStages!: ReturnType<IBackendStageBindings['concurrencyStages']>
  /** Original transaction observers remain bound to their single host registry. */
  let transactionStages!: ReturnType<IBackendStageBindings['transactionStages']>
  /** Explicit and symbolic cleanup retain separate cached promises. */
  let symbolic: Promise<void> | undefined

  /** An observer never controls the result, including a hostile then getter or late rejection. */
  function observe(
    observer: object | undefined,
    name: string,
    first?: unknown,
    second?: unknown,
    third?: unknown
  ): void {
    if (!observer) return
    try {
      const handler = (observer as Record<string, unknown>)[name]
      if (typeof handler !== 'function') return
      /** Build invocation arguments only after a live observer actually exists. */
      const args =
        arguments.length === 2
          ? []
          : arguments.length === 3
            ? [first]
            : arguments.length === 4
              ? [first, second]
              : [first, second, third]
      const result = Reflect.apply(handler, observer, args)
      observeThenableRejection(result, inspectThenable(result), (error) =>
        reportCleanupError(report, error)
      )
    } catch (error) {
      reportCleanupError(report, error)
    }
  }
  /** Root calls cannot borrow the connection while any actual native transaction owns it. */
  const assertRoot = (): void => {
    controller.assertLive()
    if (active) throw sqliteError(SqliteErrorCode.transactionFailed)
  }
  /** Scope authorization returns the existing native attempt, never a copy or public marker. */
  const nativeFor = (scope: object): INativeState => {
    assertTransactionOwner(store, scope)
    if (!active || active === SQLITE_CONTROL_ACTIVE)
      throw sqliteError(SqliteErrorCode.transactionFailed)
    throwIfAborted(active.context?.signal)
    if (active.expiresAt !== undefined && Date.now() >= active.expiresAt)
      throw new StorageContractError(StorageContractErrorCode.lockLost)
    return active
  }
  /** Package SQL errors stay coded, and only native write BUSY can enter recovery. */
  const statement = <R>(
    text: string,
    values: readonly ISqliteValue[],
    method: 'get' | 'all' | 'run',
    state?: INativeState
  ): R => {
    try {
      return Reflect.apply(statements.get(text)[method], statements.get(text), values) as R
    } catch (error) {
      if (state?.mode === 'deferred' && method === 'run' && isBusy(error))
        throw new SqlitePhysicalBusy(error)
      throw normalizeSqliteFailure(error)
    }
  }
  /** Native code inspection walks only this trusted driver's cause chain. */
  const isBusy = (error: unknown): boolean => {
    /** Wrappers retain their original driver failure at bounded depth. */
    let current = error
    for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
      const candidate = current as Error & { errcode?: unknown; errno?: unknown; cause?: unknown }
      const code = candidate.errcode ?? candidate.errno
      if (typeof code === 'number') return code === 517 || (code & 255) === 5
      current = candidate.cause
    }
    return false
  }
  /** Bind one logical key to the existing physical table representation. */
  const encoded = (channel: IChannel, key: IStorageKey): string | Uint8Array => {
    const bytes = encodeOrderedStorageKey(key, SqliteNames.backend)
    return channel === 'record' ? bytes : keyHex(bytes)
  }
  /** Revision keys reuse the canonical original channel identity rather than another key format. */
  const identity = (channel: IChannel, key: IStorageKey): string =>
    channel === 'metadata'
      ? keyHex(encodeOrderedStorageKey(key, SqliteNames.backend))
      : snapshotConcurrencyLockKeys([{ channel, key }], SqliteNames.backend).identities[0]!
  /** Native diagnostics recognize the channel through original bounds without copying rank tags. */
  const identityRange = (id: string) => {
    const range = channelRanges.find(({ lower, upper }) => id >= lower && id < upper)
    if (!range)
      throw sqliteError(SqliteErrorCode.decodeFailed, new Error(SqliteErrorText.malformedKey))
    return range
  }
  /** Persistence decoding reuses canonical admission after removing the original channel prefix. */
  const decodeLockIdentity = (id: string): ILockKey => {
    const range = identityRange(id)
    const captured = snapshotConcurrencyLockKeys(
      [{ channel: range.channel, key: decodeHexKey(id.slice(range.lower.length)) }],
      SqliteNames.backend
    )
    if (captured.identities[0] !== id)
      throw sqliteError(SqliteErrorCode.decodeFailed, new Error(SqliteErrorText.malformedKey))
    return captured.keys[0]!
  }
  /** Read/write baselines retain missing-row tombstones in the original native revision table. */
  const revision = (state: INativeState, channel: IChannel, key: IStorageKey): void => {
    if (channel === 'metadata') return
    const id = identity(channel, key)
    if (!state.baseline.has(id)) {
      const row = wal
        ? statement<ISqliteRow | undefined>(
            `SELECT revision FROM ${tables.revisions} WHERE org_id=? AND key=?`,
            [state.orgId, id],
            'get'
          )
        : undefined
      state.baseline.set(id, wal ? Number(row?.revision ?? 0) : group!.revisions.read(channel, id))
    }
  }
  /** Every real mutation is tracked once for revision updates and post-commit publication. */
  const changed = (state: INativeState, channel: IChannel, key: IStorageKey): void => {
    revision(state, channel, key)
    let keys = state.changed.get(channel)
    if (!keys) {
      keys = new Map()
      state.changed.set(channel, keys)
    }
    const id = identity(channel, key)
    if (!keys.has(id)) keys.set(id, snapshotStorageKey(key, SqliteNames.backend))
    if (wal && channel !== 'metadata')
      statement(
        `INSERT INTO ${tables.revisions}(org_id,key,revision) VALUES(?,?,1) ON CONFLICT(org_id,key) DO UPDATE SET revision=revision+1`,
        [state.orgId, identity(channel, key)],
        'run',
        state
      )
  }
  /** The shared revision owner advances in the same synchronous turn as successful native COMMIT. */
  const advanceRevisions = (state: INativeState): void => {
    if (wal) return
    for (const channel of ['text', 'bytes', 'record'] as const)
      for (const id of state.changed.get(channel)?.keys() ?? []) group!.revisions.write(channel, id)
  }
  /** Actual codec calls share one failure policy for roots, scopes and iterator advances. */
  const convert = (
    channel: IChannel,
    direction: 'encode' | 'decode',
    value: unknown,
    scope?: object
  ): unknown => {
    const observer = scope ? codecStages.forTransaction(scope) : codecStages
    const codec = channel === 'text' ? textCodec : recordCodec
    const operation = channel
    observe(observer, direction === 'encode' ? 'beforeEncode' : 'beforeDecode', operation, codec.id)
    try {
      const result =
        direction === 'encode'
          ? channel === 'text'
            ? textCodec.encode(value as string)
            : recordCodec.encode(value as ICollectionsCodecValue)
          : codec.decode(value as string)
      observe(observer, direction === 'encode' ? 'afterEncode' : 'afterDecode', operation, codec.id)
      return result
    } catch (cause) {
      observe(
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
  const read = (
    channel: IChannel,
    key: IStorageKey,
    orgId: string,
    state?: INativeState,
    scope?: object
  ): unknown => {
    if (state) revision(state, channel, key)
    const row = statement<ISqliteRow | undefined>(
      `SELECT value${channel === 'metadata' ? '' : ',expires_at'} FROM ${tables[channel]} WHERE org_id=? AND key=?`,
      [orgId, encoded(channel, key)],
      'get',
      state
    )
    if (
      !row ||
      (channel !== 'metadata' && row.expires_at !== null && Number(row.expires_at) <= Date.now())
    )
      return channel === 'text' || channel === 'bytes' ? null : undefined
    return channel === 'bytes'
      ? (row.value as Uint8Array).slice()
      : convert(channel, 'decode', row.value, scope)
  }
  /** Expired cross-channel rows are reclaimed inside the same original native write transaction. */
  const prune = (channel: IChannel, key: IStorageKey, state: INativeState): void => {
    if (channel === 'metadata') return
    const result = statement<{ changes: number | bigint }>(
      `DELETE FROM ${tables[channel]} WHERE org_id=? AND key=? AND expires_at IS NOT NULL AND expires_at<=?`,
      [state.orgId, encoded(channel, key), Date.now()],
      'run',
      state
    )
    if (result.changes !== 0 && result.changes !== 0n) changed(state, channel, key)
  }
  /** One native write preserves atomic replace across all public channels. */
  const write = (
    channel: IChannel,
    key: IStorageKey,
    value: unknown,
    state: INativeState,
    policy: 'conflict' | 'replace',
    scope?: object,
    ttlMs?: number
  ): void => {
    /** Encode before any table mutation, including expiry cleanup and cross-channel removal. */
    const raw =
      channel === 'bytes'
        ? (value as Uint8Array).slice()
        : (convert(channel, 'encode', value, scope) as string)
    writeRaw(channel, key, raw, state, policy, ttlMs)
  }
  /** Prepared values cannot invoke caller code between final lock admission and native mutation. */
  const writeRaw = (
    channel: IChannel,
    key: IStorageKey,
    raw: string | Uint8Array,
    state: INativeState,
    policy: 'conflict' | 'replace',
    ttlMs?: number
  ): void => {
    if (channel !== 'metadata') {
      for (const other of ['text', 'bytes', 'record'] as const) {
        if (other === 'bytes' && typeof key !== 'string') continue
        prune(other, key, state)
        if (other === channel) continue
        const present = statement<ISqliteRow | undefined>(
          `SELECT key FROM ${tables[other]} WHERE org_id=? AND key=?`,
          [state.orgId, encoded(other, key)],
          'get',
          state
        )
        if (present) {
          if (policy !== 'replace') throw sqliteError(SqliteErrorCode.duplicateKey)
          statement(
            `DELETE FROM ${tables[other]} WHERE org_id=? AND key=?`,
            [state.orgId, encoded(other, key)],
            'run',
            state
          )
          changed(state, other, key)
        }
      }
    }
    statement(
      `INSERT INTO ${tables[channel]}(org_id,key,value${channel === 'metadata' ? '' : ',expires_at'}) VALUES(?,?,?${channel === 'metadata' ? '' : ',?'}) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value${channel === 'metadata' ? '' : ',expires_at=excluded.expires_at'}`,
      [
        state.orgId,
        encoded(channel, key),
        raw as ISqliteValue,
        ...(channel === 'metadata' ? [] : [ttlMs === undefined ? null : Date.now() + ttlMs])
      ],
      'run',
      state
    )
    changed(state, channel, key)
  }
  /** Single deletes mutate only their own channel and retain real affected-key revisions. */
  const remove = (channel: IChannel, key: IStorageKey, state: INativeState): boolean => {
    revision(state, channel, key)
    const result = statement<{ changes: number | bigint }>(
      `DELETE FROM ${tables[channel]} WHERE org_id=? AND key=?`,
      [state.orgId, encoded(channel, key)],
      'run',
      state
    )
    const mutated = result.changes !== 0 && result.changes !== 0n
    if (mutated) changed(state, channel, key)
    return mutated
  }
  /** Native ordered scans preserve the BLOB primary-key order without a JavaScript sort. */
  const recordRows = (
    orgId: string,
    range?: IKeyRange,
    state?: INativeState
  ): readonly ISqliteRow[] => {
    /** Range admission owns copies before native binding. */
    const captured = snapshotKeyRange(range, SqliteNames.backend)
    const clauses = ['org_id=?', '(expires_at IS NULL OR expires_at>?)']
    const values: ISqliteValue[] = [orgId, Date.now()]
    if (captured?.lower !== undefined) {
      clauses.push(`key${captured.lowerOpen ? '>' : '>='}?`)
      values.push(encodeOrderedStorageKey(captured.lower, SqliteNames.backend))
    }
    if (captured?.upper !== undefined) {
      clauses.push(`key${captured.upperOpen ? '<' : '<='}?`)
      values.push(encodeOrderedStorageKey(captured.upper, SqliteNames.backend))
    }
    return statement(
      `SELECT key,value FROM ${tables.record} WHERE ${clauses.join(' AND ')} ORDER BY key`,
      values,
      'all',
      state
    )
  }

  /** Bind original host operation observation without granting observers control. */
  const operation = <I, R>(
    name: string,
    input: I,
    context: IOperationContext | undefined,
    scope: object | undefined,
    run: (captured: I) => R
  ): Promise<Awaited<R>> => {
    /** The original owner admits scope work synchronously before pipeline or codec work. */
    const execute = (currentScope?: object): Promise<Awaited<R>> =>
      core.execution.run<I, Awaited<R>>(
        { operation: name, input, ctx: context, scope: currentScope },
        async (captured): Promise<Awaited<R>> => {
          const observer = currentScope
            ? operationStages.forTransaction(currentScope)
            : operationStages
          const started = Date.now()
          observe(observer, 'beforeStorageOperation', name)
          try {
            const result = await run(captured)
            observe(observer, 'afterStorageOperation', name, Date.now() - started, 1)
            return result as Awaited<R>
          } catch (error) {
            observe(observer, 'onStorageOperationError', name, (error as { code?: unknown })?.code)
            throw error
          }
        }
      )
    return scope ? runTransactionOperation(scope, (current) => execute(current)) : execute()
  }
  /** Synchronous calls use the original stage list and cannot wait for async middleware. */
  const synchronous = <R>(name: string, input: unknown, run: () => R): R => {
    assertRoot()
    return core.execution.runSync({ operation: name, input }, () => {
      observe(operationStages, 'beforeStorageOperation', name)
      const started = Date.now()
      try {
        const result = run()
        observe(operationStages, 'afterStorageOperation', name, Date.now() - started, 1)
        return result
      } catch (error) {
        observe(
          operationStages,
          'onStorageOperationError',
          name,
          (error as { code?: unknown })?.code
        )
        throw error
      }
    })
  }
  /** Every transaction data entry receives its actual newly authorized operation view. */
  const scoped = <R>(
    scope: object,
    name: string,
    input: unknown,
    run: (state: INativeState, current: ISqliteTransactionScope<TValue>) => R
  ): Promise<Awaited<R>> =>
    runTransactionOperation(scope, (current) => {
      const state = nativeFor(current)
      /** Capture inside original admission, before an asynchronous pipeline can wait. */
      const capturedInput = typeof input === 'function' ? input() : input
      return core.execution.run(
        { operation: name, input: capturedInput, scope: current },
        async () => {
          const observer = operationStages.forTransaction(current)
          const transactionObserver = transactionStages.forTransaction(current)
          observe(transactionObserver, 'beforeTxOperation', name)
          observe(observer, 'beforeStorageOperation', name)
          const started = Date.now()
          try {
            const result = await run(state, current as ISqliteTransactionScope<TValue>)
            observe(transactionObserver, 'afterTxOperation', name)
            observe(observer, 'afterStorageOperation', name, Date.now() - started, 1)
            return result as Awaited<R>
          } catch (error) {
            observe(observer, 'onStorageOperationError', name, (error as { code?: unknown })?.code)
            throw error
          }
        }
      )
    })
  /** String inputs use the existing key owner and the channel's narrow value contract. */
  const textInput = (key: string, value?: unknown, writing = false): void => {
    assertStringStorageKey(key, SqliteNames.backend)
    if (writing && typeof value !== 'string')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: SqliteNames.backend,
        cause: new TypeError(SqliteErrorText.textValue)
      })
  }
  /** Binary data is captured before asynchronous stages can retain caller-owned views. */
  const bytesInput = (key: string, value: Uint8Array): Uint8Array => {
    assertStringStorageKey(key, SqliteNames.backend)
    if (!(value instanceof Uint8Array))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: SqliteNames.backend,
        cause: new TypeError(SqliteErrorText.byteValue)
      })
    return value.slice()
  }
  /** Root reads own a short lease and never join an active callback's connection. */
  const rootRead = <R>(
    name: string,
    input: unknown,
    ctx: IOperationContext | undefined,
    run: (orgId: string) => R
  ): Promise<Awaited<R>> => {
    controller.assertLive()
    const finish = controller.beginMutation()
    return withAbort<Awaited<R>>(ctx, async (signal, context): Promise<Awaited<R>> => {
      assertRoot()
      throwIfAborted(signal)
      return operation(name, input, context, undefined, () => {
        assertRoot()
        throwIfAborted(signal)
        return run(context?.orgId ?? runtime.orgId)
      })
    }).finally(finish)
  }
  /** Root mutations declare affected original channel keys before logical lock acquisition. */
  const rootWrite = <I, R>(
    name: string,
    input: I,
    ctx: IOperationContext | undefined,
    prepare: (captured: I) => IRootMutation<R>
  ): Promise<Awaited<R>> => {
    controller.assertLive()
    const finish = controller.beginMutation()
    /** The original loop owns the deadline before the one asynchronous pipeline can begin. */
    let capturedInput!: I
    /** Fixed preparation retains only this operation's payload and exact affected keys. */
    let mutation!: IRootMutation<R>
    /** A timestamp exists only after the pipeline has reached the actual operation endpoint. */
    let started: number | undefined
    return runWithConcurrency<Awaited<R>>(
      {
        store,
        options: ctx ?? {},
        prepare: (context) =>
          core.execution.run<I, void>(
            { operation: name, input, ctx: context },
            async (captured) => {
              throwIfAborted(context.signal)
              capturedInput = captured
              started = Date.now()
              observe(operationStages, 'beforeStorageOperation', name)
            }
          ),
        lock: () => {
          mutation = prepare(capturedInput)
          return mutation.keys
        }
      },
      {
        attempt: async (context) => {
          const guard = mutation.guard
          const ranges = guard ? lockRanges(guard) : []
          const ids = readConcurrencyLockIdentities(context)
          /** Logical fail decisions remain observable before entering the physical queue. */
          const conflict = wal ? conflictingLock(context, ids, '') : undefined
          const range =
            wal && guard ? rangeConflict(context.orgId ?? runtime.orgId, guard) : undefined
          if ((conflict || range) && context.admission === 'try')
            return {
              status: 'conflict' as const,
              phase: 'acquire' as const,
              keys: conflict ? [conflict.key] : range!.keys,
              holder: conflict ? holderOf(conflict.row) : range!.holder
            }
          while (true) {
            throwIfAborted(context.signal)
            try {
              const write = () =>
                syncMutation(
                  mutation.run,
                  context.lock ?? [],
                  guard,
                  context.orgId ?? runtime.orgId,
                  context
                ) as Awaited<R>
              return wal
                ? await physicalRun(context, () =>
                    walAttempt(context, async () => ({
                      status: 'committed' as const,
                      value: write()
                    }))
                  )
                : await group!.locks.attemptWrite(
                    context,
                    {
                      owner: controller.origin,
                      ...(label === undefined ? {} : { label }),
                      since: Date.now(),
                      status: 'held',
                      scope: 'local'
                    },
                    write,
                    concurrencyStages,
                    controller.closingSignal,
                    ranges,
                    (commit) => physicalRun(context, commit)
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
              } else if (!(error instanceof AggregateError) && isBusy(error))
                await context.waitPhysical(sleep(SqliteLimits.pollMs, { signal: context.signal }))
              else throw error
            }
          }
        }
      }
    )
      .then(
        (value) => {
          if (started !== undefined)
            observe(operationStages, 'afterStorageOperation', name, Date.now() - started, 1)
          return value
        },
        (error) => {
          if (started !== undefined)
            observe(
              operationStages,
              'onStorageOperationError',
              name,
              (error as { code?: unknown })?.code
            )
          throw error
        }
      )
      .finally(finish)
  }
  /** Standard channel preparation owns payload conversion before the shared lock provider runs. */
  const prepareWrite = (
    channel: 'text' | 'bytes' | 'record',
    key: IStorageKey,
    value: unknown
  ): IRootMutation<void> => {
    const raw =
      channel === 'bytes'
        ? (value as Uint8Array).slice()
        : (convert(channel, 'encode', value) as string)
    return {
      keys:
        typeof key === 'string'
          ? [lockKey.text(key), lockKey.bytes(key), lockKey.record(key)]
          : [lockKey.text(key), lockKey.record(key)],
      run: (state) =>
        writeRaw(
          channel,
          key,
          raw,
          state,
          readTransactionConflictPolicy(state.context, SqliteNames.backend)
        )
    }
  }
  /** Complete batch input is snapshotted once before a native request or stage starts. */
  const batchKeys = (keys: readonly IStorageKey[]): readonly IStorageKey[] => {
    if (!Array.isArray(keys))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        cause: new TypeError(SqliteErrorText.batch)
      })
    return keys.map((key) => snapshotStorageKey(key, SqliteNames.backend))
  }
  /** Batch get uses bounded IN lists inside one real native transaction snapshot. */
  const getMany = (
    keys: readonly IStorageKey[],
    state: INativeState,
    scope: object
  ): readonly (string | undefined)[] => {
    const result = new Map<string, string>()
    const captured = keys.map((key) => keyHex(encodeOrderedStorageKey(key, SqliteNames.backend)))
    for (let index = 0; index < captured.length; index += SqliteLimits.batch) {
      const part = captured.slice(index, index + SqliteLimits.batch)
      const rows = statement<readonly ISqliteRow[]>(
        `SELECT key,value FROM ${tables.text} WHERE org_id=? AND (expires_at IS NULL OR expires_at>?) AND key IN (${part.map(() => '?').join(',')})`,
        [state.orgId, Date.now(), ...part],
        'all',
        state
      )
      for (const row of rows)
        result.set(row.key as string, convert('text', 'decode', row.value, scope) as string)
    }
    for (const key of keys) revision(state, 'text', key)
    return captured.map((key) => result.get(key))
  }
  /** Prefix bounds come from the canonical key owner and hit the existing ordered primary key. */
  const removePrefix = (
    channel: 'text' | 'record',
    prefix: IStorageKey,
    state: INativeState
  ): number => {
    const held = rangeConflict(state.orgId, { channels: [channel], prefix }, state.context)
    if (held) throw new SqliteLogicalConflict(held.keys, held.holder)
    const range = snapshotStorageKeyPrefix(prefix, SqliteNames.backend)
    const lower = channel === 'record' ? range.lower : keyHex(range.lower)
    const upper = channel === 'record' ? range.upper : keyHex(range.upper)
    const rows = statement<readonly ISqliteRow[]>(
      `SELECT key FROM ${tables[channel]} WHERE org_id=? AND key>=? AND key<?`,
      [state.orgId, lower, upper],
      'all',
      state
    )
    /** Baselines are captured before mutation, including physical expired matches. */
    for (const row of rows)
      revision(
        state,
        channel,
        channel === 'record' ? decodeKey(row.key as Uint8Array) : decodeHexKey(row.key as string)
      )
    statement(
      `DELETE FROM ${tables[channel]} WHERE org_id=? AND key>=? AND key<?`,
      [state.orgId, lower, upper],
      'run',
      state
    )
    for (const row of rows)
      changed(
        state,
        channel,
        channel === 'record' ? decodeKey(row.key as Uint8Array) : decodeHexKey(row.key as string)
      )
    return rows.length
  }
  /** Create the full scope afresh for callback, accepted operation and final validation views. */
  const createScope = (): ISqliteTransactionScope<TValue> => {
    /** Method arrows capture this exact scope identity, never an older callback view. */
    const scope: ISqliteTransactionScope<TValue> = {
      use: (capability) => useTransactionCapability(scope, capability),
      get: (key) =>
        scoped(scope, SqliteOperation.get, { key }, (state, current) => {
          textInput(key)
          return read('text', key, state.orgId, state, current) as string | null
        }),
      set: (key, value, options) =>
        scoped(scope, SqliteOperation.set, { key, value, options }, (state, current) => {
          textInput(key, value, true)
          write(
            'text',
            key,
            value,
            state,
            readTransactionConflictPolicy(options, SqliteNames.backend),
            current
          )
        }),
      remove: (key) =>
        scoped(scope, SqliteOperation.remove, { key }, (state) => {
          textInput(key)
          remove('text', key, state)
        }),
      has: (key) =>
        scoped(scope, SqliteOperation.has, { key }, (state, current) => {
          textInput(key)
          return read('text', key, state.orgId, state, current) !== null
        }),
      getBytes: (key) =>
        scoped(scope, SqliteOperation.getBytes, { key }, (state, current) => {
          textInput(key)
          return read('bytes', key, state.orgId, state, current) as Uint8Array | null
        }),
      setBytes: (key, value, options) => {
        let bytes: Uint8Array
        return scoped(
          scope,
          SqliteOperation.setBytes,
          () => {
            bytes = bytesInput(key, value)
            return { key, value: bytes, options }
          },
          (state, current) =>
            write(
              'bytes',
              key,
              bytes,
              state,
              readTransactionConflictPolicy(options, SqliteNames.backend),
              current
            )
        )
      },
      removeBytes: (key) =>
        scoped(scope, SqliteOperation.removeBytes, { key }, (state) => {
          textInput(key)
          remove('bytes', key, state)
        }),
      getRecord: (key) => {
        let captured: IStorageKey
        return scoped(
          scope,
          SqliteOperation.getRecord,
          () => {
            captured = snapshotStorageKey(key, SqliteNames.backend)
            return { key: captured }
          },
          (state, current) =>
            read('record', captured, state.orgId, state, current) as TValue | undefined
        )
      },
      putRecord: (value, key, options) => {
        let captured: IStorageKey | undefined
        return scoped(
          scope,
          SqliteOperation.putRecord,
          () => {
            captured = key === undefined ? undefined : snapshotStorageKey(key, SqliteNames.backend)
            return { value, key: captured, options }
          },
          (state, current) => {
            const actual =
              captured ??
              String(statement<ISqliteRow>(SqliteControl.generatedKey, [], 'get', state).key)
            write(
              'record',
              actual,
              value,
              state,
              readTransactionConflictPolicy(options, SqliteNames.backend),
              current
            )
            return actual
          }
        )
      },
      deleteRecord: (key) => {
        let captured: IStorageKey
        return scoped(
          scope,
          SqliteOperation.deleteRecord,
          () => {
            captured = snapshotStorageKey(key, SqliteNames.backend)
            return { key: captured }
          },
          (state) => {
            remove('record', captured, state)
          }
        )
      },
      getMany: (keys) => {
        if (Array.isArray(keys) && keys.length === 0)
          return runTransactionOperation(scope, () => [])
        let captured: readonly IStorageKey[]
        return scoped(
          scope,
          SqliteOperation.getMany,
          () => {
            captured = batchKeys(keys)
            return { keys: captured }
          },
          (state, current) => getMany(captured, state, current)
        )
      },
      setMany: (entries) => {
        if (Array.isArray(entries) && entries.length === 0)
          return runTransactionOperation(scope, () => undefined)
        let captured: readonly {
          readonly key: IStorageKey
          readonly value: string
          readonly ttlMs?: number
        }[]
        return scoped(
          scope,
          SqliteOperation.setMany,
          () => {
            if (!Array.isArray(entries))
              throw new StorageContractError(StorageContractErrorCode.invalidArgument)
            /** Canonical identity detects duplicate typed keys before any table or stage changes. */
            const seen = new Set<string>()
            captured = entries.map((entry) => {
              const key = snapshotStorageKey(entry.key, SqliteNames.backend)
              const id = keyHex(encodeOrderedStorageKey(key, SqliteNames.backend))
              const value = entry.value
              const ttlMs = entry.ttlMs
              if (
                seen.has(id) ||
                typeof value !== 'string' ||
                (ttlMs !== undefined && (!Number.isSafeInteger(ttlMs) || ttlMs < 0))
              )
                throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
                  cause: new TypeError(SqliteErrorText.batch)
                })
              seen.add(id)
              return { key, value, ttlMs }
            })
            return { entries: captured }
          },
          (state, current) => {
            for (const entry of captured)
              write('text', entry.key, entry.value, state, 'conflict', current, entry.ttlMs)
          }
        )
      },
      removeMany: (keys) => {
        if (Array.isArray(keys) && keys.length === 0) return runTransactionOperation(scope, () => 0)
        let captured: readonly IStorageKey[]
        return scoped(
          scope,
          SqliteOperation.removeMany,
          () => {
            captured = batchKeys(keys)
            return { keys: captured }
          },
          (state) => {
            let count = 0
            for (const key of captured) if (remove('text', key, state)) count++
            return count
          }
        )
      },
      removeByPrefix: (prefix) => {
        let captured: IStorageKey
        return scoped(
          scope,
          SqliteOperation.removeByPrefix,
          () => {
            captured = snapshotStorageKey(prefix, SqliteNames.backend)
            return { prefix: captured }
          },
          (state) => removePrefix('text', captured, state)
        )
      },
      iterateRecords: (range) => transactionIterator(scope, range),
      ...createSqliteExecutor(
        (prepare, ctx, run) =>
          scoped(scope, SqliteOperation.sql, {}, (state, current) =>
            executeSql(prepare, ctx, run, state, current)
          ),
        statements
      )
    }
    return scope
  }
  /** SQL statistics use the shared compile output and retain native result shape and error cause. */
  const executeSql = <R>(
    prepare: () => ICompiledStorageSql,
    ctx: IOperationContext | undefined,
    run: (compiled: ICompiledStorageSql) => R,
    state?: INativeState,
    scope?: ISqliteTransactionScope<TValue>
  ): R => {
    /** Root SQL never joins another native attempt; scope SQL validates its original owner first. */
    if (scope) nativeFor(scope)
    else assertRoot()
    const context = snapshotOperationContext(ctx)
    throwIfAborted(context?.signal)
    const compiled = prepare()
    const observer = scope ? sqlStages.forTransaction(scope) : sqlStages
    const started = Date.now()
    observe(observer, 'beforeSql', compiled.values.length, compiled.text.length)
    try {
      const result = run(compiled)
      observe(
        observer,
        'afterSql',
        Date.now() - started,
        Array.isArray(result)
          ? result.length
          : result && typeof result === 'object' && 'changes' in result
            ? result.changes
            : result === undefined
              ? 0
              : 1
      )
      return result
    } catch (error) {
      observe(observer, 'onSqlError', (error as { code?: unknown })?.code)
      if (state?.mode === 'deferred' && isBusy(error)) throw new SqlitePhysicalBusy(error)
      throw normalizeSqliteFailure(error)
    }
  }
  /** Transaction snapshots register with the existing scope owner and decode on fresh views. */
  const transactionIterator = (
    scope: ISqliteTransactionScope<TValue>,
    range?: IKeyRange
  ): IStorageIterator<[IStorageKey, TValue]> => {
    const state = nativeFor(scope)
    let rows: readonly ISqliteRow[] | undefined
    let position = 0
    return transactionOwner.registerIterator<
      ISqliteTransactionScope<TValue>,
      [IStorageKey, TValue]
    >(scope, {
      next: (current) =>
        scoped(current, SqliteOperation.next, { range }, (actual, currentScope) => {
          if (rows === undefined) rows = recordRows(actual.orgId, range, actual)
          const row = rows[position++]
          if (!row) return { done: true, value: undefined }
          const key = decodeKey(row.key as Uint8Array)
          revision(state, 'record', key)
          return {
            done: false,
            value: [key, convert('record', 'decode', row.value, currentScope) as TValue] as [
              IStorageKey,
              TValue
            ]
          }
        }),
      close: () => {
        rows = []
        observe(operationStages, 'onStorageIterationClose', position)
      }
    })
  }

  /** Busy classification is restricted to trusted native transaction control boundaries. */
  const control = async (
    text: string,
    context: IConcurrencyAttemptContext,
    cleanup = false,
    committed?: () => void
  ): Promise<void> => {
    while (true) {
      if (!cleanup) throwIfAborted(context.signal)
      try {
        statements.get(text).run()
        if (
          (text === SqliteControl.begin || text === SqliteControl.deferred) &&
          active === undefined
        )
          active = SQLITE_CONTROL_ACTIVE
        else if (
          (text === SqliteControl.commit || text === SqliteControl.rollback) &&
          active === SQLITE_CONTROL_ACTIVE
        )
          active = undefined
        if (text === SqliteControl.commit) committed?.()
        return
      } catch (error) {
        if (!isBusy(error)) throw normalizeSqliteFailure(error)
        if (cleanup) await sleep(SqliteLimits.pollMs)
        else await context.waitPhysical(sleep(SqliteLimits.pollMs, { signal: context.signal }))
      }
    }
  }
  /** Actual native rollback clears only a successfully ended trusted control segment. */
  const rollbackNative = (): void => {
    statements.get(SqliteControl.rollback).run()
    if (active === SQLITE_CONTROL_ACTIVE) active = undefined
  }
  /** The native rollback error is secondary and never replaces the first callback/operation failure. */
  const rollback = (primary: unknown): never => {
    try {
      rollbackNative()
    } catch (secondary) {
      /** Original errors stay in order, including the exact native rollback object. */
      throw transactionCleanupFailure(primary, secondary)
    }
    throw primary
  }
  /** Read one actual lock row, retaining expiration and last-known holder metadata. */
  const lockRow = (orgId: string, id: string): ISqliteRow | undefined =>
    statement(
      `SELECT owner,label,pid,since,expires_at,attempt_token FROM ${tables.locks} WHERE org_id=? AND key=?`,
      [orgId, id],
      'get'
    )
  /** Lock identity projection contains only documented diagnostics, never the private attempt token. */
  const holderOf = (row: ISqliteRow): IConcurrencyHolder => ({
    owner: String(row.owner),
    ...(typeof row.label === 'string' ? { label: row.label } : {}),
    ...(typeof row.pid === 'number' ? { pid: row.pid } : {}),
    since: Number(row.since),
    status: 'held',
    scope: row.owner === controller.origin ? 'local' : 'remote'
  })
  /** Range conflicts are native lock evidence; they never infer business conflict from SQLITE_BUSY. */
  const rangeConflict = (
    orgId: string,
    guard: IWriteGuard,
    current?: IConcurrencyAttemptContext
  ):
    | { readonly keys: readonly ILockKey[]; readonly holder: IConcurrencyHolder | undefined }
    | undefined => {
    if (!wal) {
      const holding = group!.locks.probe([], lockRanges(guard), current)
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
    const rows = statement<readonly ISqliteRow[]>(
      `SELECT key,owner,label,pid,since,expires_at,attempt_token FROM ${tables.locks} WHERE org_id=? AND expires_at>? AND (${conditions.join(' OR ')})`,
      values,
      'all'
    )
    for (const row of rows) {
      const id = row.key as string
      if (
        current !== undefined &&
        expectedToken?.context === current &&
        row.attempt_token === expectedToken.token &&
        row.owner === controller.origin
      )
        continue
      return {
        keys: [decodeLockIdentity(id)],
        holder: holderOf(row)
      }
    }
    return
  }
  /** The canonical owner computes bounds; this backend supplies only known affected channels. */
  const lockRanges = (guard: IWriteGuard) =>
    guard.channels.map((channel) => ({
      channel,
      ...snapshotConcurrencyLockRange({ channel, prefix: guard.prefix }, SqliteNames.backend)
    }))
  /** Logical conflicts are visible before any attempt to acquire SQLite's physical writer lock. */
  const conflictingLock = (
    context: IConcurrencyAttemptContext,
    ids: readonly string[],
    token: string
  ): { readonly row: ISqliteRow; readonly key: ILockKey } | undefined => {
    for (const [index, id] of ids.entries()) {
      const row = lockRow(context.orgId ?? runtime.orgId, id)
      if (row && row.attempt_token !== token && Number(row.expires_at) > Date.now())
        return { row, key: context.lock![index]! }
    }
    return undefined
  }
  /** SQLite's WAL lock table uses the shared model; the original loop still owns strategy and retry. */
  const walAttempt = async <R>(
    context: IConcurrencyAttemptContext,
    run: () => Promise<IConcurrencyAttempt<R>>
  ): Promise<IConcurrencyAttempt<R>> => {
    if (context.locking === 'optimistic' || !context.lock?.length) return run()
    const ids = readConcurrencyLockIdentities(context)
    const token = String(statement<ISqliteRow>(SqliteControl.generatedKey, [], 'get').key)
    const orgId = context.orgId ?? runtime.orgId
    let since = 0
    let expiresAt = 0
    while (true) {
      const conflict = conflictingLock(context, ids, token)
      if (conflict) {
        if (context.admission === 'try')
          return {
            status: 'conflict',
            phase: 'acquire',
            keys: context.lock,
            holder: holderOf(conflict.row)
          }
        await context.wait(sleep(SqliteLimits.pollMs, { signal: context.signal }))
        continue
      }
      /** This short native segment rechecks before writing any lock rows. */
      await control(SqliteControl.begin, context)
      try {
        const raced = conflictingLock(context, ids, token)
        if (raced) {
          rollbackNative()
          if (context.admission === 'try')
            return {
              status: 'conflict',
              phase: 'acquire',
              keys: context.lock,
              holder: holderOf(raced.row)
            }
          await context.wait(sleep(SqliteLimits.pollMs, { signal: context.signal }))
          continue
        }
        since = Date.now()
        expiresAt = since + maxLockMs
        for (const id of ids)
          statement(
            `INSERT INTO ${tables.locks}(org_id,key,owner,attempt_token,label,pid,since,expires_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(org_id,key) DO UPDATE SET owner=excluded.owner,attempt_token=excluded.attempt_token,label=excluded.label,pid=excluded.pid,since=excluded.since,expires_at=excluded.expires_at`,
            [
              orgId,
              id,
              controller.origin,
              token,
              label ?? null,
              typeof process === 'object' ? process.pid : null,
              since,
              expiresAt
            ],
            'run'
          )
        await control(SqliteControl.commit, context)
        break
      } catch (error) {
        rollback(error)
      }
    }
    observe(concurrencyStages, 'onLockAcquired', context.attempt, ids.length)
    /** Cleanup failure keeps the earlier callback/cancellation failure first. */
    let primary: unknown
    let failed = false
    let result: IConcurrencyAttempt<R> | undefined
    try {
      result = await runWithWalToken(context, token, expiresAt, run)
    } catch (error) {
      primary = error
      failed = true
    }
    try {
      /** A late cleanup removes only this exact owner/token, even after caller cancellation. */
      await control(SqliteControl.begin, context, true)
      for (const id of ids)
        statement(
          `DELETE FROM ${tables.locks} WHERE org_id=? AND key=? AND owner=? AND attempt_token=?`,
          [orgId, id, controller.origin, token],
          'run'
        )
      await control(SqliteControl.commit, context, true)
    } catch (error) {
      let cleanup: unknown = error
      try {
        rollbackNative()
      } catch (secondary) {
        cleanup = transactionCleanupFailure(error, secondary)
      }
      throw failed
        ? transactionCleanupFailure(primary, cleanup)
        : normalizeTransactionFailure(cleanup)
    }
    observe(concurrencyStages, 'onLockReleased', context.attempt, ids.length)
    if (failed) throw primary
    return result!
  }
  /** Work token is scoped to the real driver's admission interval, not public scope properties. */
  let expectedToken:
    | {
        readonly context: IConcurrencyAttemptContext
        readonly token: string
        readonly expiresAt: number
      }
    | undefined
  /** Preserve one temporary native token binding without another owner registry. */
  const runWithWalToken = async <R>(
    context: IConcurrencyAttemptContext,
    token: string,
    expiresAt: number,
    run: () => Promise<IConcurrencyAttempt<R>>
  ): Promise<IConcurrencyAttempt<R>> => {
    expectedToken = { context, token, expiresAt }
    try {
      return await run()
    } finally {
      expectedToken = undefined
    }
  }

  /** Run one actual callback and owner lifecycle, retaining native isolation through cleanup. */
  const nativeAttempt = async <R>(
    context: IConcurrencyAttemptContext,
    callback: (scope: ISqliteTransactionScope<TValue>) => R
  ): Promise<IConcurrencyAttempt<Awaited<R>>> => {
    /** Original baseline survives only internal physical recovery, never a strategy retry. */
    const baseline = new Map<string, number>()
    /** A physical upgrade recovery changes only the native BEGIN, not the strategy attempt number. */
    let recover = false
    while (true) {
      const state: INativeState = {
        orgId: context.orgId ?? runtime.orgId,
        context,
        baseline,
        changed: new Map(),
        expiresAt: expectedToken?.expiresAt,
        mode: recover || context.locking === 'pessimistic' ? 'immediate' : 'deferred',
        failure: undefined
      }
      active = state
      /** Native BEGIN failures do not create a false transaction or emit a rollback. */
      let begun = false
      /** Scope registration owns all short views and deferred work in this physical attempt. */
      let registration: ReturnType<typeof transactionOwner.register> | undefined
      /** A single callback result survives await and return identity unchanged. */
      let value: Awaited<R> | undefined
      /** Terminal events retain immutable transaction facts after data views expire. */
      let terminal: ReturnType<IBackendStageBindings['transactionStages']> | undefined
      try {
        observe(transactionStages, 'beforeTransaction')
        await control(
          state.mode === 'immediate' ? SqliteControl.begin : SqliteControl.deferred,
          context
        )
        begun = true
        if (expectedToken) {
          for (const id of readConcurrencyLockIdentities(context)) {
            const row = lockRow(state.orgId, id)
            if (
              !row ||
              row.owner !== controller.origin ||
              row.attempt_token !== expectedToken.token
            )
              throw new StorageContractError(StorageContractErrorCode.lockLost)
          }
        }
        if (recover) {
          /** Compare in the new writer transaction before the callback can change its own baseline. */
          for (const [id, expected] of baseline) {
            const channel = identityRange(id).channel
            const row = wal
              ? statement<ISqliteRow | undefined>(
                  `SELECT revision FROM ${tables.revisions} WHERE org_id=? AND key=?`,
                  [state.orgId, id],
                  'get'
                )
              : undefined
            if (
              (wal ? Number(row?.revision ?? 0) : group!.revisions.read(channel, id)) !== expected
            ) {
              rollbackNative()
              begun = false
              return {
                status: 'conflict',
                phase: 'commit',
                keys: context.lock ?? [],
                holder: undefined
              }
            }
          }
        }
        const scope = createScope()
        registration = transactionOwner.register(scope, {
          createScope,
          onFailure: (failure) => {
            state.failure ??= failure
          },
          beforeCommit: (checkScope) =>
            observe(transactionStages.forTransaction(checkScope), 'beforeCommit')
        })
        terminal = transactionStages.forTransaction(scope)
        observe(terminal, 'onTransactionStart')
        try {
          value = (await callback(scope)) as Awaited<R>
        } catch (error) {
          state.failure ??= normalizeTransactionFailure(error)
        } finally {
          registration.stopAdmission()
        }
        if (state.failure) throw state.failure
        await registration.runFinalizers()
        throwIfAborted(context.signal)
        if (state.expiresAt !== undefined && Date.now() >= state.expiresAt)
          throw new StorageContractError(StorageContractErrorCode.lockLost)
        await control(SqliteControl.commit, context, false, () => {
          begun = false
          advanceRevisions(state)
        })
        let changedKeys = 0
        for (const keys of state.changed.values()) changedKeys += keys.size
        observe(terminal, 'afterCommit', changedKeys)
        /** Publication occurs only after actual native COMMIT; rollback publishes nothing. */
        for (const channel of ['text', 'bytes', 'record'] as const) {
          const keys = state.changed.get(channel)
          if (!keys?.size) continue
          controller.publish({
            channel: channel === 'text' ? 'value' : channel,
            kind: 'batch',
            keys: [...keys.values()]
          })
        }
        return { status: 'committed', value: value as Awaited<R> }
      } catch (error) {
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
          registration?.stopAdmission()
          await registration?.closeIterators()
        } catch (cleanup) {
          if (cleanup !== error) failure = transactionCleanupFailure(error, cleanup)
        }
        if (begun) {
          try {
            rollbackNative()
            begun = false
            observe(terminal, 'afterRollback', (failure as { code?: unknown })?.code)
          } catch (secondary) {
            throw transactionCleanupFailure(failure, secondary)
          }
        }
        if (physical && !recover && failure === error) {
          observe(concurrencyStages, 'onRetry', context.attempt, 0, 'physical')
          recover = true
          continue
        }
        if (logical && failure === error)
          return {
            status: 'conflict',
            phase: 'acquire',
            keys: logical.keys,
            holder: logical.holder
          }
        throw normalizeTransactionFailure(failure)
      } finally {
        registration?.close()
        if (registration) observe(terminal, 'onTransactionClose')
        /** Failed rollback keeps actual unknown native ownership sealed against root access. */
        active = begun ? SQLITE_CONTROL_ACTIVE : undefined
      }
    }
  }
  /** The existing utility FIFO owns physical admission; only queue time enters waitPhysical. */
  const physicalRun = async <R>(
    context: IConcurrencyAttemptContext,
    run: () => R | Promise<R>
  ): Promise<R> => {
    const admission = createAbortController()
    const admitted = deferred<void>()
    const unsubscribeContext = subscribeToAbort(
      context.signal,
      () => admission.abort(readAbortReason(context.signal)),
      report
    )
    const unsubscribeClosing = subscribeToAbort(
      controller.closingSignal,
      () =>
        admission.abort(
          new StorageContractError(StorageContractErrorCode.aborted, {
            cause: readAbortReason(controller.closingSignal)
          })
        ),
      report
    )
    const finished = physicalAdmission.run(
      async () => {
        admitted.resolve()
        controller.assertLive()
        if (active !== undefined) throw sqliteError(SqliteErrorCode.transactionFailed)
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
          reportCleanupError(report, secondary)
      }
      throw primary
    } finally {
      unsubscribeClosing()
      unsubscribeContext()
    }
  }
  /** All public transactions enter the existing concurrency loop and original physical limiter. */
  const transact = <R>(
    callback: (scope: ISqliteTransactionScope<TValue>) => R,
    options: ITransactionOptions = {}
  ): Promise<Awaited<R>> => {
    assertTransactionCallback(callback, SqliteNames.backend)
    controller.assertLive()
    const finish = controller.beginMutation()
    const result = runWithConcurrency<Awaited<R>>(
      { store, options },
      {
        attempt: async (context) => {
          const run = () =>
            physicalRun(context, () => {
              const invoke = () => nativeAttempt(context, callback)
              const execute = () => (wal ? walAttempt(context, invoke) : invoke())
              return core.execution.run(
                { operation: SqliteOperation.transaction, input: {}, ctx: context },
                execute
              )
            })
          if (wal && context.locking === 'pessimistic' && context.lock?.length) {
            const ids = readConcurrencyLockIdentities(context)
            const conflict = conflictingLock(context, ids, '')
            if (conflict && context.admission === 'try')
              return Promise.resolve({
                status: 'conflict',
                phase: 'acquire',
                keys: context.lock,
                holder: holderOf(conflict.row)
              })
          }
          return wal
            ? run()
            : group!.locks.attempt(
                context,
                {
                  owner: controller.origin,
                  ...(label === undefined ? {} : { label }),
                  since: Date.now(),
                  status: 'held',
                  scope: 'local'
                },
                { attempt: run },
                concurrencyStages,
                controller.closingSignal
              )
        }
      }
    )
    return result.finally(finish)
  }

  /** Clear enumerates only rows actually affected, for original revision and change ownership. */
  const clear = (channels: readonly IChannel[], state: INativeState): void => {
    /** Recheck inside the native writer before any row is removed. */
    const held = rangeConflict(
      state.orgId,
      { channels: channels.filter((channel) => channel !== 'metadata') },
      state.context
    )
    if (held) throw new SqliteLogicalConflict(held.keys, held.holder)
    for (const channel of channels) {
      const rows = statement<readonly ISqliteRow[]>(
        `SELECT key FROM ${tables[channel]} WHERE org_id=?`,
        [state.orgId],
        'all',
        state
      )
      for (const row of rows) {
        const key =
          channel === 'record' ? decodeKey(row.key as Uint8Array) : decodeHexKey(row.key as string)
        revision(state, channel, key)
        changed(state, channel, key)
      }
      statement(`DELETE FROM ${tables[channel]} WHERE org_id=?`, [state.orgId], 'run', state)
    }
  }
  /** String-only legacy keys omit typed batch keys while retaining canonical identity. */
  const textKeys = (orgId: string): string[] => {
    const rows = statement<readonly ISqliteRow[]>(
      `SELECT key FROM ${tables.text} WHERE org_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY key`,
      [orgId, Date.now()],
      'all'
    )
    const keys: string[] = []
    for (const row of rows) {
      const key = decodeHexKey(row.key as string)
      if (typeof key === 'string') keys.push(key)
    }
    return keys
  }
  /** Synchronous mutation keeps its complete replace in one native atomic segment. */
  const syncMutation = <R>(
    run: (state: INativeState) => R,
    keys: readonly ILockKey[] = [],
    guard?: IWriteGuard,
    orgId = runtime.orgId,
    context?: IConcurrencyAttemptContext
  ): R => {
    assertRoot()
    /** Synchronous entry cannot wait or invoke a user strategy while another logical holder exists. */
    const captured = context
      ? { keys: context.lock ?? [], identities: readConcurrencyLockIdentities(context) }
      : snapshotConcurrencyLockKeys(keys, SqliteNames.backend)
    const assertAvailable = (): void => {
      let conflict = guard ? rangeConflict(orgId, guard, context) : undefined
      if (!conflict && captured.keys.length) {
        if (wal) {
          for (const [index, id] of captured.identities.entries()) {
            const row = lockRow(orgId, id)
            if (
              row &&
              Number(row.expires_at) > Date.now() &&
              !(
                context !== undefined &&
                expectedToken?.context === context &&
                row.attempt_token === expectedToken.token &&
                row.owner === controller.origin
              )
            ) {
              conflict = { keys: [captured.keys[index]!], holder: holderOf(row) }
              break
            }
          }
        } else {
          const held = group!.locks.probe(captured.identities, undefined, context)
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
      changed: new Map(),
      mode: 'immediate',
      failure: undefined,
      context,
      expiresAt: expectedToken?.context === context ? expectedToken?.expiresAt : undefined
    } satisfies INativeState
    /** Native cancellation or lease loss before commit still rolls back this short atomic write. */
    const assertAttempt = (): void => {
      throwIfAborted(context?.signal)
      if (state.expiresAt !== undefined && Date.now() >= state.expiresAt)
        throw new StorageContractError(StorageContractErrorCode.lockLost)
    }
    try {
      statements.get(SqliteControl.begin).run()
      active = SQLITE_CONTROL_ACTIVE
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
        statements.get(SqliteControl.commit).run()
        active = undefined
        advanceRevisions(state)
      } catch (error) {
        throw normalizeSqliteFailure(error)
      }
      for (const channel of ['text', 'bytes', 'record'] as const) {
        const keys = state.changed.get(channel)
        if (!keys?.size) continue
        controller.publish({
          channel: channel === 'text' ? 'value' : channel,
          kind: 'batch',
          keys: [...keys.values()]
        })
      }
      return value
    } catch (error) {
      return rollback(
        error instanceof SqliteLogicalConflict && context === undefined
          ? new StorageContractError(StorageContractErrorCode.lockRejected, {
              backend: SqliteNames.backend,
              cause: error
            })
          : error
      )
    }
  }
  /** Root iterators own one detached native snapshot and no persistent cursor. */
  const iterator = (
    range?: IKeyRange,
    ctx?: IOperationContext
  ): IStorageIterator<[IStorageKey, TValue]> => {
    const captured = snapshotKeyRange(range, SqliteNames.backend)
    let rows: readonly ISqliteRow[] | undefined
    let position = 0
    let returned: Promise<IteratorResult<[IStorageKey, TValue]>> | undefined
    let disposed: Promise<void> | undefined
    const dispose = (): Promise<void> => {
      if (disposed) return disposed
      rows = []
      snapshots.delete(dispose)
      observe(operationStages, 'onStorageIterationClose', position)
      return (disposed = Promise.resolve())
    }
    return {
      next: () =>
        rootRead<IteratorResult<[IStorageKey, TValue]>>(
          SqliteOperation.next,
          { range: captured },
          ctx,
          (orgId) => {
            if (disposed) return { done: true, value: undefined }
            if (!rows) {
              rows = recordRows(orgId, captured)
              snapshots.add(dispose)
            }
            const row = rows[position++]
            if (!row) {
              void dispose()
              return { done: true, value: undefined }
            }
            return {
              done: false,
              value: [
                decodeKey(row.key as Uint8Array),
                convert('record', 'decode', row.value) as TValue
              ] as [IStorageKey, TValue]
            }
          }
        ).catch((error) => {
          void dispose()
          throw error
        }),
      return: () => (returned ??= dispose().then(() => ({ done: true, value: undefined }))),
      dispose,
      [asyncDisposeKey]: () => dispose(),
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }
  /** Exact root methods remain backend-owned when the provider installs the canonical KV token. */
  const base: ISqliteNativeStore<TValue> = {
    backend: SqliteNames.backend,
    capabilities: Object.freeze({
      syncRead: true,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    }),
    get: (key, ctx) => {
      textInput(key)
      return rootRead(
        SqliteOperation.get,
        { key },
        ctx,
        (orgId) => read('text', key, orgId) as string | null
      )
    },
    set: (key, value, ctx) => {
      textInput(key, value, true)
      return rootWrite(SqliteOperation.set, { key, value }, ctx, (captured) => {
        textInput(captured.key, captured.value, true)
        return prepareWrite('text', captured.key, captured.value)
      })
    },
    remove: (key, ctx) => {
      textInput(key)
      return rootWrite(SqliteOperation.remove, { key }, ctx, (captured) => {
        textInput(captured.key)
        return {
          keys: [lockKey.text(captured.key)],
          run: (state) => {
            remove('text', captured.key, state)
          }
        }
      })
    },
    has: (key, ctx) => {
      textInput(key)
      return rootRead(
        SqliteOperation.has,
        { key },
        ctx,
        (orgId) => read('text', key, orgId) !== null
      )
    },
    keys: (ctx) => rootRead(SqliteOperation.keys, {}, ctx, textKeys),
    clearValues: (ctx) =>
      rootWrite(SqliteOperation.clearValues, {}, ctx, () => ({
        keys: [],
        guard: { channels: ['text'] },
        run: (state) => clear(['text'], state)
      })),
    clearAll: (ctx) =>
      rootWrite(SqliteOperation.clearAll, {}, ctx, () => ({
        keys: [],
        guard: { channels: ['text', 'bytes', 'record'] },
        run: (state) => clear(['text', 'bytes', 'record'], state)
      })),
    getBytes: (key, ctx) => {
      textInput(key)
      return rootRead(
        SqliteOperation.getBytes,
        { key },
        ctx,
        (orgId) => read('bytes', key, orgId) as Uint8Array | null
      )
    },
    setBytes: (key, value, ctx) => {
      const bytes = bytesInput(key, value)
      return rootWrite(SqliteOperation.setBytes, { key, value: bytes }, ctx, (captured) =>
        prepareWrite('bytes', captured.key, bytesInput(captured.key, captured.value))
      )
    },
    removeBytes: (key, ctx) => {
      textInput(key)
      return rootWrite(SqliteOperation.removeBytes, { key }, ctx, (captured) => {
        textInput(captured.key)
        return {
          keys: [lockKey.bytes(captured.key)],
          run: (state) => {
            remove('bytes', captured.key, state)
          }
        }
      })
    },
    clearBytes: (ctx) =>
      rootWrite(SqliteOperation.clearBytes, {}, ctx, () => ({
        keys: [],
        guard: { channels: ['bytes'] },
        run: (state) => clear(['bytes'], state)
      })),
    getRecord: (key, ctx) => {
      const captured = snapshotStorageKey(key, SqliteNames.backend)
      return rootRead(
        SqliteOperation.getRecord,
        { key: captured },
        ctx,
        (orgId) => read('record', captured, orgId) as TValue | undefined
      )
    },
    putRecord: (value, key, ctx) => {
      const captured = key === undefined ? undefined : snapshotStorageKey(key, SqliteNames.backend)
      return rootWrite(SqliteOperation.putRecord, { value, key: captured }, ctx, (input) => {
        const key =
          input.key === undefined ? undefined : snapshotStorageKey(input.key, SqliteNames.backend)
        if (key !== undefined) {
          const mutation = prepareWrite('record', key, input.value)
          return {
            ...mutation,
            run: (state) => {
              mutation.run(state)
              return key
            }
          }
        }
        const raw = convert('record', 'encode', input.value) as string
        return {
          keys: [],
          run: (state) => {
            const actual = String(
              statement<ISqliteRow>(SqliteControl.generatedKey, [], 'get', state).key
            )
            writeRaw(
              'record',
              actual,
              raw,
              state,
              readTransactionConflictPolicy(state.context, SqliteNames.backend)
            )
            return actual
          }
        }
      })
    },
    deleteRecord: (key, ctx) => {
      const captured = snapshotStorageKey(key, SqliteNames.backend)
      return rootWrite(SqliteOperation.deleteRecord, { key: captured }, ctx, (input) => {
        const key = snapshotStorageKey(input.key, SqliteNames.backend)
        return {
          keys: [lockKey.record(key)],
          run: (state) => {
            remove('record', key, state)
          }
        }
      })
    },
    clearRecords: (ctx) =>
      rootWrite(SqliteOperation.clearRecords, {}, ctx, () => ({
        keys: [],
        guard: { channels: ['record'] },
        run: (state) => clear(['record'], state)
      })),
    iterateRecords: iterator,
    transaction: (run, options) => transact(run, options),
    tx: () => createTransactionBuilder(store),
    metadata: {
      get: (key, ctx) => {
        textInput(key)
        return rootRead(SqliteOperation.metadataGet, { key }, ctx, (orgId) =>
          read('metadata', key, orgId)
        )
      },
      set: (key, value, ctx) => {
        textInput(key)
        return rootRead(SqliteOperation.metadataSet, { key, value }, ctx, (orgId) =>
          syncMutation(
            (state) => write('metadata', key, value, state, 'replace'),
            [],
            undefined,
            orgId
          )
        )
      },
      delete: (key, ctx) => {
        textInput(key)
        return rootRead(SqliteOperation.metadataDelete, { key }, ctx, (orgId) =>
          syncMutation(
            (state) => {
              remove('metadata', key, state)
            },
            [],
            undefined,
            orgId
          )
        )
      }
    },
    sync: {
      get: (key) =>
        synchronous(SqliteOperation.get, { key }, () => {
          textInput(key)
          return read('text', key, runtime.orgId) as string | null
        }),
      set: (key, value, options) =>
        synchronous(SqliteOperation.set, { key, value, options }, () => {
          textInput(key, value, true)
          const policy = snapshotSyncWriteOptions(options).conflictPolicy ?? 'conflict'
          syncMutation(
            (state) => write('text', key, value, state, policy),
            [lockKey.text(key), lockKey.bytes(key), lockKey.record(key)]
          )
        }),
      remove: (key) =>
        synchronous(SqliteOperation.remove, { key }, () => {
          textInput(key)
          syncMutation((state) => remove('text', key, state), [lockKey.text(key)])
        }),
      has: (key) =>
        synchronous(SqliteOperation.has, { key }, () => {
          textInput(key)
          return read('text', key, runtime.orgId) !== null
        }),
      keys: () => synchronous(SqliteOperation.keys, {}, () => textKeys(runtime.orgId)),
      clearValues: () =>
        synchronous(SqliteOperation.clearValues, {}, () =>
          syncMutation((state) => clear(['text'], state), [], { channels: ['text'] })
        )
    },
    ...createSqliteExecutor(
      (prepare, ctx, run) =>
        rootRead(SqliteOperation.sql, {}, ctx, () => executeSql(prepare, undefined, run)),
      statements
    ),
    inspectLocks: (ctx) => {
      controller.assertLive()
      const finish = controller.beginMutation()
      return withAbort(ctx, async (signal, context) =>
        core.execution.run({ operation: 'inspectLocks', input: {}, ctx: context }, async () => {
          throwIfAborted(signal)
          const orgId = context?.orgId ?? runtime.orgId
          observe(concurrencyStages, 'beforeLockInspect')
          try {
            const inspect = () => {
              if (!wal) return group!.locks.inspectLocks()
              const rows = statement<readonly ISqliteRow[]>(
                `SELECT key,owner,label,pid,since,expires_at FROM ${tables.locks} WHERE org_id=?`,
                [orgId],
                'all'
              )
              return snapshotConcurrencyLockHoldings(
                rows.map((row) => {
                  const id = row.key as string
                  return {
                    key: decodeLockIdentity(id),
                    holder: holderOf(row),
                    expired: Number(row.expires_at) <= Date.now(),
                    expiresAt: Number(row.expires_at)
                  }
                })
              )
            }
            const rows = inspect()
            observe(concurrencyStages, 'afterLockInspect', rows.length)
            return rows
          } catch (error) {
            observe(concurrencyStages, 'onLockInspectError', (error as { code?: unknown })?.code)
            throw error
          }
        })
      ).finally(finish)
    },
    dispose: () => controller.dispose(),
    [asyncDisposeKey]: () =>
      (symbolic ??= controller.dispose().catch((error) => reportCleanupError(report, error)))
  }
  /** A borrowed KV capability exposes only original channel methods, never resource authority. */
  const keyValue = {
    get: base.get,
    set: base.set,
    remove: base.remove,
    has: base.has,
    keys: base.keys,
    clearValues: base.clearValues,
    clearAll: base.clearAll,
    sync: base.sync
  }
  /** Transaction binders retain the authentic complete scope admitted by the original owner. */
  const kvImplementation = implement(kv, keyValue, { forTransaction: (scope) => scope })
  /** Query source delegates iteration to the exact root or original transaction owner. */
  const recordApi: IRecordsApi<TValue> = {
    query: <R = TValue>() =>
      createRecordQuery<R>({
        pushdown: {
          operators: [],
          operations: [],
          source: SqliteNames.backend,
          index: `${table}_${SqliteNames.record}`
        },
        execute: ({ ctx }) => iterator(undefined, ctx)
      }),
    removeByPrefix: (prefix, ctx) => {
      const captured = snapshotStorageKey(prefix, SqliteNames.backend)
      return rootWrite(SqliteOperation.removeByPrefix, { prefix: captured }, ctx, (input) => {
        const prefix = snapshotStorageKey(input.prefix, SqliteNames.backend)
        return {
          keys: [],
          guard: { channels: ['record'], prefix },
          run: (state) => removePrefix('record', prefix, state)
        }
      })
    }
  }
  const recordImplementation = implement(records, recordApi, {
    forTransaction: (scope) =>
      ({
        query: <R = TValue>() =>
          createRecordQuery<R, undefined>({
            pushdown: {
              operators: [],
              operations: [],
              source: SqliteNames.backend,
              index: `${table}_${SqliteNames.record}`
            },
            execute: () => transactionIterator(scope as ISqliteTransactionScope<TValue>, undefined)
          }),
        removeByPrefix: (prefix) =>
          scoped(scope, SqliteOperation.removeByPrefix, { prefix }, (state) =>
            removePrefix('record', prefix, state)
          )
      }) satisfies ITransactionRecordsApi<TValue>
  })
  try {
    store = provideCapabilities(base, [kvImplementation, recordImplementation] as const, {
      onInstaller: (value) => {
        installer = value
      }
    })
    stages = core.stageBindings
    operationStages = stages.operationStages(store)
    sqlStages = stages.sqlStages(store)
    codecStages = stages.codecStages(store)
    concurrencyStages = stages.concurrencyStages(store)
    transactionStages = stages.transactionStages(store)
    transactionOwner = createTransactionOwner<TValue, ISqliteTransactionScope<TValue>>(
      store,
      normalizeTransactionFailure,
      { activityMode: 'managed', asyncDisposeKey, defaultPolicy: concurrency, concurrencyStages }
    )
    return {
      store,
      controller,
      installer,
      getTransactionClient: (scope) => {
        nativeFor(scope)
        return driver
      }
    }
  } catch (error) {
    void controller.dispose().catch((cleanup) => reportCleanupError(report, cleanup))
    throw normalizeSqliteFailure(error)
  }
}
