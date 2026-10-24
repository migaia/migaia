import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  snapshotStorageKey,
  snapshotStorageBatchKeys,
  createStorageBatchKeyCapture,
  assertStorageTtlDuration,
  snapshotStorageTtlTarget,
  snapshotStorageCounterIncrement,
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
  ConcurrencyPolicy,
  readConcurrencyLockIdentities,
  snapshotConcurrencyLockKeys,
  snapshotConcurrencyLockRange,
  snapshotConcurrencyLockHoldings,
  lockKey,
  provideCapabilities,
  implement,
  kv,
  records,
  sql,
  ttl,
  counter,
  createRecordQuery,
  type IStorageKey,
  type IStorageBase,
  type ITransactionScope,
  type IStorageBatchKey,
  type IKeyValueApi,
  type ITtlApi,
  type ITtlTarget,
  type ITransactionTtlApi,
  type ICounterApi,
  type ITransactionCounterApi,
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
import { bytesToBase64, base64ToBytes } from '@migaia/utils/bytes'
import type {
  IStoragePluginCore,
  IStorageJournalBackendBinding,
  IStorageJournalNamespaceView,
  IStorageJournalImage,
  IStorageJournalChange,
  IStorageJournalTarget,
  IStorageJournalExecutionPort
} from '@migaia/storage-host'
import {
  createBackendJournalNamespace,
  type IBackendJournalTransaction,
  encodeFlatStorageKey,
  decodeFlatStorageKey,
  createStorageOperationReporter,
  reportCleanupError,
  throwIfAborted,
  withAbort,
  subscribeToAbort,
  readAbortReason,
  snapshotKeyRange,
  observeStorageBatch,
  isStorageErrorFamily,
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
import type { ISqliteJournalTerminal } from './journal.js'
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
      /** One native-local group birth distinguishes a reopened owner from an old revision zero. */
      readonly birth: string
      references: number
    }
  >
>()
/** Public channels have distinct storage tables but share cross-channel string identity. */
type IChannel = 'text' | 'bytes' | 'record' | 'metadata'
/** Trusted short control segments use the same connection owner field without granting a scope. */
const SQLITE_CONTROL_ACTIVE = Symbol('sqlite-control-active')
/** A complete revision distinguishes ordinary updates from native row deletion and recreation. */
type ISqliteRevision = { readonly version: number; readonly birth: string | undefined }
/** A native callback and every short view refer to one actual active transaction. */
type INativeState = {
  readonly orgId: string
  readonly context: IConcurrencyAttemptContext | undefined
  readonly baseline: Map<string, ISqliteRevision>
  /** Canonical native observations exist only while original endpoint telemetry is enabled. */
  readonly observed?: Map<string, ILockKey>
  readonly changed: Map<IChannel, Map<string, IStorageKey>>
  readonly expirations: Map<
    string,
    { readonly target: ISqliteTtlTarget; readonly deadline: number }
  >
  readonly expiresAt: number | undefined
  mode: 'deferred' | 'immediate'
  failure: unknown
  /** Only routing metadata; authorization still comes from the original transaction owner. */
  scopeStore?: IStorageBase
  /** Allocated only when a private namespace joins this actual native attempt. */
  journalTerminal?: ISqliteJournalTerminal
  /** First raw images are allocated only for a selected original journal attempt. */
  journalBefore?: Map<
    string,
    {
      readonly target: IStorageJournalTarget
      readonly before: IStorageJournalImage
      current: IStorageJournalImage
    }
  >
  /** Actual native mutation order retains intermediate images only for the selected attempt. */
  journalSteps?: Array<Omit<IStorageJournalChange, 'afterRevision'>>
  /** Complete final facts are produced once immediately before the original journal append. */
  journalChanges?: readonly IStorageJournalChange[]
  /** Only actual COMMIT permits marker cleanup inside this original physical admission. */
  committedTxId?: string
}
/** All organization scopes retain the original connection admission and current native attempt. */
type ISqlitePhysicalState = {
  readonly admission: ReturnType<typeof createConcurrencyLimiter>
  readonly client: ISqliteDriver
  readonly physical: object | string
  readonly wal: boolean
  active: INativeState | typeof SQLITE_CONTROL_ACTIVE | undefined
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
  /** Publish owner facts only after this mutation's actual native COMMIT. */
  readonly committed?: () => void
  run(state: INativeState): R
}
/** Native batch rows retain the one canonical key capture and detached text payload. */
type ITextBatchEntry = IStorageBatchKey & {
  readonly value: string
  readonly ttlMs?: number
}
/** Presence distinguishes a native batch from the unchanged single-operation observation path. */
type IBatchObservation = { readonly count: number | undefined }
/** Scope-local native APIs are borrowed only through the original capability transaction binder. */
const ttlOperations = Symbol('sqlite-ttl-operations')
/** Counter access shares the same complete native scope without a separate owner registry. */
const counterOperations = Symbol('sqlite-counter-operations')
/** This backend owns only the three expiring native tables. */
type ISqliteTtlTarget = Extract<ITtlTarget, { readonly channel: 'text' | 'bytes' | 'record' }>
/** Private symbol methods are created by the same original complete scope factory. */
type ISqliteInternalScope<TValue> = ISqliteTransactionScope<TValue> & {
  readonly [ttlOperations]: ITransactionTtlApi
  readonly [counterOperations]: ITransactionCounterApi
}
/** Backend authoring state is supplied only by the original installation window. */
export type ISqliteRuntime = {
  readonly core: IStoragePluginCore
  readonly orgId: string
  /** The original installation ensures a requested root context uses its existing org group. */
  readonly ensureOrg?: (orgId: string) => void
  /** Root and its explicit default view share this existing organization's private log generation. */
  readonly journalGeneration?: { value: object }
}
/** Construction returns only exact provider/controller handles needed for original host admission. */
export type ISqliteConstruction<TValue> = {
  readonly store: ISqliteStore<TValue>
  readonly client: ISqliteDriver
  readonly controller: IBackendChangeController
  readonly installer: ICapabilityInstallPort
  readonly journal: Omit<IStorageJournalBackendBinding, 'forOrg'>
  getTransactionClient(scope: ISqliteTransactionScope): ISqliteDriver
  /** Private organization construction reuses this exact physical owner and captured layout. */
  createOrg(orgId: string, core: IStoragePluginCore): ISqliteConstruction<TValue>
  /** Delete only this immutable organization through the original guarded native mutation. */
  dropOrg(): Promise<void>
}

/** Create a synchronous native backend while borrowing the injected connection. */
export function createSqliteStore<TValue>(
  input: ISqliteOptions,
  runtime: ISqliteRuntime,
  shared?: ISqlitePhysicalState
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
  if (shared === undefined && claimedDrivers.has(driver))
    throw sqliteError(SqliteErrorCode.sqliteFailed, new Error(SqliteErrorText.connectionClaimed))
  if (shared === undefined) claimedDrivers.add(driver)
  /** Original host observation and execution ports carry no backend-owned subscriber registry. */
  const { core } = runtime
  /** A committed org drop invalidates only already-open private indexes for this fixed org. */
  const journalGeneration = runtime.journalGeneration ?? { value: {} }
  /** Batch durations use the existing host clock without introducing a backend timer. */
  const scheduler = core.featureExpose.getScheduler()
  /** One final reporting boundary observes cleanup and observer failures. */
  const report = createStorageOperationReporter()
  /** A single bounded statement Map belongs to this store and is cleared at release. */
  const statements = createSqliteStatements(driver)
  /** Feature authors borrow native operations without acquiring the creating caller's close handles. */
  const client: ISqliteDriver =
    shared?.client ??
    Object.freeze({
      exec: (text: string) => driver.exec(text),
      prepare: (text: string) => driver.prepare(text)
    })
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
  let physical: object | string = shared?.physical ?? driver
  /** Actual WAL result determines which approved concurrency primitive is selected. */
  let wal = shared?.wal ?? false
  /** Shared lock provider is created only within this installation window. */
  let group:
    | {
        readonly locks: IBackendKeyLockPort
        readonly revisions: IBackendRevisionPort
        readonly birth: string
        references: number
      }
    | undefined
  /** Group identity encodes only package-owned configuration, never business values. */
  const groupId = JSON.stringify([table, runtime.orgId])
  try {
    if (shared === undefined) {
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
          `CREATE TABLE IF NOT EXISTS ${tables.locks}(org_id TEXT NOT NULL,key TEXT NOT NULL,owner TEXT NOT NULL,attempt_token TEXT NOT NULL,label TEXT,pid INTEGER,since INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(org_id,key));CREATE TABLE IF NOT EXISTS ${tables.revisions}(org_id TEXT NOT NULL,key TEXT NOT NULL,revision INTEGER NOT NULL,birth TEXT NOT NULL DEFAULT(lower(hex(randomblob(16)))),PRIMARY KEY(org_id,key))`
        )
    }
    if (shared === undefined && wal) {
      /** The private row gains immutable native identity without changing prior user values. */
      const columns = driver.prepare('PRAGMA table_info(' + tables.revisions + ')').all()
      if (!columns.some((column) => column.name === 'birth')) {
        driver.exec(
          'ALTER TABLE ' + tables.revisions + " ADD COLUMN birth TEXT NOT NULL DEFAULT ''"
        )
        driver.exec(
          'UPDATE ' + tables.revisions + " SET birth=lower(hex(randomblob(16))) WHERE birth=''"
        )
      }
    }
    if (!wal) {
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
          birth: crypto.randomUUID(),
          references: 0
        }
        groups.set(groupId, group)
      }
      group.references++
    }
  } catch (cause) {
    statements.clear()
    if (shared === undefined) claimedDrivers.delete(driver)
    throw normalizeSqliteFailure(cause)
  }
  /** The utility limiter owns only this synchronous driver's physical transaction admission. */
  const physicalState: ISqlitePhysicalState = shared ?? {
    admission: createConcurrencyLimiter({ concurrency: 1 }),
    client,
    physical,
    wal,
    active: undefined
  }
  /** Every organization uses the original connection's one native admission limiter. */
  const physicalAdmission = physicalState.admission
  /** The original controller releases detached root snapshots when this store drains. */
  const snapshots = new Set<() => Promise<void>>()
  /** The host's original controller owns logical closure and draining accepted backend work. */
  const controller = core.createChangeController({
    backend: SqliteNames.backend,
    platform: driver,
    options: input,
    finalize: async () => {
      if (shared === undefined) await physicalAdmission.dispose()
      for (const dispose of snapshots) await dispose()
      statements.clear()
      if (shared === undefined) claimedDrivers.delete(driver)
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
  /** A scoped organization cannot redirect captured native operations to another organization. */
  const operationOrg = (context: IOperationContext | undefined): string => {
    const orgId = context?.orgId
    if (shared !== undefined && orgId !== undefined && orgId !== runtime.orgId)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: SqliteNames.backend
      })
    const selected = orgId ?? runtime.orgId
    if (shared === undefined && selected !== runtime.orgId) runtime.ensureOrg?.(selected)
    return selected
  }
  /** Every context uses the original physical file/table/org group, including root redirects. */
  const localGroup = (orgId: string) =>
    orgId === runtime.orgId
      ? group!
      : physicalGroups.get(physical)!.get(JSON.stringify([table, orgId]))!
  /** The existing org call context supplies the one configured journal port for its actual org. */
  const journalFor = (context?: IOperationContext): IStorageJournalExecutionPort | undefined => {
    if (core.journal === undefined) return undefined
    const orgId = operationOrg(context)
    return orgId === runtime.orgId ? core.journal : core.getOrgContext(orgId).journal
  }
  /** Root calls cannot borrow the connection while any actual native transaction owns it. */
  const assertRoot = (): void => {
    controller.assertLive()
    if (physicalState.active) throw sqliteError(SqliteErrorCode.transactionFailed)
  }
  /** Scope authorization returns the existing native attempt, never a copy or public marker. */
  const nativeFor = (scope: object, expectedStore: IStorageBase = store): INativeState => {
    assertTransactionOwner(expectedStore, scope)
    if (!physicalState.active || physicalState.active === SQLITE_CONTROL_ACTIVE)
      throw sqliteError(SqliteErrorCode.transactionFailed)
    throwIfAborted(physicalState.active.context?.signal)
    if (
      physicalState.active.expiresAt !== undefined &&
      Date.now() >= physicalState.active.expiresAt
    )
      throw new StorageContractError(StorageContractErrorCode.lockLost)
    return physicalState.active
  }
  /** Only the original active transaction owner authenticates a namespace's exact fixed org. */
  const journalScope = (scope: Omit<ITransactionScope, 'use'>) => {
    const state = physicalState.active
    if (!state || state === SQLITE_CONTROL_ACTIVE || !state.scopeStore)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    nativeFor(scope, state.scopeStore)
    const info = assertTransactionOwner(state.scopeStore, scope)
    if (state.orgId !== runtime.orgId)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    state.journalTerminal ??= { committed: new Set(), rolledBack: new Set(), ended: new Set() }
    return { state, info, terminal: state.journalTerminal }
  }
  /**
   * Actual data outcome and native resource completion are separate facts, including unknown
   * failures.
   */
  const finishJournal = (state: INativeState, success?: boolean): void => {
    const terminal = state.journalTerminal
    if (terminal === undefined) return
    if (success !== undefined)
      for (const effect of success ? terminal.committed : terminal.rolledBack) {
        try {
          const result = effect()
          observeThenableRejection(result, inspectThenable(result), report)
        } catch (error) {
          reportCleanupError(report, error)
        }
      }
    for (const effect of terminal.ended) {
      try {
        effect()
      } catch (error) {
        reportCleanupError(report, error)
      }
    }
    terminal.committed.clear()
    terminal.rolledBack.clear()
    terminal.ended.clear()
    state.journalTerminal = undefined
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
  /** Metadata borrows one original record guard; ordinary business keys keep their exact identity. */
  const revisionKey = (channel: IChannel, key: IStorageKey): ILockKey =>
    channel === 'metadata'
      ? lockKey.record([SqliteNames.metadata, key])
      : channel === 'text'
        ? lockKey.text(key)
        : channel === 'bytes'
          ? lockKey.bytes(key as string)
          : lockKey.record(key)
  /** The canonical lock owner supplies the single revision identity for every protected target. */
  const revisionIdentity = (channel: IChannel, key: IStorageKey): string =>
    snapshotConcurrencyLockKeys([revisionKey(channel, key)], SqliteNames.backend).identities[0]!
  /** Native row births and original local group births are the only revision owners. */
  const currentRevision = (state: INativeState, channel: IChannel, id: string): ISqliteRevision => {
    if (!wal) {
      const current = localGroup(state.orgId)
      return {
        version: current.revisions.read(channel === 'metadata' ? 'record' : channel, id),
        birth: current.birth
      }
    }
    const row = statement<ISqliteRow | undefined>(
      'SELECT revision,birth FROM ' + tables.revisions + ' WHERE org_id=? AND key=?',
      [state.orgId, id],
      'get',
      state
    )
    if (row !== undefined && typeof row.birth !== 'string')
      throw sqliteError(SqliteErrorCode.decodeFailed)
    return { version: Number(row?.revision ?? 0), birth: row?.birth as string | undefined }
  }
  /** The original native raw row and absolute deadline form one opaque canonical codec image. */
  const journalImage = (
    state: INativeState,
    channel: IChannel,
    key: IStorageKey
  ): IStorageJournalImage => {
    const row = statement<ISqliteRow | undefined>(
      'SELECT value' +
        (channel === 'metadata' ? '' : ',expires_at') +
        ' FROM ' +
        tables[channel] +
        ' WHERE org_id=? AND key=?',
      [state.orgId, encoded(channel, key)],
      'get',
      state
    )
    return row === undefined
      ? { present: false }
      : {
          present: true,
          value: recordCodec.encode({
            version: 1,
            channel,
            value: channel === 'bytes' ? bytesToBase64(row.value as Uint8Array) : row.value,
            deadline: channel === 'metadata' ? null : row.expires_at
          } as ICollectionsCodecValue)
        }
  }
  /** Only selected attempts retain first-before images, using the existing physical key codec. */
  const captureJournal = (state: INativeState, channel: IChannel, key: IStorageKey): void => {
    if (state.journalBefore === undefined) return
    const id = identity(channel, key)
    if (state.journalBefore.has(id)) return
    const target: IStorageJournalTarget =
      channel === 'metadata'
        ? { channel, key: encodeFlatStorageKey(key) }
        : revisionKey(channel, snapshotStorageKey(key, SqliteNames.backend))
    const before = journalImage(state, channel, key)
    state.journalBefore.set(id, { target, before, current: before })
  }
  /** First observations survive only original physical recovery, not a strategy retry. */
  const revision = (state: INativeState, channel: IChannel, key: IStorageKey): void => {
    captureJournal(state, channel, key)
    const id = revisionIdentity(channel, key)
    if (channel !== 'metadata') state.observed?.set(id, revisionKey(channel, key))
    if (!state.baseline.has(id)) state.baseline.set(id, currentRevision(state, channel, id))
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
    if (wal)
      statement(
        `INSERT INTO ${tables.revisions}(org_id,key,revision,birth) VALUES(?,?,1,lower(hex(randomblob(16)))) ON CONFLICT(org_id,key) DO UPDATE SET revision=revision+1`,
        [state.orgId, revisionIdentity(channel, key)],
        'run',
        state
      )
    const first = state.journalBefore?.get(id)
    if (first !== undefined) {
      const after = journalImage(state, channel, key)
      state.journalSteps!.push({ target: first.target, before: first.current, after })
      first.current = after
    }
  }
  /** The shared revision owner advances in the same synchronous turn as successful native COMMIT. */
  const advanceRevisions = (state: INativeState): void => {
    if (wal) return
    for (const [channel, keys] of state.changed)
      for (const key of keys.values())
        localGroup(state.orgId).revisions.write(
          channel === 'metadata' ? 'record' : channel,
          revisionIdentity(channel, key)
        )
  }
  /** One successful native COMMIT owns all ordinary and expiry change publication. */
  const publishChanges = (state: INativeState): void => {
    for (const channel of ['text', 'bytes', 'record'] as const) {
      const keys = state.changed.get(channel)
      if (!keys?.size) continue
      controller.publish({
        channel: channel === 'text' ? 'value' : channel,
        kind: 'batch',
        keys: [...keys.values()],
        orgId: state.orgId
      })
    }
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
    scope?: object,
    observeKey?: (key: ILockKey) => void
  ): unknown => {
    if (channel !== 'metadata') observeKey?.(revisionKey(channel, key))
    if (state) revision(state, channel, key)
    const row = statement<ISqliteRow | undefined>(
      `SELECT value${channel === 'metadata' ? '' : ',expires_at'} FROM ${tables[channel]} WHERE org_id=? AND key=?`,
      [orgId, encoded(channel, key)],
      'get',
      state
    )
    if (row && channel !== 'metadata' && !liveExpiration(channel, key, row.expires_at, state)) {
      if (state) prune(channel, key, state)
      else syncMutation((current) => prune(channel, key, current), [], undefined, orgId)
      return channel === 'text' || channel === 'bytes' ? null : undefined
    }
    if (!row) return channel === 'text' || channel === 'bytes' ? null : undefined
    return channel === 'bytes'
      ? (row.value as Uint8Array).slice()
      : convert(channel, 'decode', row.value, scope)
  }
  /** Expired cross-channel rows are reclaimed inside the same original native write transaction. */
  const prune = (channel: IChannel, key: IStorageKey, state: INativeState): void => {
    if (channel === 'metadata') return
    revision(state, channel, key)
    const result = statement<{ changes: number | bigint }>(
      `DELETE FROM ${tables[channel]} WHERE org_id=? AND key=? AND expires_at IS NOT NULL AND expires_at<=?`,
      [state.orgId, encoded(channel, key), Date.now()],
      'run',
      state
    )
    if (result.changes !== 0 && result.changes !== 0n) changed(state, channel, key)
  }
  /** First live reads retain the native snapshot's deadline until the original attempt commits. */
  const liveExpiration = (
    channel: Exclude<IChannel, 'metadata'>,
    key: IStorageKey,
    expiresAt: ISqliteValue | undefined,
    state?: INativeState,
    now = Date.now()
  ): boolean => {
    if (expiresAt == null) return true
    /** The existing revision identity owns this attempt-local observation as well. */
    const id = identity(channel, key)
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
  /** Enumeration uses the existing expiry index and reclaims only expired rows in its own range. */
  const cleanupExpiredRows = (
    channel: 'text' | 'record',
    orgId: string,
    range?: IKeyRange,
    state?: INativeState
  ): void => {
    /** One local wall-clock cutoff keeps every candidate in this cleanup operation consistent. */
    const clauses = ['org_id=?', 'expires_at IS NOT NULL', 'expires_at<=?']
    const values: ISqliteValue[] = [orgId, Date.now()]
    if (range?.lower !== undefined) {
      clauses.push(`key${range.lowerOpen ? '>' : '>='}?`)
      values.push(encoded(channel, range.lower))
    }
    if (range?.upper !== undefined) {
      clauses.push(`key${range.upperOpen ? '<' : '<='}?`)
      values.push(encoded(channel, range.upper))
    }
    /** The native index returns actual expiry candidates without scanning unrelated organizations. */
    const rows = statement<readonly ISqliteRow[]>(
      `SELECT key FROM ${tables[channel]} WHERE ${clauses.join(' AND ')}`,
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
        const id = identity(channel, key)
        if (state?.expirations.has(id) && !state.changed.get(channel)?.has(id)) continue
        prune(channel, key, current)
      }
    }
    if (state) reclaim(state)
    else syncMutation(reclaim, [], undefined, orgId)
  }
  /** Canonical target capture rejects unsupported vector storage before any native access. */
  const captureTtlTarget = (input: ITtlTarget): ISqliteTtlTarget => {
    const target = snapshotStorageTtlTarget(input, SqliteNames.backend)
    if (target.channel === 'text' || target.channel === 'bytes' || target.channel === 'record')
      return target
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: SqliteNames.backend
    })
  }
  /** Deadline reads and writes share the original attempt's first live native observation. */
  const expiration = (
    target: ISqliteTtlTarget,
    orgId: string,
    state?: INativeState
  ): ISqliteRow | undefined => {
    if (state) revision(state, target.channel, target.key)
    const row = statement<ISqliteRow | undefined>(
      `SELECT expires_at FROM ${tables[target.channel]} WHERE org_id=? AND key=?`,
      [orgId, encoded(target.channel, target.key)],
      'get',
      state
    )
    if (row && !liveExpiration(target.channel, target.key, row.expires_at, state)) {
      if (state) prune(target.channel, target.key, state)
      else
        syncMutation((current) => prune(target.channel, target.key, current), [], undefined, orgId)
      return undefined
    }
    return row
  }
  /** TTL updates share the original native mutation, revision and commit notification owners. */
  const changeDeadline = (target: ISqliteTtlTarget, state: INativeState, ms?: number): boolean => {
    const row = expiration(target, state.orgId, state)
    if (!row || (ms === undefined && row.expires_at === null)) return false
    if (ms === 0) return remove(target.channel, target.key, state)
    statement(
      `UPDATE ${tables[target.channel]} SET expires_at=? WHERE org_id=? AND key=?`,
      [ms === undefined ? null : Date.now() + ms, state.orgId, encoded(target.channel, target.key)],
      'run',
      state
    )
    changed(state, target.channel, target.key)
    return true
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
    revision(state, channel, key)
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
          revision(state, other, key)
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
      `INSERT INTO ${tables[channel]}(org_id,key,value${channel === 'metadata' ? '' : ',expires_at'}) VALUES(?,?,?${channel === 'metadata' ? '' : ',?'}) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value${channel === 'metadata' ? '' : `,expires_at=${ttlMs === undefined ? `${tables[channel]}.expires_at` : 'excluded.expires_at'}`}`,
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
    cleanupExpiredRows('record', orgId, captured, state)
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
    return statement(
      `SELECT key,value,expires_at FROM ${tables.record} WHERE ${clauses.join(' AND ')} ORDER BY key`,
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
    run: (captured: I) => R,
    batch?: IBatchObservation
  ): Promise<Awaited<R>> => {
    /** The original owner admits scope work synchronously before pipeline or codec work. */
    const execute = (currentScope?: object): Promise<Awaited<R>> => {
      /** The existing executor remains the sole pipeline owner for either observation form. */
      const invoke = (): Promise<Awaited<R>> =>
        core.execution.run<I, Awaited<R>>(
          { operation: name, input, ctx: context, scope: currentScope, internal: true },
          async (captured): Promise<Awaited<R>> => {
            if (batch) return (await run(captured)) as Awaited<R>
            /** Existing single calls retain their original observer binding point after the stage. */
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
              observe(
                observer,
                'onStorageOperationError',
                name,
                (error as { code?: unknown })?.code
              )
              throw error
            }
          }
        )
      return batch
        ? observeStorageBatch(
            currentScope ? operationStages.forTransaction(currentScope) : operationStages,
            scheduler,
            name,
            batch.count,
            invoke
          )
        : invoke()
    }
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
    run: (state: INativeState, current: ISqliteTransactionScope<TValue>, input: unknown) => R,
    batch?: IBatchObservation
  ): Promise<Awaited<R>> =>
    runTransactionOperation(scope, (current) => {
      const state = nativeFor(current)
      /** Capture inside original admission, before an asynchronous pipeline can wait. */
      const capturedInput = typeof input === 'function' ? input() : input
      /** An empty native batch remains admitted but opens no pipeline, hook, or native request. */
      if (batch?.count === 0)
        return run(state, current as ISqliteTransactionScope<TValue>, capturedInput)
      /** Existing scope admission owns one execution; batches only share its observation wrapper. */
      const execute = () =>
        core.execution.run(
          { operation: name, input: capturedInput, scope: current },
          async (preparedInput) => {
            const observer = operationStages.forTransaction(current)
            const transactionObserver = transactionStages.forTransaction(current)
            observe(transactionObserver, 'beforeTxOperation', name)
            if (batch)
              return observeStorageBatch(observer, scheduler, name, batch.count, async () => {
                const result = await run(
                  state,
                  current as ISqliteTransactionScope<TValue>,
                  preparedInput
                )
                observe(transactionObserver, 'afterTxOperation', name)
                return result as Awaited<R>
              })
            observe(observer, 'beforeStorageOperation', name)
            const started = Date.now()
            try {
              const result = await run(
                state,
                current as ISqliteTransactionScope<TValue>,
                preparedInput
              )
              observe(transactionObserver, 'afterTxOperation', name)
              observe(observer, 'afterStorageOperation', name, Date.now() - started, 1)
              return result as Awaited<R>
            } catch (error) {
              observe(
                observer,
                'onStorageOperationError',
                name,
                (error as { code?: unknown })?.code
              )
              throw error
            }
          }
        )
      return execute()
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
    run: (orgId: string, input: unknown, observeKey?: (key: ILockKey) => void) => R,
    batch?: IBatchObservation
  ): Promise<Awaited<R>> => {
    controller.assertLive()
    const finish = controller.beginMutation()
    /** Only the enabled observer retains actual synchronous read facts. */
    let keys: ILockKey[] | undefined
    let capturedInput = input
    const execute = () =>
      withAbort<Awaited<R>>(ctx, async (signal, context): Promise<Awaited<R>> => {
        assertRoot()
        throwIfAborted(signal)
        const selectedJournal = journalFor(context)
        if (selectedJournal !== undefined) await selectedJournal.prepare()
        return operation(
          name,
          input,
          context,
          undefined,
          (captured) => {
            assertRoot()
            throwIfAborted(signal)
            capturedInput = captured
            return run(
              operationOrg(context),
              captured,
              keys === undefined ? undefined : (key) => keys!.push(key)
            )
          },
          batch
        )
      })
    const result =
      core.execution.observe === undefined
        ? execute()
        : core.execution.observe(
            () => ({
              operation: name,
              input: capturedInput,
              keys: () => keys ?? [],
              internal:
                name === SqliteOperation.metadataGet ||
                name === SqliteOperation.metadataSet ||
                name === SqliteOperation.metadataDelete
                  ? true
                  : undefined
            }),
            (enabled) => {
              if (enabled) keys = []
              return execute()
            }
          )
    return result.finally(finish)
  }
  /** Root mutations declare affected original channel keys before logical lock acquisition. */
  const rootWrite = <I, R>(
    name: string,
    input: I,
    ctx: IOperationContext | undefined,
    prepare: (captured: I) => IRootMutation<R>,
    batch?: IBatchObservation
  ): Promise<Awaited<R>> => {
    controller.assertLive()
    const finish = controller.beginMutation()
    /** The original loop owns the deadline before the one asynchronous pipeline can begin. */
    let capturedInput!: I
    /** Fixed preparation retains only this operation's payload and exact affected keys. */
    let mutation!: IRootMutation<R>
    let selectedJournal: IStorageJournalExecutionPort | undefined
    /** Final-attempt facts remain owned by the original native state. */
    let observing = false
    let observedKeys: readonly ILockKey[] | undefined
    const recordKeys = (state: INativeState): void => {
      observedKeys = [...state.observed!.values()]
    }
    const execute = () =>
      runWithConcurrency<Awaited<R>>(
        {
          store,
          options: ctx === undefined ? {} : ctx,
          prepare:
            core.journal === undefined || name === SqliteOperation.dropOrg
              ? undefined
              : (context) => {
                  selectedJournal = journalFor(context)
                  return selectedJournal?.prepare()
                },
          execute: (context, proceed) =>
            operation(
              name,
              input,
              context,
              undefined,
              (captured) => {
                capturedInput = captured
                return proceed()
              },
              batch
            ),
          lock: () => {
            mutation = prepare(capturedInput)
            return [...mutation.keys, ...(selectedJournal?.headLocks() ?? [])]
          }
        },
        {
          attempt: async (context) => {
            const guard = mutation.guard
            const ranges = guard ? lockRanges(guard) : []
            const ids = readConcurrencyLockIdentities(context)
            /** Logical fail decisions remain observable before entering the physical queue. */
            const conflict = wal ? conflictingLock(context, ids, '') : undefined
            const range = wal && guard ? rangeConflict(operationOrg(context), guard) : undefined
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
                    operationOrg(context),
                    context,
                    mutation.committed,
                    observing ? recordKeys : undefined
                  ) as Awaited<R>
                if (selectedJournal?.active()) {
                  const native = () =>
                    nativeAttempt(
                      context,
                      (scope) => mutation.run(journalScope(scope).state),
                      true,
                      mutation.committed,
                      observing ? recordKeys : undefined
                    )
                  const run = () =>
                    physicalRun(context, () => (wal ? walAttempt(context, native) : native()))
                  return wal
                    ? await run()
                    : await localGroup(operationOrg(context)).locks.attempt(
                        context,
                        {
                          owner: controller.origin,
                          since: Date.now(),
                          status: 'held',
                          scope: 'local'
                        },
                        { attempt: run },
                        concurrencyStages,
                        controller.closingSignal,
                        ranges
                      )
                }
                return wal
                  ? await physicalRun(context, () =>
                      walAttempt(context, async () => ({
                        status: 'committed' as const,
                        value: write() as Awaited<R>
                      }))
                    )
                  : await localGroup(operationOrg(context)).locks.attemptWrite(
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
    const result =
      core.execution.observe === undefined
        ? execute()
        : core.execution.observe(
            () => ({
              operation: name,
              input: capturedInput ?? input,
              keys: () => observedKeys ?? []
            }),
            (enabled) => {
              observing = enabled
              return execute()
            }
          )
    return result.finally(finish)
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
  /** Borrowed array and entry access failures leave this new API through the original error owner. */
  const captureBatch = <R>(capture: () => R): R => {
    try {
      return capture()
    } catch (cause) {
      if (isStorageErrorFamily(cause)) throw cause
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend: SqliteNames.backend,
        cause
      })
    }
  }
  /** Empty root calls still validate their live resource and supplied context without doing I/O. */
  const batchSize = (input: readonly unknown[]): number =>
    captureBatch(() => {
      controller.assertLive()
      if (!Array.isArray(input))
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
          backend: SqliteNames.backend
        })
      return input.length
    })
  /** Ordered entry capture reuses canonical equality while preserving the original getter order. */
  const captureTextEntries = (
    entries: Parameters<IKeyValueApi['setMany']>[0]
  ): readonly ITextBatchEntry[] =>
    captureBatch(() => {
      if (!Array.isArray(entries))
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
          backend: SqliteNames.backend
        })
      /** Only this call owns the original key owner's transient first-position facts. */
      const capture = createStorageBatchKeyCapture(SqliteNames.backend)
      /** Length is fixed before any caller entry getter can extend the array. */
      const length = entries.length
      /** Native work consumes only these detached fields after asynchronous stages. */
      const result: ITextBatchEntry[] = []
      for (let index = 0; index < length; index++) {
        /** Keep key, value, TTL reads in the old scope batch order. */
        const entry = entries[index]!
        const fact = capture(entry.key)
        const value = entry.value
        const ttlMs = entry.ttlMs
        if (fact.firstIndex !== index || typeof value !== 'string')
          throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
            backend: SqliteNames.backend,
            cause: new TypeError(SqliteErrorText.batch)
          })
        if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, SqliteNames.backend)
        result.push({ ...fact, value, ttlMs })
      }
      return result
    })
  /** A root read's synchronous native segment holds one real read snapshot across every IN chunk. */
  const readSnapshot = <R>(orgId: string, run: (state: INativeState) => R): R => {
    assertRoot()
    /** Expiry cleanup, when needed, belongs to this same original native snapshot and commit. */
    const state: INativeState = {
      orgId,
      context: undefined,
      baseline: new Map(),
      changed: new Map(),
      expirations: new Map(),
      mode: 'deferred',
      failure: undefined,
      expiresAt: undefined
    }
    statement(SqliteControl.deferred, [], 'run')
    physicalState.active = SQLITE_CONTROL_ACTIVE
    try {
      const result = run(state)
      statement(SqliteControl.commit, [], 'run')
      physicalState.active = undefined
      advanceRevisions(state)
      publishChanges(state)
      return result
    } catch (error) {
      return rollback(
        error instanceof SqlitePhysicalBusy ? normalizeSqliteFailure(error.cause) : error
      )
    }
  }
  /** Batch get uses bounded IN lists inside one real native transaction snapshot. */
  const getMany = (
    keys: readonly IStorageBatchKey[],
    state: INativeState,
    scope?: object
  ): readonly (string | undefined)[] => {
    const result = new Map<string, string>()
    const captured = keys.filter(({ firstIndex }, index) => firstIndex === index)
    /** Native expired rows map back to original snapshots in linear total work. */
    const keysByIdentity = new Map(captured.map(({ identity, key }) => [identity, key]))
    /** Every chunk uses the same operation-local expiry cutoff inside the same native snapshot. */
    const now = Date.now()
    for (let index = 0; index < captured.length; index += SqliteLimits.batch) {
      const part = captured.slice(index, index + SqliteLimits.batch).map(({ identity }) => identity)
      const rows = statement<readonly ISqliteRow[]>(
        `SELECT key,value,expires_at FROM ${tables.text} WHERE org_id=? AND key IN (${part.map(() => '?').join(',')})`,
        [state.orgId, ...part],
        'all',
        state
      )
      for (const row of rows) {
        if (
          !liveExpiration(
            'text',
            keysByIdentity.get(row.key as string)!,
            row.expires_at,
            state,
            now
          )
        )
          prune('text', keysByIdentity.get(row.key as string)!, state)
        else result.set(row.key as string, convert('text', 'decode', row.value, scope) as string)
      }
    }
    for (const { key } of captured) revision(state, 'text', key)
    return keys.map(({ identity }) => result.get(identity))
  }
  /** Distinct physical deletions use bounded IN lists and one existing native transaction. */
  const removeTextBatch = (keys: readonly IStorageBatchKey[], state: INativeState): number => {
    /** Canonical first positions own equality; no backend-specific duplicate-key representation. */
    const captured = keys.filter(({ firstIndex }, index) => firstIndex === index)
    /** Native row counts describe successful physical deletions, including existing expired rows. */
    let removed = 0
    for (let index = 0; index < captured.length; index += SqliteLimits.batch) {
      /** All placeholders stay within the same conservative builtin parameter budget as reads. */
      const part = captured.slice(index, index + SqliteLimits.batch)
      /** Only this bounded chunk maps native row identities back to original detached keys. */
      const keysByIdentity = new Map(part.map((fact) => [fact.identity, fact.key]))
      for (const { key } of part) revision(state, 'text', key)
      /** Native presence fixes the exact changed rows before the atomic DELETE. */
      const rows = statement<readonly ISqliteRow[]>(
        `SELECT key FROM ${tables.text} WHERE org_id=? AND key IN (${part.map(() => '?').join(',')})`,
        [state.orgId, ...part.map(({ identity }) => identity)],
        'all',
        state
      )
      /** Matching rows cannot change between statements owned by this native writer. */
      const result = statement<{ changes: number | bigint }>(
        `DELETE FROM ${tables.text} WHERE org_id=? AND key IN (${part.map(() => '?').join(',')})`,
        [state.orgId, ...part.map(({ identity }) => identity)],
        'run',
        state
      )
      removed += Number(result.changes)
      for (const row of rows) changed(state, 'text', keysByIdentity.get(row.key as string)!)
    }
    return removed
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
    const scope: ISqliteInternalScope<TValue> = {
      [ttlOperations]: {
        expire: (target, ms) =>
          scoped(
            scope,
            SqliteOperation.ttlExpire,
            () => {
              const captured = captureTtlTarget(target)
              assertStorageTtlDuration(ms, SqliteNames.backend)
              return { target: captured, ms }
            },
            (state, _current, input) => {
              const current = input as { target: ITtlTarget; ms: number }
              const target = captureTtlTarget(current.target)
              assertStorageTtlDuration(current.ms, SqliteNames.backend)
              return changeDeadline(target, state, current.ms)
            }
          ),
        remaining: (target) =>
          scoped(
            scope,
            SqliteOperation.ttlRemaining,
            () => captureTtlTarget(target),
            (state, _current, input) => {
              const row = expiration(captureTtlTarget(input as ITtlTarget), state.orgId, state)
              return row?.expires_at == null
                ? undefined
                : Math.max(0, Number(row.expires_at) - Date.now())
            }
          ),
        persist: (target) =>
          scoped(
            scope,
            SqliteOperation.ttlPersist,
            () => captureTtlTarget(target),
            (state, _current, input) => changeDeadline(captureTtlTarget(input as ITtlTarget), state)
          )
      },
      [counterOperations]: {
        increment: (key, by) =>
          scoped(
            scope,
            SqliteOperation.counterIncrement,
            () => {
              textInput(key)
              snapshotStorageCounterIncrement(by, SqliteNames.backend)
              return { key, by }
            },
            (state, current, input) => {
              const captured = input as { key: string; by?: number }
              textInput(captured.key)
              const increment = snapshotStorageCounterIncrement(captured.by, SqliteNames.backend)
              const result = increment(
                read('text', captured.key, state.orgId, state, current) as string | null
              )
              write('text', captured.key, String(result), state, 'conflict', current)
              return result
            }
          )
      },
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
        let captured: readonly IStorageBatchKey[]
        let input: { keys: readonly IStorageKey[] }
        return scoped(
          scope,
          SqliteOperation.getMany,
          () => {
            captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
            return (input = { keys: captured.map(({ key }) => key) })
          },
          (state, current, prepared) => {
            const actual = snapshotStorageBatchKeys(
              (prepared as typeof input).keys,
              SqliteNames.backend
            )
            return getMany(actual, state, current)
          },
          {
            get count() {
              return captured.length
            }
          }
        )
      },
      setMany: (entries) => {
        let captured: readonly ITextBatchEntry[]
        let input: { entries: Parameters<IKeyValueApi['setMany']>[0] }
        return scoped(
          scope,
          SqliteOperation.setMany,
          () => {
            captured = captureTextEntries(entries)
            return (input = {
              entries: captured.map(({ key, value, ttlMs }) => ({ key, value, ttlMs }))
            })
          },
          (state, current, prepared) => {
            const actual = captureTextEntries((prepared as typeof input).entries)
            for (const entry of actual)
              write('text', entry.key, entry.value, state, 'conflict', current, entry.ttlMs)
          },
          {
            get count() {
              return captured.length
            }
          }
        )
      },
      removeMany: (keys) => {
        let captured: readonly IStorageBatchKey[]
        let input: { keys: readonly IStorageKey[] }
        return scoped(
          scope,
          SqliteOperation.removeMany,
          () => {
            captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
            return (input = { keys: captured.map(({ key }) => key) })
          },
          (state, _current, prepared) => {
            const actual = snapshotStorageBatchKeys(
              (prepared as typeof input).keys,
              SqliteNames.backend
            )
            return removeTextBatch(actual, state)
          },
          {
            get count() {
              return captured.length
            }
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
          (state, _current, input) =>
            removePrefix(
              'text',
              snapshotStorageKey((input as { prefix: IStorageKey }).prefix, SqliteNames.backend),
              state
            ),
          { count: undefined }
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
    /** Bind selected methods to this exact native view before the original owner admits it. */
    const api = core.createTransactionApi(scope)
    if (api !== undefined) Object.defineProperty(scope, 'api', { value: api, enumerable: true })
    return Object.freeze(scope)
  }
  /** SQL statistics use the shared compile output and retain native result shape and error cause. */
  const executeSql = <R>(
    prepare: () => ICompiledStorageSql,
    ctx: IOperationContext | undefined,
    run: (compiled: ICompiledStorageSql) => R,
    state?: INativeState,
    scope?: ISqliteTransactionScope<TValue>
  ): R => {
    if (
      shared !== undefined ||
      state?.journalBefore !== undefined ||
      (state === undefined && core.journal?.active())
    )
      throw new StorageContractError(StorageContractErrorCode.unsupported, {
        backend: SqliteNames.backend
      })
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
    /** Cursor position can skip expired physical rows; observation counts only actual values. */
    let returnedCount = 0
    return transactionOwner.registerIterator<
      ISqliteTransactionScope<TValue>,
      [IStorageKey, TValue]
    >(scope, {
      next: (current) =>
        scoped(current, SqliteOperation.next, { range }, (actual, currentScope) => {
          if (rows === undefined) rows = recordRows(actual.orgId, range, actual)
          while (position < rows.length) {
            const row = rows[position++]!
            const key = decodeKey(row.key as Uint8Array)
            if (!liveExpiration('record', key, row.expires_at, actual)) {
              prune('record', key, actual)
              continue
            }
            revision(state, 'record', key)
            returnedCount++
            return {
              done: false,
              value: [key, convert('record', 'decode', row.value, currentScope) as TValue] as [
                IStorageKey,
                TValue
              ]
            }
          }
          return { done: true, value: undefined }
        }),
      close: () => {
        rows = []
        observe(operationStages, 'onStorageIterationClose', returnedCount)
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
          physicalState.active === undefined
        )
          physicalState.active = SQLITE_CONTROL_ACTIVE
        else if (
          (text === SqliteControl.commit || text === SqliteControl.rollback) &&
          physicalState.active === SQLITE_CONTROL_ACTIVE
        )
          physicalState.active = undefined
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
    if (physicalState.active === SQLITE_CONTROL_ACTIVE) physicalState.active = undefined
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
      const holding = localGroup(orgId).locks.probe([], lockRanges(guard), current)
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
      const row = lockRow(operationOrg(context), id)
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
    const orgId = operationOrg(context)
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
    callback: (scope: ISqliteTransactionScope<TValue>) => R,
    journaled = true,
    committed?: () => void,
    observeKeys?: (state: INativeState) => void
  ): Promise<IConcurrencyAttempt<Awaited<R>>> => {
    /** Original baseline survives only internal physical recovery, never a strategy retry. */
    const baseline = new Map<string, ISqliteRevision>()
    /** First-read deadlines survive only this original attempt and its physical recovery. */
    const expirations: INativeState['expirations'] = new Map()
    /** A physical upgrade recovery changes only the native BEGIN, not the strategy attempt number. */
    let recover = false
    while (true) {
      const state: INativeState = {
        orgId: operationOrg(context),
        context,
        baseline,
        observed: observeKeys === undefined ? undefined : new Map(),
        changed: new Map(),
        expirations,
        expiresAt: expectedToken?.expiresAt,
        mode: recover || context.locking === 'pessimistic' ? 'immediate' : 'deferred',
        failure: undefined
      }
      physicalState.active = state
      /** Native BEGIN failures do not create a false transaction or emit a rollback. */
      let begun = false
      /** Scope registration owns all short views and deferred work in this physical attempt. */
      let registration: ReturnType<typeof transactionOwner.register> | undefined
      /** A single callback result survives await and return identity unchanged. */
      let value: Awaited<R> | undefined
      /** Terminal events retain immutable transaction facts after data views expire. */
      let terminal: ReturnType<IBackendStageBindings['transactionStages']> | undefined
      let journalAttempt: ReturnType<IStorageJournalExecutionPort['begin']>
      let transactionId: string | undefined
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
            const actual = currentRevision(state, channel, id)
            if (actual.version !== expected.version || actual.birth !== expected.birth) {
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
        state.scopeStore = store
        const scope = createScope()
        registration = transactionOwner.register(scope, {
          createScope,
          context,
          onFailure: (failure) => {
            state.failure ??= failure
          },
          beforeCommit: (checkScope) => {
            observe(transactionStages.forTransaction(checkScope), 'beforeCommit')
            return journalAttempt?.record(checkScope)
          }
        })
        terminal = transactionStages.forTransaction(scope)
        transactionId = assertTransactionOwner(store, scope).id
        if (journaled && journalFor(context)?.active()) {
          state.journalBefore = new Map()
          state.journalSteps = []
          journalAttempt = journalFor(context)!.begin(scope)
        }
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
        /** The original commit check uses one local clock sample for all observed native rows. */
        const commitNow = Date.now()
        const expired = [...state.expirations.values()]
          .filter(({ deadline }) => deadline <= commitNow)
          .map(({ target }) => target)
        if (expired.length !== 0) {
          rollbackNative()
          begun = false
          observe(terminal, 'afterRollback', StorageContractErrorCode.writeConflict)
          return { status: 'conflict', phase: 'commit', keys: expired, holder: undefined }
        }
        await control(SqliteControl.commit, context, false, () => {
          begun = false
          advanceRevisions(state)
          committed?.()
          state.committedTxId = transactionId
          finishJournal(state, true)
        })
        let changedKeys = 0
        for (const keys of state.changed.values()) changedKeys += keys.size
        observe(terminal, 'afterCommit', changedKeys)
        /** Publication occurs only after actual native COMMIT; rollback publishes nothing. */
        publishChanges(state)
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
        observeKeys?.(state)
        finishJournal(state, begun ? undefined : false)
        if (journalAttempt?.settle !== undefined) await journalAttempt.settle()
        registration?.close()
        if (registration) observe(terminal, 'onTransactionClose')
        /** Failed rollback keeps actual unknown native ownership sealed against root access. */
        physicalState.active = begun ? SQLITE_CONTROL_ACTIVE : undefined
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
        if (physicalState.active !== undefined) throw sqliteError(SqliteErrorCode.transactionFailed)
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
    options: ITransactionOptions = {},
    journaled = true
  ): Promise<Awaited<R>> => {
    assertTransactionCallback(callback, SqliteNames.backend)
    controller.assertLive()
    const finish = controller.beginMutation()
    let observing = false
    let observedKeys: readonly ILockKey[] | undefined
    const execute = () =>
      runWithConcurrency<Awaited<R>>(
        {
          store,
          options,
          prepare:
            !journaled || core.journal === undefined
              ? undefined
              : (context) => journalFor(context)?.prepare(),
          lock: (context) => (journaled ? (journalFor(context)?.headLocks() ?? []) : [])
        },
        {
          attempt: async (context) => {
            /**
             * This native backend owns no vector collection or RDF graph and never falls back to
             * key.
             */
            if (context.lock?.some(({ channel }) => channel === 'vector' || channel === 'rdf'))
              throw new StorageContractError(StorageContractErrorCode.unsupported, {
                backend: SqliteNames.backend
              })
            const run = () =>
              physicalRun(context, () => {
                const invoke = () =>
                  nativeAttempt(
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
                const execute = () => (wal ? walAttempt(context, invoke) : invoke())
                return core.execution.run(
                  {
                    operation: SqliteOperation.transaction,
                    input: {},
                    ctx: context,
                    internal: true
                  },
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
              : localGroup(operationOrg(context)).locks.attempt(
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
    const result =
      core.execution.observe === undefined
        ? execute()
        : core.execution.observe(
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
      }
      statement(`DELETE FROM ${tables[channel]} WHERE org_id=?`, [state.orgId], 'run', state)
      for (const row of rows)
        changed(
          state,
          channel,
          channel === 'record' ? decodeKey(row.key as Uint8Array) : decodeHexKey(row.key as string)
        )
    }
  }
  /** String-only legacy keys omit typed batch keys while retaining canonical identity. */
  const textKeys = (orgId: string, observeKey?: (key: ILockKey) => void): string[] => {
    cleanupExpiredRows('text', orgId)
    const rows = statement<readonly ISqliteRow[]>(
      `SELECT key FROM ${tables.text} WHERE org_id=? AND (expires_at IS NULL OR expires_at>?) ORDER BY key`,
      [orgId, Date.now()],
      'all'
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
  const syncMutation = <R>(
    run: (state: INativeState) => R,
    keys: readonly ILockKey[] = [],
    guard?: IWriteGuard,
    orgId = runtime.orgId,
    context?: IConcurrencyAttemptContext,
    committed?: () => void,
    observeKeys?: (state: INativeState) => void
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
          const held = localGroup(orgId).locks.probe(captured.identities, undefined, context)
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
      physicalState.active = SQLITE_CONTROL_ACTIVE
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
        physicalState.active = undefined
        advanceRevisions(state)
        committed?.()
      } catch (error) {
        throw normalizeSqliteFailure(error)
      }
      publishChanges(state)
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
    } finally {
      observeKeys?.(state)
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
    /** Expired snapshot positions do not count as returned iteration values. */
    let returnedCount = 0
    let returned: Promise<IteratorResult<[IStorageKey, TValue]>> | undefined
    let disposed: Promise<void> | undefined
    const dispose = (): Promise<void> => {
      if (disposed) return disposed
      rows = []
      snapshots.delete(dispose)
      observe(operationStages, 'onStorageIterationClose', returnedCount)
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
            while (position < rows.length) {
              const row = rows[position++]!
              const key = decodeKey(row.key as Uint8Array)
              if (!liveExpiration('record', key, row.expires_at)) {
                syncMutation((state) => prune('record', key, state), [], undefined, orgId)
                continue
              }
              returnedCount++
              return {
                done: false,
                value: [key, convert('record', 'decode', row.value) as TValue] as [
                  IStorageKey,
                  TValue
                ]
              }
            }
            void dispose()
            return { done: true, value: undefined }
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
        (orgId, _input, observeKey) =>
          read('text', key, orgId, undefined, undefined, observeKey) as string | null
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
        (orgId, _input, observeKey) =>
          read('text', key, orgId, undefined, undefined, observeKey) !== null
      )
    },
    keys: (ctx) =>
      rootRead(SqliteOperation.keys, {}, ctx, (orgId, _input, observeKey) =>
        textKeys(orgId, observeKey)
      ),
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
        (orgId, _input, observeKey) =>
          read('bytes', key, orgId, undefined, undefined, observeKey) as Uint8Array | null
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
        (orgId, _input, observeKey) =>
          read('record', captured, orgId, undefined, undefined, observeKey) as TValue | undefined
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
    tx: () => createTransactionBuilder(store, undefined, core.getChainMethods('tx')),
    ...(core.journal === undefined
      ? {}
      : {
          undo: async (txId: string, ctx?: IOperationContext) => {
            controller.assertLive()
            const release = controller.beginMutation()
            let selected: IStorageJournalExecutionPort | undefined
            return runWithConcurrency<{ readonly txId: string }>(
              {
                store,
                options: ctx === undefined ? {} : ctx,
                prepare: (context) => {
                  selected = journalFor(context)
                  return selected!.prepare()
                }
              },
              {
                attempt: async (context) => ({
                  status: 'committed',
                  value: await selected!.undo(txId, (keys, work) =>
                    createTransactionBuilder(store, context, core.getChainMethods('tx'))
                      .lock(keys[0]!, ...keys.slice(1))
                      .run(work)
                  )
                })
              }
            ).finally(release)
          }
        }),
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
            [revisionKey('metadata', key)],
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
            [revisionKey('metadata', key)],
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
          const orgId = operationOrg(context)
          observe(concurrencyStages, 'beforeLockInspect')
          try {
            const inspect = () => {
              if (!wal) return localGroup(orgId).locks.inspectLocks()
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
  const keyValue: IKeyValueApi = {
    get: base.get,
    set: base.set,
    remove: base.remove,
    has: base.has,
    keys: base.keys,
    clearValues: base.clearValues,
    clearAll: base.clearAll,
    sync: base.sync,
    getMany: async (keys, ctx) => {
      const count = batchSize(keys)
      if (count === 0) {
        throwIfAborted(snapshotOperationContext(ctx)?.signal)
        return []
      }
      /** Capture caller keys before stages; terminal capture includes supported in-place rewrites. */
      const captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
      const input = { keys: captured.map(({ key }) => key) }
      return rootRead(
        SqliteOperation.getMany,
        input,
        ctx,
        (orgId, prepared, observeKey) => {
          const actual = snapshotStorageBatchKeys(
            (prepared as typeof input).keys,
            SqliteNames.backend
          )
          for (const [index, { key, firstIndex }] of actual.entries())
            if (firstIndex === index) observeKey?.(lockKey.text(key))
          return readSnapshot(orgId, (state) => getMany(actual, state))
        },
        { count }
      )
    },
    setMany: async (entries, ctx) => {
      const count = batchSize(entries)
      if (count === 0) {
        throwIfAborted(snapshotOperationContext(ctx)?.signal)
        return
      }
      /** Every duplicate, value and TTL failure precedes the first pipeline or native request. */
      const captured = captureTextEntries(entries)
      const input = { entries: captured.map(({ key, value, ttlMs }) => ({ key, value, ttlMs })) }
      return rootWrite(
        SqliteOperation.setMany,
        input,
        ctx,
        (prepared) => {
          const actual = captureTextEntries(prepared.entries)
          /** Codec success precedes locks and table changes, matching ordinary root replacement. */
          const raw = actual.map((entry) => ({
            ...entry,
            value: convert('text', 'encode', entry.value) as string
          }))
          return {
            keys: actual.flatMap(({ key }) =>
              typeof key === 'string'
                ? [lockKey.text(key), lockKey.bytes(key), lockKey.record(key)]
                : [lockKey.text(key), lockKey.record(key)]
            ),
            run: (state) => {
              for (const entry of raw)
                writeRaw(
                  'text',
                  entry.key,
                  entry.value,
                  state,
                  readTransactionConflictPolicy(state.context, SqliteNames.backend),
                  entry.ttlMs
                )
            }
          }
        },
        { count }
      )
    },
    removeMany: async (keys, ctx) => {
      const count = batchSize(keys)
      if (count === 0) {
        throwIfAborted(snapshotOperationContext(ctx)?.signal)
        return 0
      }
      /** Repeated structural keys share first-position facts and affect one physical row. */
      const captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
      const input = { keys: captured.map(({ key }) => key) }
      return rootWrite(
        SqliteOperation.removeMany,
        input,
        ctx,
        (prepared) => {
          const actual = snapshotStorageBatchKeys(prepared.keys, SqliteNames.backend)
          return {
            keys: actual
              .filter(({ firstIndex }, index) => firstIndex === index)
              .map(({ key }) => lockKey.text(key)),
            run: (state) => {
              return removeTextBatch(actual, state)
            }
          }
        },
        { count }
      )
    },
    removeByPrefix: async (prefix, ctx) => {
      controller.assertLive()
      /** The original prefix owner fixes the caller snapshot before asynchronous middleware. */
      const captured = snapshotStorageKey(prefix, SqliteNames.backend)
      return rootWrite(
        SqliteOperation.removeByPrefix,
        { prefix: captured },
        ctx,
        (input) => {
          const actual = snapshotStorageKey(input.prefix, SqliteNames.backend)
          return {
            keys: [],
            guard: { channels: ['text'], prefix: actual },
            run: (state) => removePrefix('text', actual, state)
          }
        },
        { count: undefined }
      )
    }
  }
  /** Transaction binders retain the authentic complete scope admitted by the original owner. */
  const kvImplementation = implement(kv, keyValue, { forTransaction: (scope) => scope })
  /** Query source delegates iteration to the exact root or original transaction owner. */
  const recordApi: IRecordsApi<TValue> = {
    query: <R = TValue>() =>
      createRecordQuery<R>(
        {
          asyncDisposeKey,
          pushdown: {
            operators: [],
            operations: [],
            source: SqliteNames.backend,
            index: `${table}_${SqliteNames.record}`
          },
          execute: ({ ctx }) => iterator(undefined, ctx)
        },
        core.getChainMethods('query')
      ),
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
          createRecordQuery<R, undefined>(
            {
              asyncDisposeKey,
              pushdown: {
                operators: [],
                operations: [],
                source: SqliteNames.backend,
                index: `${table}_${SqliteNames.record}`
              },
              execute: () =>
                transactionIterator(scope as ISqliteTransactionScope<TValue>, undefined)
            },
            core.getChainMethods('query')
          ),
        removeByPrefix: (prefix) =>
          scoped(
            scope,
            SqliteOperation.removeByPrefix,
            () => ({ prefix: snapshotStorageKey(prefix, SqliteNames.backend) }),
            (state, _current, input) =>
              removePrefix(
                'record',
                snapshotStorageKey((input as { prefix: IStorageKey }).prefix, SqliteNames.backend),
                state
              )
          )
      }) satisfies ITransactionRecordsApi<TValue>
  })
  /** The standard SQL capability borrows the exact native tag and existing operation owner. */
  const sqlImplementation = implement(
    sql,
    { sql: base.sql },
    {
      forTransaction: (scope) => ({ sql: (scope as ISqliteTransactionScope<TValue>).sql })
    }
  )
  /** Standard TTL uses the original native tables and the backend's local wall clock. */
  const timeToLive: ITtlApi = {
    expire: async (target, ms, ctx) => {
      controller.assertLive()
      const captured = captureTtlTarget(target)
      assertStorageTtlDuration(ms, SqliteNames.backend)
      return rootWrite(SqliteOperation.ttlExpire, { target: captured, ms }, ctx, (input) => {
        const target = captureTtlTarget(input.target)
        assertStorageTtlDuration(input.ms, SqliteNames.backend)
        return { keys: [target], run: (state) => changeDeadline(target, state, input.ms) }
      })
    },
    remaining: async (target, ctx) => {
      controller.assertLive()
      const captured = captureTtlTarget(target)
      return rootRead(SqliteOperation.ttlRemaining, captured, ctx, (orgId, input) => {
        const row = expiration(captureTtlTarget(input as ITtlTarget), orgId)
        return row?.expires_at == null
          ? undefined
          : Math.max(0, Number(row.expires_at) - Date.now())
      })
    },
    persist: async (target, ctx) => {
      controller.assertLive()
      const captured = captureTtlTarget(target)
      return rootWrite(SqliteOperation.ttlPersist, captured, ctx, (input) => {
        const target = captureTtlTarget(input)
        return { keys: [target], run: (state) => changeDeadline(target, state) }
      })
    }
  }
  /** Canonical decimal calculation and text writes share one original atomic native operation. */
  const counters: ICounterApi = {
    increment: async (key, by, ctx) => {
      controller.assertLive()
      textInput(key)
      snapshotStorageCounterIncrement(by, SqliteNames.backend)
      return rootWrite(SqliteOperation.counterIncrement, { key, by }, ctx, (input) => {
        textInput(input.key)
        const increment = snapshotStorageCounterIncrement(input.by, SqliteNames.backend)
        return {
          keys: [lockKey.text(input.key), lockKey.bytes(input.key), lockKey.record(input.key)],
          run: (state) => {
            const result = increment(read('text', input.key, state.orgId, state) as string | null)
            write('text', input.key, String(result), state, 'conflict')
            return result
          }
        }
      })
    }
  }
  /** Capability implementations borrow only the private methods on the original complete view. */
  const ttlImplementation = implement(ttl, timeToLive, {
    forTransaction: (scope) => (scope as ISqliteInternalScope<TValue>)[ttlOperations]
  })
  /** No independent counter state, queue, or transaction projection is registered here. */
  const counterImplementation = implement(counter, counters, {
    forTransaction: (scope) => (scope as ISqliteInternalScope<TValue>)[counterOperations]
  })
  try {
    store = provideCapabilities(
      base,
      [
        kvImplementation,
        recordImplementation,
        sqlImplementation,
        ttlImplementation,
        counterImplementation
      ] as const,
      {
        onInstaller: (value) => {
          installer = value
        }
      }
    )
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
    /** Persisted targets restore only original channels and the original flat metadata key codec. */
    const targetKey = (target: IStorageJournalTarget): { channel: IChannel; key: IStorageKey } => {
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
    const journalChanges = (state: INativeState): readonly IStorageJournalChange[] => {
      if (state.journalChanges !== undefined) return state.journalChanges
      if (state.changed.size === 0) return []
      const changes: IStorageJournalChange[] = []
      for (const step of state.journalSteps ?? []) {
        const { channel, key } = targetKey(step.target)
        const first = state.journalBefore!.get(identity(channel, key))!
        if (!first.before.present && !first.current.present) continue
        const current = currentRevision(state, channel, revisionIdentity(channel, key))
        changes.push({
          ...step,
          afterRevision: { birth: current.birth ?? null, version: current.version + (wal ? 0 : 1) }
        })
      }
      return (state.journalChanges = changes)
    }
    /** Marker cleanup joins this exact already-committed physical admission or its original runner. */
    const marker = async <R>(txId: string, invoke: (state: INativeState) => R): Promise<R> => {
      if (typeof txId !== 'string' || txId.length === 0)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      const active = physicalState.active
      if (
        active &&
        active !== SQLITE_CONTROL_ACTIVE &&
        active.orgId === runtime.orgId &&
        active.committedTxId === txId
      )
        return invoke(active)
      return transact((scope) => invoke(journalScope(scope).state), {}, false)
    }
    /** Fixed native namespaces use the existing private journal table and original scope runner. */
    const journal: Omit<IStorageJournalBackendBinding, 'forOrg'> = {
      externalWal: true,
      lockTarget: (target) => {
        const { channel, key } = targetKey(target)
        return revisionKey(channel, key)
      },
      changes: (scope) => journalChanges(journalScope(scope).state),
      readImage: (scope, target) =>
        runTransactionOperation(scope, () => {
          const state = journalScope(scope).state
          const { channel, key } = targetKey(target)
          return Promise.resolve(journalImage(state, channel, key))
        }),
      readRevision: (scope, target) =>
        runTransactionOperation(scope, () => {
          const state = journalScope(scope).state
          const { channel, key } = targetKey(target)
          revision(state, channel, key)
          const current = currentRevision(state, channel, revisionIdentity(channel, key))
          return Promise.resolve({ birth: current.birth ?? null, version: current.version })
        }),
      writeImage: (scope, target, image) =>
        runTransactionOperation(scope, () => {
          const state = journalScope(scope).state
          const { channel, key } = targetKey(target)
          revision(state, channel, key)
          if (!image.present) {
            remove(channel, key, state)
            return Promise.resolve()
          }
          const payload = recordCodec.decode(image.value)
          if (
            payload === null ||
            typeof payload !== 'object' ||
            Array.isArray(payload) ||
            !('value' in payload) ||
            !('deadline' in payload) ||
            !('version' in payload) ||
            payload.version !== 1 ||
            !('channel' in payload) ||
            payload.channel !== channel
          )
            throw sqliteError(SqliteErrorCode.decodeFailed)
          const { value, deadline } = payload
          if (
            typeof value !== 'string' ||
            (deadline !== null && (typeof deadline !== 'number' || !Number.isFinite(deadline))) ||
            (channel === 'metadata' && deadline !== null)
          )
            throw sqliteError(SqliteErrorCode.decodeFailed)
          statement(
            'INSERT INTO ' +
              tables[channel] +
              '(org_id,key,value' +
              (channel === 'metadata' ? '' : ',expires_at') +
              ') VALUES(?,?,?' +
              (channel === 'metadata' ? '' : ',?') +
              ') ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value' +
              (channel === 'metadata' ? '' : ',expires_at=excluded.expires_at'),
            [
              state.orgId,
              encoded(channel, key),
              channel === 'bytes' ? base64ToBytes(value) : value,
              ...(channel === 'metadata' ? [] : [deadline as ISqliteValue])
            ],
            'run',
            state
          )
          changed(state, channel, key)
          return Promise.resolve()
        }),
      writeCommitMarker: (scope, txId) =>
        runTransactionOperation(scope, () => {
          const current = journalScope(scope)
          if (current.info.id !== txId)
            throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          statement(
            'INSERT INTO ' +
              tables.markers +
              '(org_id,key) VALUES(?,?) ON CONFLICT(org_id,key) DO NOTHING',
            [current.state.orgId, txId],
            'run',
            current.state
          )
          return Promise.resolve()
        }),
      hasCommitMarker: (txId) =>
        marker(
          txId,
          (state) =>
            statement<ISqliteRow | undefined>(
              'SELECT key FROM ' + tables.markers + ' WHERE org_id=? AND key=?',
              [state.orgId, txId],
              'get',
              state
            ) !== undefined
        ),
      removeCommitMarker: (txId) =>
        marker(txId, (state) => {
          statement(
            'DELETE FROM ' + tables.markers + ' WHERE org_id=? AND key=?',
            [state.orgId, txId],
            'run',
            state
          )
        }),
      openNamespace: async (prefix) => {
        controller.assertLive()
        if (typeof prefix !== 'string' || prefix.length === 0)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        const bounds = snapshotStorageKeyPrefix([prefix], SqliteNames.backend)
        const lower = keyHex(bounds.lower)
        const upper = keyHex(bounds.upper)
        const namespaceKey = (input: unknown): string => {
          if (typeof input !== 'string')
            throw new StorageContractError(StorageContractErrorCode.invalidArgument)
          return keyHex(encodeOrderedStorageKey([prefix, input], SqliteNames.backend))
        }
        /** Each extracted private operation checks the original scope before touching native rows. */
        const view = (scope: Omit<ITransactionScope, 'use'>): IStorageJournalNamespaceView => {
          const execute = <R>(invoke: (state: INativeState) => R) =>
            runTransactionOperation(scope, () => invoke(journalScope(scope).state))
          const clear = () =>
            execute((state) => {
              statement(
                'DELETE FROM ' + tables.journal + ' WHERE org_id=? AND key>=? AND key<?',
                [state.orgId, lower, upper],
                'run',
                state
              )
            })
          return Object.freeze({
            get: (key: string) =>
              execute((state) => {
                const row = statement<ISqliteRow | undefined>(
                  'SELECT value FROM ' + tables.journal + ' WHERE org_id=? AND key=?',
                  [state.orgId, namespaceKey(key)],
                  'get',
                  state
                )
                if (row === undefined) return null
                try {
                  const value = textCodec.decode(row.value as string)
                  if (typeof value !== 'string') throw sqliteError(SqliteErrorCode.decodeFailed)
                  return value
                } catch (cause) {
                  throw sqliteError(SqliteErrorCode.decodeFailed, cause)
                }
              }),
            has: (key: string) =>
              execute(
                (state) =>
                  statement<ISqliteRow | undefined>(
                    'SELECT key FROM ' + tables.journal + ' WHERE org_id=? AND key=?',
                    [state.orgId, namespaceKey(key)],
                    'get',
                    state
                  ) !== undefined
              ),
            set: (key: string, value: string) =>
              execute((state) => {
                if (typeof value !== 'string')
                  throw new StorageContractError(StorageContractErrorCode.invalidArgument)
                statement(
                  'INSERT INTO ' +
                    tables.journal +
                    '(org_id,key,value) VALUES(?,?,?) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value',
                  [state.orgId, namespaceKey(key), textCodec.encode(value)],
                  'run',
                  state
                )
              }),
            remove: (key: string) =>
              execute((state) => {
                statement(
                  'DELETE FROM ' + tables.journal + ' WHERE org_id=? AND key=?',
                  [state.orgId, namespaceKey(key)],
                  'run',
                  state
                )
              }),
            keys: () =>
              execute((state) =>
                statement<readonly ISqliteRow[]>(
                  'SELECT key FROM ' +
                    tables.journal +
                    ' WHERE org_id=? AND key>=? AND key<? ORDER BY key',
                  [state.orgId, lower, upper],
                  'all',
                  state
                ).map((row) => {
                  const key = decodeHexKey(row.key as string)
                  if (
                    !Array.isArray(key) ||
                    key.length !== 2 ||
                    key[0] !== prefix ||
                    typeof key[1] !== 'string'
                  )
                    throw sqliteError(SqliteErrorCode.decodeFailed)
                  return key[1]
                })
              ),
            clearValues: clear,
            clearAll: clear
          })
        }
        /** Cached native indexes must never survive an actual deletion of their private rows. */
        const openedGeneration = journalGeneration.value
        /** Native terminal sets stay on this exact original transaction, not the shared resource. */
        const project = (scope: Omit<ITransactionScope, 'use'>): IBackendJournalTransaction => {
          const terminal = journalScope(scope).terminal
          const listen = (effects: Set<() => void>, effect: () => void) => {
            effects.add(effect)
            return () => {
              effects.delete(effect)
            }
          }
          return {
            run: (work) => work(view(scope)),
            onCommit: (effect) => listen(terminal.committed, effect),
            onRollback: (effect) => listen(terminal.rolledBack, effect),
            onEnd: (effect) => listen(terminal.ended, effect)
          }
        }
        const exclusive = !wal && typeof physical !== 'string'
        return createBackendJournalNamespace({
          assertLive: () => {
            controller.assertLive()
            if (
              !wal &&
              typeof physical !== 'string' &&
              openedGeneration !== journalGeneration.value
            )
              throw new StorageContractError(StorageContractErrorCode.disposed, {
                backend: SqliteNames.backend
              })
          },
          closingSignal: controller.closingSignal,
          report: (error) => reportCleanupError(report, error),
          /** Only this caller-owned memory connection has reliable lifetime exclusivity. */
          nativeAtomic: true,
          ...(exclusive ? {} : { indexExclusive: false as const }),
          backend: SqliteNames.backend,
          reserve: (hold) =>
            !exclusive
              ? hold()
              : runWithConcurrency(
                  {
                    store,
                    options: { lock: [lockKey.record([SqliteNames.journalOwner, prefix])] },
                    policy: ConcurrencyPolicy.fail()
                  },
                  {
                    attempt: (context) =>
                      localGroup(runtime.orgId).locks.attemptMetadata(
                        context,
                        {
                          owner: controller.origin,
                          since: Date.now(),
                          status: 'held',
                          scope: 'local'
                        },
                        {
                          attempt: async () => {
                            await hold()
                            return { status: 'committed', value: undefined }
                          }
                        },
                        concurrencyStages,
                        controller.closingSignal
                      )
                  }
                ),
          authenticate: (scope) => ({ info: journalScope(scope).info, port: project(scope) }),
          transaction: (work) => transact((scope) => work(project(scope)), {}, false)
        })
      }
    }
    return {
      store,
      client,
      controller,
      installer,
      journal,
      createOrg: (orgId, orgCore) =>
        createSqliteStore<TValue>(
          { driver, table, concurrency, owner: { label }, maxLockMs, wal },
          {
            core: orgCore,
            orgId,
            ...(orgId === runtime.orgId ? { journalGeneration } : {})
          },
          physicalState
        ),
      dropOrg: () =>
        rootWrite(SqliteOperation.dropOrg, undefined, undefined, () => ({
          keys: [],
          committed: () => {
            journalGeneration.value = {}
          },
          guard: { channels: ['text', 'bytes', 'record'] },
          run: (state) => {
            clear(['text', 'bytes', 'record'], state)
            for (const name of [
              'metadata',
              'journal',
              'markers',
              ...(wal ? (['locks', 'revisions'] as const) : [])
            ] as const)
              statement(
                'DELETE FROM ' + tables[name] + ' WHERE org_id=?',
                [state.orgId],
                'run',
                state
              )
          }
        })),
      getTransactionClient: (scope) => {
        nativeFor(scope)
        return client
      }
    }
  } catch (error) {
    void controller.dispose().catch((cleanup) => reportCleanupError(report, cleanup))
    throw normalizeSqliteFailure(error)
  }
}
