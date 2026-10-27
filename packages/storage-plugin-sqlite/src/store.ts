import {
  createBackendChangeController,
  snapshotStorageKey,
  snapshotStorageBatchKeys,
  createStorageBatchKeyCapture,
  projectStorageBatchKeys,
  createStorageBatchKeyProjection,
  encodeOrderedStorageKey,
  snapshotStorageKeyPrefix,
  snapshotStorageTtlTarget,
  snapshotStorageCounterIncrement,
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
  createRecordQuery,
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
  assertKeyRange,
  observeStorageBatch,
  type IBackendChangeController,
  type IBackendKeyLockPort,
  type IBackendRevisionPort
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  assertStringStorageKey,
  assertStorageKey,
  assertStorageTtlDuration,
  assertStorageTtlTarget,
  assertOperationContext,
  assertSyncWriteOptions,
  assertTransactionCallback,
  readTransactionConflictPolicy,
  implement,
  kv,
  records,
  sql,
  ttl,
  counter,
  type IStorageKey,
  type IStorageBase,
  type ITransactionScope,
  type IStorageBatchKey,
  type IStorageBatchKeyCapture,
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
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import {
  defineCollectionsJsonCodec,
  type ICollectionsCodecValue
} from '@migaia/serialize/codecs/collections-json'
import { createConcurrencyLimiter, sleep, deferred } from '@migaia/utils/promise'
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
import { SqliteErrorCode } from '@migaia/storage-contract/error-code'
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
  /** An unselected read keeps its original native segment instead of opening a writer. */
  readonly read?: (observeKey?: (key: ILockKey) => void) => R
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

/** One fixed organization owns native layout and ports; physical admission remains shared. */
type ISqliteOrganizationContext<TValue> = {
  /** The original driver belongs to this fixed organization and native installation. */
  driver: ISqliteDriver
  /** The original table belongs to this fixed organization and native installation. */
  table: string
  /** The original concurrency belongs to this fixed organization and native installation. */
  concurrency: ISqliteOptions['concurrency']
  /** The original maxLockMs belongs to this fixed organization and native installation. */
  maxLockMs: number
  /** Nested owner metadata is captured once and never read during later attempts. */
  label: string | undefined
  /** The original core belongs to this fixed organization and native installation. */
  core: IStoragePluginCore
  /** Committed organization deletion invalidates only its existing private memory indexes. */
  journalGeneration: { value: object }
  /** Batch durations use the existing host clock without introducing a backend timer. */
  scheduler: ReturnType<IStoragePluginCore['featureExpose']['getScheduler']>
  /** One final reporting boundary observes cleanup and observer failures. */
  report: ReturnType<typeof createStorageOperationReporter>
  /** A single bounded statement Map belongs to this store and is cleared at release. */
  statements: ReturnType<typeof createSqliteStatements>
  /** Feature authors borrow native operations without acquiring the creating caller's close handles. */
  client: ISqliteDriver
  /** Physical table names are quoted only after their complete suffix has been assembled. */
  tables: Record<IChannel | 'locks' | 'revisions' | 'journal' | 'markers', string>
  /** The original channel owner supplies native identity bounds and inverse channel recognition. */
  channelRanges: readonly (ReturnType<typeof snapshotConcurrencyLockRange> & {
    readonly channel: 'text' | 'bytes' | 'record'
  })[]
  /** The builtin driver reports the actual physical file, not the caller's path spelling. */
  physical: object | string
  /** Actual WAL result determines which approved concurrency primitive is selected. */
  wal: boolean
  /** Shared lock provider is created only within this installation window. */
  group:
    | {
        readonly locks: IBackendKeyLockPort
        readonly revisions: IBackendRevisionPort
        readonly birth: string
        references: number
      }
    | undefined
  /** Group identity encodes only package-owned configuration, never business values. */
  groupId: string
  /** The original shared connection state owns physical admission and the active native attempt. */
  physicalState: ISqlitePhysicalState
  /** Every organization uses the original connection's one native admission limiter. */
  physicalAdmission: ReturnType<typeof createConcurrencyLimiter>
  /** The original controller releases detached root snapshots when this store drains. */
  snapshots: Set<() => Promise<void>>
  /** The host's original controller owns logical closure and draining accepted backend work. */
  controller: IBackendChangeController
  /** Text storage uses the existing surrogate-safe JSON codec. */
  textCodec: ReturnType<typeof defineJsonCodec>
  /** Collections and class projection use the sole portable codec implementation. */
  recordCodec: ReturnType<typeof defineCollectionsJsonCodec>
  /** The public organization view keeps canonical capability and transaction identity. */
  store: ISqliteStore<TValue>
  /** Capability installation remains provider-owned and is transferred to the host once. */
  installer: ICapabilityInstallPort
  /** Canonical transaction admission authenticates every short-lived organization scope. */
  transactionOwner: ReturnType<
    typeof createTransactionOwner<TValue, ISqliteTransactionScope<TValue>>
  >
  /** Observer factories are bound after the complete store exists. */
  stages: IBackendStageBindings
  /** Current observer values remain host-owned live getters. */
  operationStages: ReturnType<IBackendStageBindings['operationStages']>
  /** SQL observes only compiled statistics after operation admission. */
  sqlStages: ReturnType<IBackendStageBindings['sqlStages']>
  /** Codec observers bind each actual conversion to its current short view. */
  codecStages: ReturnType<IBackendStageBindings['codecStages']>
  /** Concurrency observations are passed into the same shared lock provider. */
  concurrencyStages: ReturnType<IBackendStageBindings['concurrencyStages']>
  /** Original transaction observers remain bound to their single host registry. */
  transactionStages: ReturnType<IBackendStageBindings['transactionStages']>
  /** Symbolic disposal caches its report-only settlement separately from explicit disposal. */
  symbolic: Promise<void> | undefined
  /** Only this original physical admission interval may borrow its acquired WAL token. */
  expectedToken:
    | {
        readonly context: IConcurrencyAttemptContext
        readonly token: string
        readonly expiresAt: number
      }
    | undefined
  /** The original runtime belongs to this fixed organization and native installation. */
  runtime: ISqliteRuntime
  /** The original shared belongs to this fixed organization and native installation. */
  shared: ISqlitePhysicalState | undefined
}
/** A scoped organization cannot redirect captured native operations to another organization. */
function sqliteOperationOrg<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  context: IOperationContext | undefined
): string {
  const orgId = context?.orgId
  if (
    organization.shared !== undefined &&
    orgId !== undefined &&
    orgId !== organization.runtime.orgId
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend
    })
  const selected = orgId ?? organization.runtime.orgId
  if (organization.shared === undefined && selected !== organization.runtime.orgId)
    organization.runtime.ensureOrg?.(selected)
  return selected
}
/** Every context uses the original physical file/table/org group, including root redirects. */
function sqliteLocalGroup<TValue>(organization: ISqliteOrganizationContext<TValue>, orgId: string) {
  return orgId === organization.runtime.orgId
    ? organization.group!
    : physicalGroups.get(organization.physical)!.get(JSON.stringify([organization.table, orgId]))!
}
/** The existing org call context supplies the one configured journal port for its actual org. */
function sqliteJournalFor<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  context?: IOperationContext
): IStorageJournalExecutionPort | undefined {
  if (organization.core.journal === undefined) return undefined
  const orgId = sqliteOperationOrg(organization, context)
  return orgId === organization.runtime.orgId
    ? organization.core.journal
    : organization.core.getOrgContext(orgId).journal
}
/** Root calls cannot borrow the connection while any actual native transaction owns it. */
function sqliteAssertRoot<TValue>(organization: ISqliteOrganizationContext<TValue>): void {
  organization.controller.assertLive()
  if (organization.physicalState.active) throw sqliteError(SqliteErrorCode.transactionFailed)
}
/** Scope authorization returns the existing native attempt, never a copy or public marker. */
function sqliteNativeFor<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  scope: object,
  expectedStore: IStorageBase = organization.store
): INativeState {
  assertTransactionOwner(expectedStore, scope)
  if (
    !organization.physicalState.active ||
    organization.physicalState.active === SQLITE_CONTROL_ACTIVE
  )
    throw sqliteError(SqliteErrorCode.transactionFailed)
  throwIfAborted(organization.physicalState.active.context?.signal)
  if (
    organization.physicalState.active.expiresAt !== undefined &&
    Date.now() >= organization.physicalState.active.expiresAt
  )
    throw new StorageContractError(StorageContractErrorCode.lockLost)
  return organization.physicalState.active
}
/** Only the original active transaction owner authenticates a namespace's exact fixed org. */
function sqliteJournalScope<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  scope: Omit<ITransactionScope, 'use'>
) {
  const state = organization.physicalState.active
  if (!state || state === SQLITE_CONTROL_ACTIVE || !state.scopeStore)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  sqliteNativeFor(organization, scope, state.scopeStore)
  const info = assertTransactionOwner(state.scopeStore, scope)
  if (state.orgId !== organization.runtime.orgId)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  state.journalTerminal ??= { committed: new Set(), rolledBack: new Set(), ended: new Set() }
  return { state, info, terminal: state.journalTerminal }
}
/**
 * Actual data outcome and native resource completion are separate facts, including unknown
 * failures.
 */
function sqliteFinishJournal<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  state: INativeState,
  success?: boolean
): void {
  const terminal = state.journalTerminal
  if (terminal === undefined) return
  if (success !== undefined)
    for (const effect of success ? terminal.committed : terminal.rolledBack) {
      try {
        const result = effect()
        void Promise.resolve(result).catch((error) =>
          reportCleanupError(organization.report, error)
        )
      } catch (error) {
        reportCleanupError(organization.report, error)
      }
    }
  for (const effect of terminal.ended) {
    try {
      effect()
    } catch (error) {
      reportCleanupError(organization.report, error)
    }
  }
  terminal.committed.clear()
  terminal.rolledBack.clear()
  terminal.ended.clear()
  state.journalTerminal = undefined
}
/** Package SQL errors stay coded, and only native write BUSY can enter recovery. */
function sqliteStatement<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  text: string,
  values: readonly ISqliteValue[],
  method: 'get' | 'all' | 'run',
  state?: INativeState
): R {
  try {
    const prepared = organization.statements.get(text)
    return prepared[method](...values) as R
  } catch (error) {
    if (state?.mode === 'deferred' && method === 'run' && sqliteIsBusy(organization, error))
      throw new SqlitePhysicalBusy(error)
    throw normalizeSqliteFailure(error)
  }
}
/** Native code inspection walks only this trusted driver's cause chain. */
function sqliteIsBusy<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  error: unknown
): boolean {
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
function sqliteEncoded<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey
): string | Uint8Array {
  const bytes = encodeOrderedStorageKey(key, SqliteNames.backend)
  return channel === 'record' ? bytes : keyHex(bytes)
}
/** Revision keys reuse the canonical original channel identity rather than another key format. */
function sqliteIdentity<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: IChannel,
  key: IStorageKey
): string {
  return channel === 'metadata'
    ? keyHex(encodeOrderedStorageKey(key, SqliteNames.backend))
    : snapshotConcurrencyLockKeys([{ channel, key }], SqliteNames.backend).identities[0]!
}
/** Native diagnostics recognize the channel through original bounds without copying rank tags. */
function sqliteIdentityRange<TValue>(organization: ISqliteOrganizationContext<TValue>, id: string) {
  const range = organization.channelRanges.find(({ lower, upper }) => id >= lower && id < upper)
  if (!range)
    throw sqliteError(SqliteErrorCode.decodeFailed, new Error(SqliteErrorText.malformedKey))
  return range
}
/**
 * SqliteDecodeLockIdentity uses explicit organization state and the original native execution
 * owner.
 */
function sqliteDecodeLockIdentity<TValue>(
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
function sqliteRevisionKey<TValue>(
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
function sqliteRevisionIdentity<TValue>(
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
function sqliteCurrentRevision<TValue>(
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
function sqliteJournalImage<TValue>(
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
function sqliteRevision<TValue>(
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
function sqliteChanged<TValue>(
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
function sqliteAdvanceRevisions<TValue>(
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
function sqlitePublishChanges<TValue>(
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
/** Actual codec calls share one failure policy for roots, scopes and iterator advances. */
function sqliteConvert<TValue>(
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
function sqliteRead<TValue>(
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
function sqlitePrune<TValue>(
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
function sqliteLiveExpiration<TValue>(
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
function sqliteCleanupExpiredRows<TValue>(
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
function sqliteAssertTtlTarget(input: ITtlTarget): asserts input is ISqliteTtlTarget {
  assertStorageTtlTarget(input, SqliteNames.backend)
  if (input.channel !== 'text' && input.channel !== 'bytes' && input.channel !== 'record')
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: SqliteNames.backend
    })
}
/** Capture target keys before middleware, logical locks or physical admission can await. */
function sqliteCaptureTtlTarget(input: ITtlTarget): ISqliteTtlTarget {
  sqliteAssertTtlTarget(input)
  return snapshotStorageTtlTarget(input, SqliteNames.backend) as ISqliteTtlTarget
}
/** Deadline reads and writes share the original attempt's first live native observation. */
function sqliteExpiration<TValue>(
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
function sqliteChangeDeadline<TValue>(
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
function sqliteWrite<TValue>(
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
function sqliteWriteRaw<TValue>(
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
function sqliteRemove<TValue>(
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
function sqliteRecordRows<TValue>(
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
/** SqliteOperation uses explicit organization state and the original native execution owner. */
function sqliteOperation<TValue, I, R>(
  organization: ISqliteOrganizationContext<TValue>,
  name: string,
  input: I,
  context: IOperationContext | undefined,
  scope: object | undefined,
  run: (captured: I) => R,
  batch?: IBatchObservation
): Promise<Awaited<R>> {
  /** The original owner admits scope work synchronously before pipeline or codec work. */
  const execute = (currentScope?: object): Promise<Awaited<R>> => {
    /** The existing executor remains the sole pipeline owner for either observation form. */
    const invoke = (): Promise<Awaited<R>> =>
      organization.core.execution.run<I, Awaited<R>>(
        { operation: name, input, ctx: context, scope: currentScope, internal: true },
        async (captured): Promise<Awaited<R>> => {
          if (batch) return (await run(captured)) as Awaited<R>
          /** Existing single calls retain their original observer binding point after the stage. */
          const observer = currentScope
            ? organization.operationStages.forTransaction(currentScope)
            : organization.operationStages
          const started = Date.now()
          sqliteObserve(organization, observer, 'beforeStorageOperation', name)
          try {
            const result = await run(captured)
            sqliteObserve(
              organization,
              observer,
              'afterStorageOperation',
              name,
              Date.now() - started,
              1
            )
            return result as Awaited<R>
          } catch (error) {
            sqliteObserve(
              organization,
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
          currentScope
            ? organization.operationStages.forTransaction(currentScope)
            : organization.operationStages,
          organization.scheduler,
          name,
          batch.count,
          invoke
        )
      : invoke()
  }
  return scope ? runTransactionOperation(scope, (current) => execute(current)) : execute()
}
/** Synchronous calls use the original stage list and cannot wait for async middleware. */
function sqliteSynchronous<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  name: string,
  input: unknown,
  run: () => R
): R {
  sqliteAssertRoot(organization)
  return organization.core.execution.runSync({ operation: name, input }, () => {
    sqliteObserve(organization, organization.operationStages, 'beforeStorageOperation', name)
    const started = Date.now()
    try {
      const result = run()
      sqliteObserve(
        organization,
        organization.operationStages,
        'afterStorageOperation',
        name,
        Date.now() - started,
        1
      )
      return result
    } catch (error) {
      sqliteObserve(
        organization,
        organization.operationStages,
        'onStorageOperationError',
        name,
        (error as { code?: unknown })?.code
      )
      throw error
    }
  })
}
/** Every transaction data entry receives its actual newly authorized operation view. */
function sqliteScoped<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  scope: object,
  name: string,
  input: unknown,
  run: (state: INativeState, current: ISqliteTransactionScope<TValue>, input: unknown) => R,
  batch?: IBatchObservation
): Promise<Awaited<R>> {
  return runTransactionOperation(scope, (current) => {
    const state = sqliteNativeFor(organization, current)
    /** Capture inside original admission, before an asynchronous pipeline can wait. */
    const capturedInput = typeof input === 'function' ? input() : input
    /** An empty native batch remains admitted but opens no pipeline, hook, or native request. */
    if (batch?.count === 0)
      return run(state, current as ISqliteTransactionScope<TValue>, capturedInput)
    /** Existing scope admission owns one execution; batches only share its observation wrapper. */
    const execute = () =>
      organization.core.execution.run(
        { operation: name, input: capturedInput, scope: current },
        async (preparedInput) => {
          const observer = organization.operationStages.forTransaction(current)
          const transactionObserver = organization.transactionStages.forTransaction(current)
          sqliteObserve(organization, transactionObserver, 'beforeTxOperation', name)
          if (batch)
            return observeStorageBatch(
              observer,
              organization.scheduler,
              name,
              batch.count,
              async () => {
                const result = await run(
                  state,
                  current as ISqliteTransactionScope<TValue>,
                  preparedInput
                )
                sqliteObserve(organization, transactionObserver, 'afterTxOperation', name)
                return result as Awaited<R>
              }
            )
          sqliteObserve(organization, observer, 'beforeStorageOperation', name)
          const started = Date.now()
          try {
            const result = await run(
              state,
              current as ISqliteTransactionScope<TValue>,
              preparedInput
            )
            sqliteObserve(organization, transactionObserver, 'afterTxOperation', name)
            sqliteObserve(
              organization,
              observer,
              'afterStorageOperation',
              name,
              Date.now() - started,
              1
            )
            return result as Awaited<R>
          } catch (error) {
            sqliteObserve(
              organization,
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
}
/** String inputs use the existing key owner and the channel's narrow value contract. */
function sqliteTextInput<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  key: string,
  value?: unknown,
  writing = false
): void {
  assertStringStorageKey(key, SqliteNames.backend)
  if (writing && typeof value !== 'string')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend,
      cause: new TypeError(SqliteErrorText.textValue)
    })
}
/** Binary data is captured before asynchronous stages can retain caller-owned views. */
function sqliteBytesInput<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  key: string,
  value: Uint8Array
): Uint8Array {
  assertStringStorageKey(key, SqliteNames.backend)
  if (!(value instanceof Uint8Array))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend,
      cause: new TypeError(SqliteErrorText.byteValue)
    })
  return value.slice()
}
/** Root reads own a short lease and never join an active callback's connection. */
function sqliteRootRead<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  name: string,
  input: unknown,
  ctx: IOperationContext | undefined,
  run: (
    orgId: string,
    input: unknown,
    observeKey?: (key: ILockKey) => void,
    state?: INativeState
  ) => R,
  batch?: IBatchObservation
): Promise<Awaited<R>> {
  organization.controller.assertLive()
  if (
    organization.core.journal !== undefined &&
    name !== SqliteOperation.metadataGet &&
    name !== SqliteOperation.metadataSet &&
    name !== SqliteOperation.metadataDelete &&
    name !== SqliteOperation.sql
  ) {
    /** The original loop starts the one budget before preparation or the existing pipeline. */
    try {
      sqliteAssertRoot(organization)
    } catch (error) {
      return Promise.reject(error)
    }
    return sqliteRootWrite(
      organization,
      name,
      input,
      ctx,
      (captured, context) => {
        sqliteAssertRoot(organization)
        const orgId = sqliteOperationOrg(organization, context)
        return {
          keys: [],
          read: (observeKey) => {
            sqliteAssertRoot(organization)
            return run(orgId, captured, observeKey)
          },
          run: (state) => run(orgId, captured, undefined, state)
        }
      },
      batch
    )
  }
  const finish = organization.controller.beginMutation()
  /** Only the enabled observer retains actual synchronous read facts. */
  let keys: ILockKey[] | undefined
  let capturedInput = input
  const execute = () =>
    withAbort<Awaited<R>>(ctx, async (signal, context): Promise<Awaited<R>> => {
      sqliteAssertRoot(organization)
      throwIfAborted(signal)
      const selectedJournal = sqliteJournalFor(organization, context)
      if (selectedJournal !== undefined) await selectedJournal.prepare()
      return sqliteOperation(
        organization,
        name,
        input,
        context,
        undefined,
        (captured) => {
          sqliteAssertRoot(organization)
          throwIfAborted(signal)
          capturedInput = captured
          return run(
            sqliteOperationOrg(organization, context),
            captured,
            keys === undefined ? undefined : (key) => keys!.push(key)
          )
        },
        batch
      )
    })
  const result =
    organization.core.execution.observe === undefined
      ? execute()
      : organization.core.execution.observe(
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
/** One root write owns its captured payload and observed attempt facts through canonical retry. */
class SqliteRootWrite<TValue, I, R> {
  /** Native layout and admission stay with the original organization. */
  readonly #organization: ISqliteOrganizationContext<TValue>
  /** Stable operation name identifies the original pipeline and observer events. */
  readonly #name: string
  /** Initial payload remains available until the original pipeline captures actual input. */
  readonly #input: I
  /** Canonical concurrency owns this caller context's one budget and signal. */
  readonly #ctx: IOperationContext | undefined
  /** Terminal preparation chooses exact native keys and work after pipeline transformation. */
  readonly #prepare: (captured: I, context?: IOperationContext) => IRootMutation<R>
  /** Native batch observation retains its original optional input count. */
  readonly #batch: IBatchObservation | undefined
  /** The original pipeline writes its final accepted payload here once per operation. */
  #capturedInput!: I
  /** Prepared native work is rebound only by canonical attempt lock derivation. */
  #mutation!: IRootMutation<R>
  /** The selected original journal port shares preparation, head locks and the native attempt. */
  #selectedJournal: IStorageJournalExecutionPort | undefined
  /** Telemetry allocates native key facts only when the existing observer enables it. */
  #observing = false
  /** Final real native observations remain available to the outer operation observer. */
  #observedKeys: readonly ILockKey[] | undefined
  /** Own callback retains the operation while native attempts report their exact observations. */
  readonly #recordKeys = (state: INativeState): void => {
    this.#observedKeys = [...state.observed!.values()]
  }
  /** Bind operation context without starting another transaction or retry owner. */
  constructor(
    organization: ISqliteOrganizationContext<TValue>,
    name: string,
    input: I,
    ctx: IOperationContext | undefined,
    prepare: (captured: I, context?: IOperationContext) => IRootMutation<R>,
    batch: IBatchObservation | undefined
  ) {
    this.#organization = organization
    this.#name = name
    this.#input = input
    this.#ctx = ctx
    this.#prepare = prepare
    this.#batch = batch
  }
  /** Canonical concurrency alone owns logical attempts, locks and physical waiting. */
  #execute(): Promise<Awaited<R>> {
    return runWithConcurrency<Awaited<R>>(
      {
        store: this.#organization.store,
        options: this.#ctx === undefined ? {} : this.#ctx,
        prepare:
          this.#organization.core.journal === undefined || this.#name === SqliteOperation.dropOrg
            ? undefined
            : (context) => {
                this.#selectedJournal = sqliteJournalFor(this.#organization, context)
                return this.#selectedJournal?.prepare()
              },
        execute: (context, proceed) =>
          sqliteOperation(
            this.#organization,
            this.#name,
            this.#input,
            context,
            undefined,
            (captured) => {
              this.#capturedInput = captured
              return proceed()
            },
            this.#batch
          ),
        lock: (context) => {
          this.#mutation = this.#prepare(this.#capturedInput, context)
          return [...this.#mutation.keys, ...(this.#selectedJournal?.headLocks() ?? [])]
        }
      },
      {
        attempt: (context) => this.#attempt(context)
      }
    )
  }
  /** One explicit native retry loop distinguishes logical range conflicts from physical BUSY. */
  async #attempt(context: IConcurrencyAttemptContext): Promise<IConcurrencyAttempt<Awaited<R>>> {
    const guard = this.#mutation.guard
    const ranges = guard ? sqliteLockRanges(this.#organization, guard) : []
    const ids = readConcurrencyLockIdentities(context)
    /** Logical fail decisions remain observable before entering the physical queue. */
    const conflict = this.#organization.wal
      ? sqliteConflictingLock(this.#organization, context, ids, '')
      : undefined
    const range =
      this.#organization.wal && guard
        ? sqliteRangeConflict(
            this.#organization,
            sqliteOperationOrg(this.#organization, context),
            guard
          )
        : undefined
    if ((conflict || range) && context.admission === 'try')
      return {
        status: 'conflict' as const,
        phase: 'acquire' as const,
        keys: conflict ? [conflict.key] : range!.keys,
        holder: conflict ? sqliteHolderOf(this.#organization, conflict.row) : range!.holder
      }
    while (true) {
      throwIfAborted(context.signal)
      try {
        if (this.#mutation.read !== undefined && !this.#selectedJournal?.active()) {
          const keys: ILockKey[] | undefined = this.#observing ? [] : undefined
          try {
            return {
              status: 'committed' as const,
              value: this.#mutation.read(
                keys === undefined ? undefined : (key) => keys.push(key)
              ) as Awaited<R>
            }
          } finally {
            this.#observedKeys = keys
          }
        }
        const write = () =>
          sqliteSyncMutation(
            this.#organization,
            this.#mutation.run,
            context.lock ?? [],
            guard,
            sqliteOperationOrg(this.#organization, context),
            context,
            this.#mutation.committed,
            this.#observing ? this.#recordKeys : undefined
          ) as Awaited<R>
        if (this.#selectedJournal?.active()) {
          const native = () =>
            sqliteNativeAttempt(
              this.#organization,
              context,
              (scope) => this.#mutation.run(sqliteJournalScope(this.#organization, scope).state),
              true,
              this.#mutation.committed,
              this.#observing ? this.#recordKeys : undefined
            )
          const run = () =>
            sqlitePhysicalRun(this.#organization, context, () =>
              this.#organization.wal
                ? sqliteWalAttempt(this.#organization, context, native)
                : native()
            )
          return this.#organization.wal
            ? await run()
            : await sqliteLocalGroup(
                this.#organization,
                sqliteOperationOrg(this.#organization, context)
              ).locks.attempt(
                context,
                {
                  owner: this.#organization.controller.origin,
                  since: Date.now(),
                  status: 'held',
                  scope: 'local'
                },
                { attempt: run },
                this.#organization.concurrencyStages,
                this.#organization.controller.closingSignal,
                ranges
              )
        }
        return this.#organization.wal
          ? await sqlitePhysicalRun(this.#organization, context, () =>
              sqliteWalAttempt(this.#organization, context, async () => ({
                status: 'committed' as const,
                value: write() as Awaited<R>
              }))
            )
          : await sqliteLocalGroup(
              this.#organization,
              sqliteOperationOrg(this.#organization, context)
            ).locks.attemptWrite(
              context,
              {
                owner: this.#organization.controller.origin,
                ...(this.#organization.label === undefined
                  ? {}
                  : { label: this.#organization.label }),
                since: Date.now(),
                status: 'held',
                scope: 'local'
              },
              write,
              this.#organization.concurrencyStages,
              this.#organization.controller.closingSignal,
              ranges,
              (commit) => sqlitePhysicalRun(this.#organization, context, commit)
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
        } else if (!(error instanceof AggregateError) && sqliteIsBusy(this.#organization, error))
          await context.waitPhysical(sleep(SqliteLimits.pollMs, { signal: context.signal }))
        else throw error
      }
    }
  }
  /** Keep the original controller lease and returned finally promise. */
  run(): Promise<Awaited<R>> {
    this.#organization.controller.assertLive()
    const finish = this.#organization.controller.beginMutation()
    const result =
      this.#organization.core.execution.observe === undefined
        ? this.#execute()
        : this.#organization.core.execution.observe(
            () => ({
              operation: this.#name,
              input: this.#capturedInput ?? this.#input,
              keys: () => this.#observedKeys ?? []
            }),
            (enabled) => {
              this.#observing = enabled
              return this.#execute()
            }
          )
    return result.finally(finish)
  }
}
/** Root mutations declare affected original channel keys before logical lock acquisition. */
function sqliteRootWrite<TValue, I, R>(
  organization: ISqliteOrganizationContext<TValue>,
  name: string,
  input: I,
  ctx: IOperationContext | undefined,
  prepare: (captured: I, context?: IOperationContext) => IRootMutation<R>,
  batch?: IBatchObservation
): Promise<Awaited<R>> {
  return new SqliteRootWrite(organization, name, input, ctx, prepare, batch).run()
}

/** Standard channel preparation owns payload conversion before the shared lock provider runs. */
function sqlitePrepareWrite<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  channel: 'text' | 'bytes' | 'record',
  key: IStorageKey,
  value: unknown
): Omit<IRootMutation<void>, 'read'> {
  const raw =
    channel === 'bytes'
      ? (value as Uint8Array).slice()
      : (sqliteConvert(organization, channel, 'encode', value) as string)
  return {
    keys:
      typeof key === 'string'
        ? [lockKey.text(key), lockKey.bytes(key), lockKey.record(key)]
        : [lockKey.text(key), lockKey.record(key)],
    run: (state) =>
      sqliteWriteRaw(
        organization,
        channel,
        key,
        raw,
        state,
        readTransactionConflictPolicy(state.context, SqliteNames.backend)
      )
  }
}
/** Empty root calls still validate their live resource and supplied context without doing I/O. */
function sqliteBatchSize<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  input: readonly unknown[]
): number {
  organization.controller.assertLive()
  if (!Array.isArray(input))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend
    })
  return input.length
}
/** Validate native text fields using the canonical key owner's selected capture or projection. */
function sqliteTextBatchEntries(
  entries: Parameters<IKeyValueApi['setMany']>[0],
  capture: IStorageBatchKeyCapture
): readonly ITextBatchEntry[] {
  if (!Array.isArray(entries))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend: SqliteNames.backend
    })
  /** Length is fixed before any caller entry can extend the array. */
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
}
/** Detach caller or transformed keys before asynchronous stages or physical admission. */
function sqliteCaptureTextEntries(
  entries: Parameters<IKeyValueApi['setMany']>[0]
): readonly ITextBatchEntry[] {
  return sqliteTextBatchEntries(entries, createStorageBatchKeyCapture(SqliteNames.backend))
}
/** Scope terminals execute native statements synchronously after middleware, without another wait. */
function sqliteProjectTextEntries(
  entries: Parameters<IKeyValueApi['setMany']>[0]
): readonly ITextBatchEntry[] {
  return sqliteTextBatchEntries(entries, createStorageBatchKeyProjection(SqliteNames.backend))
}
/** A root read's synchronous native segment holds one real read snapshot across every IN chunk. */
function sqliteReadSnapshot<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  orgId: string,
  run: (state: INativeState) => R
): R {
  sqliteAssertRoot(organization)
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
  sqliteStatement(organization, SqliteControl.deferred, [], 'run')
  organization.physicalState.active = SQLITE_CONTROL_ACTIVE
  try {
    const result = run(state)
    sqliteStatement(organization, SqliteControl.commit, [], 'run')
    organization.physicalState.active = undefined
    sqliteAdvanceRevisions(organization, state)
    sqlitePublishChanges(organization, state)
    return result
  } catch (error) {
    return sqliteRollback(
      organization,
      error instanceof SqlitePhysicalBusy ? normalizeSqliteFailure(error.cause) : error
    )
  }
}
/** Batch get uses bounded IN lists inside one real native transaction snapshot. */
function sqliteGetMany<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  keys: readonly IStorageBatchKey[],
  state: INativeState,
  scope?: object
): readonly (string | undefined)[] {
  const result = new Map<string, string>()
  const captured = keys.filter(({ firstIndex }, index) => firstIndex === index)
  /** Native expired rows map back to original snapshots in linear total work. */
  const keysByIdentity = new Map(captured.map(({ identity, key }) => [identity, key]))
  /** Every chunk uses the same operation-local expiry cutoff inside the same native snapshot. */
  const now = Date.now()
  for (let index = 0; index < captured.length; index += SqliteLimits.batch) {
    const part = captured.slice(index, index + SqliteLimits.batch).map(({ identity }) => identity)
    const rows = sqliteStatement<TValue, readonly ISqliteRow[]>(
      organization,
      `SELECT key,value,expires_at FROM ${organization.tables.text} WHERE org_id=? AND key IN (${part.map(() => '?').join(',')})`,
      [state.orgId, ...part],
      'all',
      state
    )
    for (const row of rows) {
      if (
        !sqliteLiveExpiration(
          organization,
          'text',
          keysByIdentity.get(row.key as string)!,
          row.expires_at,
          state,
          now
        )
      )
        sqlitePrune(organization, 'text', keysByIdentity.get(row.key as string)!, state)
      else
        result.set(
          row.key as string,
          sqliteConvert(organization, 'text', 'decode', row.value, scope) as string
        )
    }
  }
  for (const { key } of captured) sqliteRevision(organization, state, 'text', key)
  return keys.map(({ identity }) => result.get(identity))
}
/** Distinct physical deletions use bounded IN lists and one existing native transaction. */
function sqliteRemoveTextBatch<TValue>(
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
function sqliteRemovePrefix<TValue>(
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
/** Create the full scope afresh for callback, accepted operation and final validation views. */
function sqliteCreateScope<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): ISqliteTransactionScope<TValue> {
  /** Method arrows capture this exact scope identity, never an older callback view. */
  const scope: ISqliteInternalScope<TValue> = {
    [ttlOperations]: {
      expire: (target, ms) =>
        sqliteScoped(
          organization,
          scope,
          SqliteOperation.ttlExpire,
          () => {
            const captured = sqliteCaptureTtlTarget(target)
            assertStorageTtlDuration(ms, SqliteNames.backend)
            return { target: captured, ms }
          },
          (state, _current, input) => {
            const current = input as { target: ITtlTarget; ms: number }
            const target = current.target
            sqliteAssertTtlTarget(target)
            assertStorageTtlDuration(current.ms, SqliteNames.backend)
            return sqliteChangeDeadline(organization, target, state, current.ms)
          }
        ),
      remaining: (target) =>
        sqliteScoped(
          organization,
          scope,
          SqliteOperation.ttlRemaining,
          () => sqliteCaptureTtlTarget(target),
          (state, _current, input) => {
            /**
             * Native expiry lookup runs before this terminal returns; no further await borrows
             * input.
             */
            const target = input as ITtlTarget
            sqliteAssertTtlTarget(target)
            const row = sqliteExpiration(organization, target, state.orgId, state)
            return row?.expires_at == null
              ? undefined
              : Math.max(0, Number(row.expires_at) - Date.now())
          }
        ),
      persist: (target) =>
        sqliteScoped(
          organization,
          scope,
          SqliteOperation.ttlPersist,
          () => sqliteCaptureTtlTarget(target),
          (state, _current, input) => {
            /** This synchronous native segment consumes the accepted target without another image. */
            const target = input as ITtlTarget
            sqliteAssertTtlTarget(target)
            return sqliteChangeDeadline(organization, target, state)
          }
        )
    },
    [counterOperations]: {
      increment: (key, by) =>
        sqliteScoped(
          organization,
          scope,
          SqliteOperation.counterIncrement,
          () => {
            sqliteTextInput(organization, key)
            snapshotStorageCounterIncrement(by, SqliteNames.backend)
            return { key, by }
          },
          (state, current, input) => {
            const captured = input as { key: string; by?: number }
            sqliteTextInput(organization, captured.key)
            const increment = snapshotStorageCounterIncrement(captured.by, SqliteNames.backend)
            const result = increment(
              sqliteRead(organization, 'text', captured.key, state.orgId, state, current) as
                | string
                | null
            )
            sqliteWrite(
              organization,
              'text',
              captured.key,
              String(result),
              state,
              'conflict',
              current
            )
            return result
          }
        )
    },
    use: (capability) => useTransactionCapability(scope, capability),
    get: (key) =>
      sqliteScoped(organization, scope, SqliteOperation.get, { key }, (state, current) => {
        sqliteTextInput(organization, key)
        return sqliteRead(organization, 'text', key, state.orgId, state, current) as string | null
      }),
    set: (key, value, options) =>
      sqliteScoped(
        organization,
        scope,
        SqliteOperation.set,
        { key, value, options },
        (state, current) => {
          sqliteTextInput(organization, key, value, true)
          sqliteWrite(
            organization,
            'text',
            key,
            value,
            state,
            readTransactionConflictPolicy(options, SqliteNames.backend),
            current
          )
        }
      ),
    remove: (key) =>
      sqliteScoped(organization, scope, SqliteOperation.remove, { key }, (state) => {
        sqliteTextInput(organization, key)
        sqliteRemove(organization, 'text', key, state)
      }),
    has: (key) =>
      sqliteScoped(organization, scope, SqliteOperation.has, { key }, (state, current) => {
        sqliteTextInput(organization, key)
        return sqliteRead(organization, 'text', key, state.orgId, state, current) !== null
      }),
    getBytes: (key) =>
      sqliteScoped(organization, scope, SqliteOperation.getBytes, { key }, (state, current) => {
        sqliteTextInput(organization, key)
        return sqliteRead(
          organization,
          'bytes',
          key,
          state.orgId,
          state,
          current
        ) as Uint8Array | null
      }),
    setBytes: (key, value, options) => {
      let bytes: Uint8Array
      return sqliteScoped(
        organization,
        scope,
        SqliteOperation.setBytes,
        () => {
          bytes = sqliteBytesInput(organization, key, value)
          return { key, value: bytes, options }
        },
        (state, current) =>
          sqliteWrite(
            organization,
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
      sqliteScoped(organization, scope, SqliteOperation.removeBytes, { key }, (state) => {
        sqliteTextInput(organization, key)
        sqliteRemove(organization, 'bytes', key, state)
      }),
    getRecord: (key) => {
      let captured: IStorageKey
      return sqliteScoped(
        organization,
        scope,
        SqliteOperation.getRecord,
        () => {
          captured = snapshotStorageKey(key, SqliteNames.backend)
          return { key: captured }
        },
        (state, current) =>
          sqliteRead(organization, 'record', captured, state.orgId, state, current) as
            | TValue
            | undefined
      )
    },
    putRecord: (value, key, options) => {
      let captured: IStorageKey | undefined
      return sqliteScoped(
        organization,
        scope,
        SqliteOperation.putRecord,
        () => {
          captured = key === undefined ? undefined : snapshotStorageKey(key, SqliteNames.backend)
          return { value, key: captured, options }
        },
        (state, current) => {
          const actual =
            captured ??
            String(
              sqliteStatement<TValue, ISqliteRow>(
                organization,
                SqliteControl.generatedKey,
                [],
                'get',
                state
              ).key
            )
          sqliteWrite(
            organization,
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
      return sqliteScoped(
        organization,
        scope,
        SqliteOperation.deleteRecord,
        () => {
          captured = snapshotStorageKey(key, SqliteNames.backend)
          return { key: captured }
        },
        (state) => {
          sqliteRemove(organization, 'record', captured, state)
        }
      )
    },
    getMany: (keys) => {
      let captured: readonly IStorageBatchKey[]
      let input: { keys: readonly IStorageKey[] }
      return sqliteScoped(
        organization,
        scope,
        SqliteOperation.getMany,
        () => {
          captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
          return (input = { keys: captured.map(({ key }) => key) })
        },
        (state, current, prepared) => {
          // Middleware has finished; this terminal consumes keys synchronously before returning.
          const actual = projectStorageBatchKeys(
            (prepared as typeof input).keys,
            SqliteNames.backend
          )
          return sqliteGetMany(organization, actual, state, current)
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
      return sqliteScoped(
        organization,
        scope,
        SqliteOperation.setMany,
        () => {
          captured = sqliteCaptureTextEntries(entries)
          return (input = {
            entries: captured.map(({ key, value, ttlMs }) => ({ key, value, ttlMs }))
          })
        },
        (state, current, prepared) => {
          const actual = sqliteProjectTextEntries((prepared as typeof input).entries)
          for (const entry of actual)
            sqliteWrite(
              organization,
              'text',
              entry.key,
              entry.value,
              state,
              'conflict',
              current,
              entry.ttlMs
            )
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
      return sqliteScoped(
        organization,
        scope,
        SqliteOperation.removeMany,
        () => {
          captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
          return (input = { keys: captured.map(({ key }) => key) })
        },
        (state, _current, prepared) => {
          // Scope admission is already held; no wait separates this projection from native SQL.
          const actual = projectStorageBatchKeys(
            (prepared as typeof input).keys,
            SqliteNames.backend
          )
          return sqliteRemoveTextBatch(organization, actual, state)
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
      return sqliteScoped(
        organization,
        scope,
        SqliteOperation.removeByPrefix,
        () => {
          captured = snapshotStorageKey(prefix, SqliteNames.backend)
          return { prefix: captured }
        },
        (state, _current, input) => {
          /** The outer snapshot protects pipeline waits; this native segment has no await. */
          const prefix = (input as { prefix: IStorageKey }).prefix
          assertStorageKey(prefix, SqliteNames.backend)
          return sqliteRemovePrefix(organization, 'text', prefix, state)
        },
        { count: undefined }
      )
    },
    iterateRecords: (range) => sqliteTransactionIterator(organization, scope, range),
    ...createSqliteExecutor(
      (prepare, ctx, run) =>
        sqliteScoped(organization, scope, SqliteOperation.sql, {}, (state, current) =>
          sqliteExecuteSql(organization, prepare, ctx, run, state, current)
        ),
      organization.statements
    )
  }
  /** Bind selected methods to this exact native view before the original owner admits it. */
  const api = organization.core.createTransactionApi(scope)
  if (api !== undefined) Object.defineProperty(scope, 'api', { value: api, enumerable: true })
  return scope
}
/** SQL statistics use the shared compile output and retain native result shape and error cause. */
function sqliteExecuteSql<TValue, R>(
  organization: ISqliteOrganizationContext<TValue>,
  prepare: () => ICompiledStorageSql,
  ctx: IOperationContext | undefined,
  run: (compiled: ICompiledStorageSql) => R,
  state?: INativeState,
  scope?: ISqliteTransactionScope<TValue>
): R {
  if (
    organization.shared !== undefined ||
    state?.journalBefore !== undefined ||
    (state === undefined && organization.core.journal?.active())
  )
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: SqliteNames.backend
    })
  /** Root SQL never joins another native attempt; scope SQL validates its original owner first. */
  if (scope) sqliteNativeFor(organization, scope)
  else sqliteAssertRoot(organization)
  assertOperationContext(ctx)
  const context = ctx
  throwIfAborted(context?.signal)
  const compiled = prepare()
  const observer = scope ? organization.sqlStages.forTransaction(scope) : organization.sqlStages
  const started = Date.now()
  sqliteObserve(organization, observer, 'beforeSql', compiled.values.length, compiled.text.length)
  try {
    const result = run(compiled)
    sqliteObserve(
      organization,
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
    sqliteObserve(organization, observer, 'onSqlError', (error as { code?: unknown })?.code)
    if (state?.mode === 'deferred' && sqliteIsBusy(organization, error))
      throw new SqlitePhysicalBusy(error)
    throw normalizeSqliteFailure(error)
  }
}
/** A transaction cursor owns buffered native rows while canonical scope admission owns activity. */
class SqliteTransactionCursor<TValue> {
  /** Fixed organization execution and codecs remain owned by their installed store. */
  readonly #organization: ISqliteOrganizationContext<TValue>
  /** Every next call is authorized against this cursor's original authentic scope. */
  readonly #scope: ISqliteTransactionScope<TValue>
  /** Revision observations stay on the native attempt that created this cursor. */
  readonly #state: INativeState
  /** The original range is admitted when the first native page is read. */
  readonly #range: IKeyRange | undefined
  /** One detached native snapshot is shared by subsequent admitted advances. */
  #rows: readonly ISqliteRow[] | undefined
  /** The next physical row may be skipped if it has expired. */
  #position = 0
  /** Observation counts only values actually returned to the caller. */
  #returnedCount = 0
  /** Authenticate at cursor creation without reading native rows eagerly. */
  constructor(
    organization: ISqliteOrganizationContext<TValue>,
    scope: ISqliteTransactionScope<TValue>,
    range: IKeyRange | undefined
  ) {
    this.#organization = organization
    this.#scope = scope
    this.#range = range
    this.#state = sqliteNativeFor(organization, scope)
  }
  /** Advance using the current short-lived operation view and the original snapshot position. */
  #advance(
    actual: INativeState,
    current: ISqliteTransactionScope<TValue>
  ): IteratorResult<[IStorageKey, TValue]> {
    if (this.#rows === undefined)
      this.#rows = sqliteRecordRows(this.#organization, actual.orgId, this.#range, actual)
    while (this.#position < this.#rows.length) {
      const row = this.#rows[this.#position++]!
      const key = decodeKey(row.key as Uint8Array)
      if (!sqliteLiveExpiration(this.#organization, 'record', key, row.expires_at, actual)) {
        sqlitePrune(this.#organization, 'record', key, actual)
        continue
      }
      sqliteRevision(this.#organization, this.#state, 'record', key)
      this.#returnedCount++
      return {
        done: false,
        value: [
          key,
          sqliteConvert(this.#organization, 'record', 'decode', row.value, current) as TValue
        ]
      }
    }
    return { done: true, value: undefined }
  }
  /** Release the detached buffer and report the original actual return count. */
  #close(): void {
    this.#rows = []
    sqliteObserve(
      this.#organization,
      this.#organization.operationStages,
      'onStorageIterationClose',
      this.#returnedCount
    )
  }
  /** Canonical iterator registration owns new operation views and close order. */
  open(): IStorageIterator<[IStorageKey, TValue]> {
    return this.#organization.transactionOwner.registerIterator<
      ISqliteTransactionScope<TValue>,
      [IStorageKey, TValue]
    >(this.#scope, {
      next: (current) =>
        sqliteScoped(
          this.#organization,
          current,
          SqliteOperation.next,
          { range: this.#range },
          (actual, currentScope) => this.#advance(actual, currentScope)
        ),
      close: () => this.#close()
    })
  }
}
/** Register one named cursor with the existing transaction owner. */
function sqliteTransactionIterator<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  scope: ISqliteTransactionScope<TValue>,
  range?: IKeyRange
): IStorageIterator<[IStorageKey, TValue]> {
  return new SqliteTransactionCursor(organization, scope, range).open()
}

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
function sqliteRollback<TValue>(
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
function sqliteLockRow<TValue>(
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
function sqliteHolderOf<TValue>(
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
function sqliteRangeConflict<TValue>(
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
function sqliteLockRanges<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  guard: IWriteGuard
) {
  return guard.channels.map((channel) => ({
    channel,
    ...snapshotConcurrencyLockRange({ channel, prefix: guard.prefix }, SqliteNames.backend)
  }))
}
/** Logical conflicts are visible before any attempt to acquire SQLite's physical writer lock. */
function sqliteConflictingLock<TValue>(
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
async function sqliteWalAttempt<TValue, R>(
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
async function sqliteNativeAttempt<TValue, R>(
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
async function sqlitePhysicalRun<TValue, R>(
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
function sqliteTransact<TValue, R>(
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
/** Clear enumerates only rows actually affected, for original revision and change ownership. */
function sqliteClear<TValue>(
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
function sqliteTextKeys<TValue>(
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
function sqliteSyncMutation<TValue, R>(
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
function sqliteIterator<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  range?: IKeyRange,
  ctx?: IOperationContext
): IStorageIterator<[IStorageKey, TValue]> {
  return new SqliteRecordCursor(organization, range, ctx).open()
}

/** Original observation remains report-only for thrown errors and rejected promises. */
function sqliteObserve<TValue>(
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
function sqliteTargetKey<TValue>(
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
function sqliteJournalChanges<TValue>(
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
async function sqliteMarker<TValue, R>(
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
/** Assemble the original base port table from explicit organization state. */
function createSqliteBase<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): ISqliteNativeStore<TValue> {
  return {
    backend: SqliteNames.backend,
    capabilities: {
      batch: true,
      syncRead: true,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    get: (key, ctx) => {
      sqliteTextInput(organization, key)
      return sqliteRootRead(
        organization,
        SqliteOperation.get,
        { key },
        ctx,
        (orgId, _input, observeKey, state) =>
          sqliteRead(organization, 'text', key, orgId, state, undefined, observeKey) as
            | string
            | null
      )
    },
    set: (key, value, ctx) => {
      sqliteTextInput(organization, key, value, true)
      return sqliteRootWrite(organization, SqliteOperation.set, { key, value }, ctx, (captured) => {
        sqliteTextInput(organization, captured.key, captured.value, true)
        return sqlitePrepareWrite(organization, 'text', captured.key, captured.value)
      })
    },
    remove: (key, ctx) => {
      sqliteTextInput(organization, key)
      return sqliteRootWrite(organization, SqliteOperation.remove, { key }, ctx, (captured) => {
        sqliteTextInput(organization, captured.key)
        return {
          keys: [lockKey.text(captured.key)],
          run: (state) => {
            sqliteRemove(organization, 'text', captured.key, state)
          }
        }
      })
    },
    has: (key, ctx) => {
      sqliteTextInput(organization, key)
      return sqliteRootRead(
        organization,
        SqliteOperation.has,
        { key },
        ctx,
        (orgId, _input, observeKey, state) =>
          sqliteRead(organization, 'text', key, orgId, state, undefined, observeKey) !== null
      )
    },
    keys: (ctx) =>
      sqliteRootRead(
        organization,
        SqliteOperation.keys,
        {},
        ctx,
        (orgId, _input, observeKey, state) => sqliteTextKeys(organization, orgId, observeKey, state)
      ),
    clearValues: (ctx) =>
      sqliteRootWrite(organization, SqliteOperation.clearValues, {}, ctx, () => ({
        keys: [],
        guard: { channels: ['text'] },
        run: (state) => sqliteClear(organization, ['text'], state)
      })),
    clearAll: (ctx) =>
      sqliteRootWrite(organization, SqliteOperation.clearAll, {}, ctx, () => ({
        keys: [],
        guard: { channels: ['text', 'bytes', 'record'] },
        run: (state) => sqliteClear(organization, ['text', 'bytes', 'record'], state)
      })),
    getBytes: (key, ctx) => {
      sqliteTextInput(organization, key)
      return sqliteRootRead(
        organization,
        SqliteOperation.getBytes,
        { key },
        ctx,
        (orgId, _input, observeKey, state) =>
          sqliteRead(
            organization,
            'bytes',
            key,
            orgId,
            state,
            undefined,
            observeKey
          ) as Uint8Array | null
      )
    },
    setBytes: (key, value, ctx) => {
      const bytes = sqliteBytesInput(organization, key, value)
      return sqliteRootWrite(
        organization,
        SqliteOperation.setBytes,
        { key, value: bytes },
        ctx,
        (captured) =>
          sqlitePrepareWrite(
            organization,
            'bytes',
            captured.key,
            sqliteBytesInput(organization, captured.key, captured.value)
          )
      )
    },
    removeBytes: (key, ctx) => {
      sqliteTextInput(organization, key)
      return sqliteRootWrite(
        organization,
        SqliteOperation.removeBytes,
        { key },
        ctx,
        (captured) => {
          sqliteTextInput(organization, captured.key)
          return {
            keys: [lockKey.bytes(captured.key)],
            run: (state) => {
              sqliteRemove(organization, 'bytes', captured.key, state)
            }
          }
        }
      )
    },
    clearBytes: (ctx) =>
      sqliteRootWrite(organization, SqliteOperation.clearBytes, {}, ctx, () => ({
        keys: [],
        guard: { channels: ['bytes'] },
        run: (state) => sqliteClear(organization, ['bytes'], state)
      })),
    getRecord: (key, ctx) => {
      /** Caller compound keys must remain stable while operation middleware and admission await. */
      const captured = snapshotStorageKey(key, SqliteNames.backend)
      return sqliteRootRead(
        organization,
        SqliteOperation.getRecord,
        { key: captured },
        ctx,
        (orgId, _input, observeKey, state) =>
          sqliteRead(organization, 'record', captured, orgId, state, undefined, observeKey) as
            | TValue
            | undefined
      )
    },
    putRecord: (value, key, ctx) => {
      /** Capture before middleware and physical admission can yield to caller mutations. */
      const captured = key === undefined ? undefined : snapshotStorageKey(key, SqliteNames.backend)
      return sqliteRootWrite(
        organization,
        SqliteOperation.putRecord,
        { value, key: captured },
        ctx,
        (input) => {
          /** Transformed input remains private while logical and physical admission can await. */
          const key =
            input.key === undefined ? undefined : snapshotStorageKey(input.key, SqliteNames.backend)
          if (key !== undefined) {
            const mutation = sqlitePrepareWrite(organization, 'record', key, input.value)
            return {
              ...mutation,
              run: (state) => {
                mutation.run(state)
                return key
              }
            }
          }
          const raw = sqliteConvert(organization, 'record', 'encode', input.value) as string
          return {
            keys: [],
            run: (state) => {
              const actual = String(
                sqliteStatement<TValue, ISqliteRow>(
                  organization,
                  SqliteControl.generatedKey,
                  [],
                  'get',
                  state
                ).key
              )
              sqliteWriteRaw(
                organization,
                'record',
                actual,
                raw,
                state,
                readTransactionConflictPolicy(state.context, SqliteNames.backend)
              )
              return actual
            }
          }
        }
      )
    },
    deleteRecord: (key, ctx) => {
      /** Caller compound keys must remain stable while operation middleware and admission await. */
      const captured = snapshotStorageKey(key, SqliteNames.backend)
      return sqliteRootWrite(
        organization,
        SqliteOperation.deleteRecord,
        { key: captured },
        ctx,
        (input) => {
          /** The prepared key survives the asynchronous physical admission below. */
          const key = snapshotStorageKey(input.key, SqliteNames.backend)
          return {
            keys: [lockKey.record(key)],
            run: (state) => {
              sqliteRemove(organization, 'record', key, state)
            }
          }
        }
      )
    },
    clearRecords: (ctx) =>
      sqliteRootWrite(organization, SqliteOperation.clearRecords, {}, ctx, () => ({
        keys: [],
        guard: { channels: ['record'] },
        run: (state) => sqliteClear(organization, ['record'], state)
      })),
    iterateRecords: (range, ctx) => sqliteIterator(organization, range, ctx),
    transaction: (run, options) => sqliteTransact(organization, run, options),
    tx: () =>
      createTransactionBuilder(
        organization.store,
        undefined,
        organization.core.getChainMethods('tx')
      ),
    ...(organization.core.journal === undefined
      ? {}
      : {
          undo: async (txId: string, ctx?: IOperationContext) => {
            organization.controller.assertLive()
            const release = organization.controller.beginMutation()
            let selected: IStorageJournalExecutionPort | undefined
            return runWithConcurrency<{ readonly txId: string }>(
              {
                store: organization.store,
                options: ctx === undefined ? {} : ctx,
                prepare: (context) => {
                  selected = sqliteJournalFor(organization, context)
                  return selected!.prepare()
                }
              },
              {
                attempt: async (context) => ({
                  status: 'committed',
                  value: await selected!.undo(txId, (keys, work) =>
                    createTransactionBuilder(
                      organization.store,
                      context,
                      organization.core.getChainMethods('tx')
                    )
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
        sqliteTextInput(organization, key)
        return sqliteRootRead(organization, SqliteOperation.metadataGet, { key }, ctx, (orgId) =>
          sqliteRead(organization, 'metadata', key, orgId)
        )
      },
      set: (key, value, ctx) => {
        sqliteTextInput(organization, key)
        return sqliteRootRead(
          organization,
          SqliteOperation.metadataSet,
          { key, value },
          ctx,
          (orgId) =>
            sqliteSyncMutation(
              organization,
              (state) => sqliteWrite(organization, 'metadata', key, value, state, 'replace'),
              [sqliteRevisionKey(organization, 'metadata', key)],
              undefined,
              orgId
            )
        )
      },
      delete: (key, ctx) => {
        sqliteTextInput(organization, key)
        return sqliteRootRead(organization, SqliteOperation.metadataDelete, { key }, ctx, (orgId) =>
          sqliteSyncMutation(
            organization,
            (state) => {
              sqliteRemove(organization, 'metadata', key, state)
            },
            [sqliteRevisionKey(organization, 'metadata', key)],
            undefined,
            orgId
          )
        )
      }
    },
    sync: {
      get: (key) =>
        sqliteSynchronous(organization, SqliteOperation.get, { key }, () => {
          sqliteTextInput(organization, key)
          return sqliteRead(organization, 'text', key, organization.runtime.orgId) as string | null
        }),
      set: (key, value, options) =>
        sqliteSynchronous(organization, SqliteOperation.set, { key, value, options }, () => {
          sqliteTextInput(organization, key, value, true)
          assertSyncWriteOptions(options)
          const policy = options?.conflictPolicy ?? 'conflict'
          sqliteSyncMutation(
            organization,
            (state) => sqliteWrite(organization, 'text', key, value, state, policy),
            [lockKey.text(key), lockKey.bytes(key), lockKey.record(key)]
          )
        }),
      remove: (key) =>
        sqliteSynchronous(organization, SqliteOperation.remove, { key }, () => {
          sqliteTextInput(organization, key)
          sqliteSyncMutation(
            organization,
            (state) => sqliteRemove(organization, 'text', key, state),
            [lockKey.text(key)]
          )
        }),
      has: (key) =>
        sqliteSynchronous(organization, SqliteOperation.has, { key }, () => {
          sqliteTextInput(organization, key)
          return sqliteRead(organization, 'text', key, organization.runtime.orgId) !== null
        }),
      keys: () =>
        sqliteSynchronous(organization, SqliteOperation.keys, {}, () =>
          sqliteTextKeys(organization, organization.runtime.orgId)
        ),
      clearValues: () =>
        sqliteSynchronous(organization, SqliteOperation.clearValues, {}, () =>
          sqliteSyncMutation(
            organization,
            (state) => sqliteClear(organization, ['text'], state),
            [],
            { channels: ['text'] }
          )
        )
    },
    ...createSqliteExecutor(
      (prepare, ctx, run) =>
        sqliteRootRead(organization, SqliteOperation.sql, {}, ctx, () =>
          sqliteExecuteSql(organization, prepare, undefined, run)
        ),
      organization.statements
    ),
    inspectLocks: (ctx) => {
      organization.controller.assertLive()
      const finish = organization.controller.beginMutation()
      return withAbort(ctx, async (signal, context) =>
        organization.core.execution.run(
          { operation: 'inspectLocks', input: {}, ctx: context },
          async () => {
            throwIfAborted(signal)
            const orgId = sqliteOperationOrg(organization, context)
            sqliteObserve(organization, organization.concurrencyStages, 'beforeLockInspect')
            try {
              const inspect = () => {
                if (!organization.wal)
                  return sqliteLocalGroup(organization, orgId).locks.inspectLocks()
                const rows = sqliteStatement<TValue, readonly ISqliteRow[]>(
                  organization,
                  `SELECT key,owner,label,pid,since,expires_at FROM ${organization.tables.locks} WHERE org_id=?`,
                  [orgId],
                  'all'
                )
                return snapshotConcurrencyLockHoldings(
                  rows.map((row) => {
                    const id = row.key as string
                    return {
                      key: sqliteDecodeLockIdentity(organization, id),
                      holder: sqliteHolderOf(organization, row),
                      expired: Number(row.expires_at) <= Date.now(),
                      expiresAt: Number(row.expires_at)
                    }
                  })
                )
              }
              const rows = inspect()
              sqliteObserve(
                organization,
                organization.concurrencyStages,
                'afterLockInspect',
                rows.length
              )
              return rows
            } catch (error) {
              sqliteObserve(
                organization,
                organization.concurrencyStages,
                'onLockInspectError',
                (error as { code?: unknown })?.code
              )
              throw error
            }
          }
        )
      ).finally(finish)
    },
    dispose: () => organization.controller.dispose(),
    [asyncDisposeKey]: () =>
      (organization.symbolic ??= organization.controller
        .dispose()
        .catch((error) => reportCleanupError(organization.report, error)))
  }
}
/** Assemble the original keyValue port table from explicit organization state. */
function createSqliteKeyValue<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  base: ISqliteNativeStore<TValue>
): IKeyValueApi {
  return {
    get: base.get,
    set: base.set,
    remove: base.remove,
    has: base.has,
    keys: base.keys,
    clearValues: base.clearValues,
    clearAll: base.clearAll,
    sync: base.sync,
    getMany: async (keys, ctx) => {
      const count = sqliteBatchSize(organization, keys)
      if (count === 0) {
        assertOperationContext(ctx)
        throwIfAborted(ctx?.signal)
        return []
      }
      /** Capture caller keys before stages; terminal capture includes supported in-place rewrites. */
      const captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
      const input = { keys: captured.map(({ key }) => key) }
      return sqliteRootRead(
        organization,
        SqliteOperation.getMany,
        input,
        ctx,
        (orgId, prepared, observeKey, state) => {
          const actual = snapshotStorageBatchKeys(
            (prepared as typeof input).keys,
            SqliteNames.backend
          )
          for (const [index, { key, firstIndex }] of actual.entries())
            if (firstIndex === index) observeKey?.(lockKey.text(key))
          return state === undefined
            ? sqliteReadSnapshot(organization, orgId, (current) =>
                sqliteGetMany(organization, actual, current)
              )
            : sqliteGetMany(organization, actual, state)
        },
        { count }
      )
    },
    setMany: async (entries, ctx) => {
      const count = sqliteBatchSize(organization, entries)
      if (count === 0) {
        assertOperationContext(ctx)
        throwIfAborted(ctx?.signal)
        return
      }
      /** Every duplicate, value and TTL failure precedes the first pipeline or native request. */
      const captured = sqliteCaptureTextEntries(entries)
      const input = { entries: captured.map(({ key, value, ttlMs }) => ({ key, value, ttlMs })) }
      return sqliteRootWrite(
        organization,
        SqliteOperation.setMany,
        input,
        ctx,
        (prepared) => {
          const actual = sqliteCaptureTextEntries(prepared.entries)
          /** Codec success precedes locks and table changes, matching ordinary root replacement. */
          const raw = actual.map((entry) => ({
            ...entry,
            value: sqliteConvert(organization, 'text', 'encode', entry.value) as string
          }))
          return {
            keys: actual.flatMap(({ key }) =>
              typeof key === 'string'
                ? [lockKey.text(key), lockKey.bytes(key), lockKey.record(key)]
                : [lockKey.text(key), lockKey.record(key)]
            ),
            run: (state) => {
              for (const entry of raw)
                sqliteWriteRaw(
                  organization,
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
      const count = sqliteBatchSize(organization, keys)
      if (count === 0) {
        assertOperationContext(ctx)
        throwIfAborted(ctx?.signal)
        return 0
      }
      /** Repeated structural keys share first-position facts and affect one physical row. */
      const captured = snapshotStorageBatchKeys(keys, SqliteNames.backend)
      const input = { keys: captured.map(({ key }) => key) }
      return sqliteRootWrite(
        organization,
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
              return sqliteRemoveTextBatch(organization, actual, state)
            }
          }
        },
        { count }
      )
    },
    removeByPrefix: async (prefix, ctx) => {
      organization.controller.assertLive()
      /** The original prefix owner fixes the caller snapshot before asynchronous middleware. */
      /** Caller prefix survives middleware before a prepared mutation acquires physical admission. */
      const captured = snapshotStorageKey(prefix, SqliteNames.backend)
      return sqliteRootWrite(
        organization,
        SqliteOperation.removeByPrefix,
        { prefix: captured },
        ctx,
        (input) => {
          /**
           * Middleware can replace the prefix; physical admission can still await after
           * preparation.
           */
          const actual = snapshotStorageKey(input.prefix, SqliteNames.backend)
          return {
            keys: [],
            guard: { channels: ['text'], prefix: actual },
            run: (state) => sqliteRemovePrefix(organization, 'text', actual, state)
          }
        },
        { count: undefined }
      )
    }
  }
}
/** Assemble the original recordApi port table from explicit organization state. */
function createSqliteRecordApi<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): IRecordsApi<TValue> {
  return {
    query: <R = TValue>() =>
      createRecordQuery<R>(
        {
          asyncDisposeKey,
          pushdown: {
            operators: [],
            operations: [],
            source: SqliteNames.backend,
            index: `${organization.table}_${SqliteNames.record}`
          },
          execute: ({ ctx }) => sqliteIterator(organization, undefined, ctx)
        },
        organization.core.getChainMethods('query')
      ),
    removeByPrefix: (prefix, ctx) => {
      /** Caller prefix survives middleware before a prepared mutation acquires physical admission. */
      const captured = snapshotStorageKey(prefix, SqliteNames.backend)
      return sqliteRootWrite(
        organization,
        SqliteOperation.removeByPrefix,
        { prefix: captured },
        ctx,
        (input) => {
          /** This transformed prefix survives the later asynchronous physical admission. */
          const prefix = snapshotStorageKey(input.prefix, SqliteNames.backend)
          return {
            keys: [],
            guard: { channels: ['record'], prefix },
            run: (state) => sqliteRemovePrefix(organization, 'record', prefix, state)
          }
        }
      )
    }
  }
}
/** Assemble the original timeToLive port table from explicit organization state. */
function createSqliteTtlApi<TValue>(organization: ISqliteOrganizationContext<TValue>): ITtlApi {
  return {
    expire: async (target, ms, ctx) => {
      organization.controller.assertLive()
      const captured = sqliteCaptureTtlTarget(target)
      assertStorageTtlDuration(ms, SqliteNames.backend)
      return sqliteRootWrite(
        organization,
        SqliteOperation.ttlExpire,
        { target: captured, ms },
        ctx,
        (input) => {
          const target = sqliteCaptureTtlTarget(input.target)
          assertStorageTtlDuration(input.ms, SqliteNames.backend)
          return {
            keys: [target],
            run: (state) => sqliteChangeDeadline(organization, target, state, input.ms)
          }
        }
      )
    },
    remaining: async (target, ctx) => {
      organization.controller.assertLive()
      const captured = sqliteCaptureTtlTarget(target)
      return sqliteRootRead(
        organization,
        SqliteOperation.ttlRemaining,
        captured,
        ctx,
        (orgId, input, observeKey, state) => {
          /** Read admission and middleware have settled; this native lookup has no await. */
          const target = input as ITtlTarget
          sqliteAssertTtlTarget(target)
          observeKey?.(target)
          const row = sqliteExpiration(organization, target, orgId, state)
          return row?.expires_at == null
            ? undefined
            : Math.max(0, Number(row.expires_at) - Date.now())
        }
      )
    },
    persist: async (target, ctx) => {
      organization.controller.assertLive()
      const captured = sqliteCaptureTtlTarget(target)
      return sqliteRootWrite(organization, SqliteOperation.ttlPersist, captured, ctx, (input) => {
        const target = sqliteCaptureTtlTarget(input)
        return { keys: [target], run: (state) => sqliteChangeDeadline(organization, target, state) }
      })
    }
  }
}
/** Assemble the original counters port table from explicit organization state. */
function createSqliteCounterApi<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): ICounterApi {
  return {
    increment: async (key, by, ctx) => {
      organization.controller.assertLive()
      sqliteTextInput(organization, key)
      snapshotStorageCounterIncrement(by, SqliteNames.backend)
      return sqliteRootWrite(
        organization,
        SqliteOperation.counterIncrement,
        { key, by },
        ctx,
        (input) => {
          sqliteTextInput(organization, input.key)
          const increment = snapshotStorageCounterIncrement(input.by, SqliteNames.backend)
          return {
            keys: [lockKey.text(input.key), lockKey.bytes(input.key), lockKey.record(input.key)],
            run: (state) => {
              const result = increment(
                sqliteRead(organization, 'text', input.key, state.orgId, state) as string | null
              )
              sqliteWrite(organization, 'text', input.key, String(result), state, 'conflict')
              return result
            }
          }
        }
      )
    }
  }
}
/** One fixed namespace holds its native interval and the original memory-index generation. */
type ISqliteNamespaceContext<TValue> = {
  readonly organization: ISqliteOrganizationContext<TValue>
  readonly prefix: string
  readonly lower: string
  readonly upper: string
  readonly openedGeneration: object
  readonly exclusive: boolean
}
/** Encode one validated private journal key with the canonical key owner. */
function sqliteNamespaceKey<TValue>(
  namespace: ISqliteNamespaceContext<TValue>,
  input: unknown
): string {
  if (typeof input !== 'string')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  return keyHex(encodeOrderedStorageKey([namespace.prefix, input], SqliteNames.backend))
}
/** One native view retains its authentic scope and fixed namespace without shared lexical state. */
class SqliteJournalNamespaceView<TValue> implements IStorageJournalNamespaceView {
  /** Native interval and original resource validity belong to the namespace context. */
  readonly #namespace: ISqliteNamespaceContext<TValue>
  /** All I/O authenticates this original transaction scope at the existing owner. */
  readonly #scope: Omit<ITransactionScope, 'use'>
  /** Bind one private view without opening another transaction or resource owner. */
  constructor(namespace: ISqliteNamespaceContext<TValue>, scope: Omit<ITransactionScope, 'use'>) {
    this.#namespace = namespace
    this.#scope = scope
  }
  /** Admit one private native operation through the original transaction scope. */
  #execute<R>(invoke: (state: INativeState) => R): Promise<Awaited<R>> {
    return runTransactionOperation(this.#scope, () =>
      invoke(sqliteJournalScope(this.#namespace.organization, this.#scope).state)
    )
  }
  /** Clear only this namespace's original ordered key interval. */
  #clear() {
    return this.#execute((state) => {
      sqliteStatement(
        this.#namespace.organization,
        'DELETE FROM ' +
          this.#namespace.organization.tables.journal +
          ' WHERE org_id=? AND key>=? AND key<?',
        [state.orgId, this.#namespace.lower, this.#namespace.upper],
        'run',
        state
      )
    })
  }
  /** Native get retains the existing codec, scope admission and row semantics. */
  readonly get: IStorageJournalNamespaceView['get'] = (key: string) =>
    this.#execute((state) => {
      const row = sqliteStatement<TValue, ISqliteRow | undefined>(
        this.#namespace.organization,
        'SELECT value FROM ' +
          this.#namespace.organization.tables.journal +
          ' WHERE org_id=? AND key=?',
        [state.orgId, this.#key(key)],
        'get',
        state
      )
      if (row === undefined) return null
      try {
        const value = this.#namespace.organization.textCodec.decode(row.value as string)
        if (typeof value !== 'string') throw sqliteError(SqliteErrorCode.decodeFailed)
        return value
      } catch (cause) {
        throw sqliteError(SqliteErrorCode.decodeFailed, cause)
      }
    })
  /** Native has retains the existing codec, scope admission and row semantics. */
  readonly has: IStorageJournalNamespaceView['has'] = (key: string) =>
    this.#execute(
      (state) =>
        sqliteStatement<TValue, ISqliteRow | undefined>(
          this.#namespace.organization,
          'SELECT key FROM ' +
            this.#namespace.organization.tables.journal +
            ' WHERE org_id=? AND key=?',
          [state.orgId, this.#key(key)],
          'get',
          state
        ) !== undefined
    )
  /** Native set retains the existing codec, scope admission and row semantics. */
  readonly set: IStorageJournalNamespaceView['set'] = (key: string, value: string) =>
    this.#execute((state) => {
      if (typeof value !== 'string')
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      sqliteStatement(
        this.#namespace.organization,
        'INSERT INTO ' +
          this.#namespace.organization.tables.journal +
          '(org_id,key,value) VALUES(?,?,?) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value',
        [state.orgId, this.#key(key), this.#namespace.organization.textCodec.encode(value)],
        'run',
        state
      )
    })
  /** Native remove retains the existing codec, scope admission and row semantics. */
  readonly remove: IStorageJournalNamespaceView['remove'] = (key: string) =>
    this.#execute((state) => {
      sqliteStatement(
        this.#namespace.organization,
        'DELETE FROM ' + this.#namespace.organization.tables.journal + ' WHERE org_id=? AND key=?',
        [state.orgId, this.#key(key)],
        'run',
        state
      )
    })
  /** Native keys retains the existing codec, scope admission and row semantics. */
  readonly keys: IStorageJournalNamespaceView['keys'] = () =>
    this.#execute((state) =>
      sqliteStatement<TValue, readonly ISqliteRow[]>(
        this.#namespace.organization,
        'SELECT key FROM ' +
          this.#namespace.organization.tables.journal +
          ' WHERE org_id=? AND key>=? AND key<? ORDER BY key',
        [state.orgId, this.#namespace.lower, this.#namespace.upper],
        'all',
        state
      ).map((row) => {
        const key = decodeHexKey(row.key as string)
        if (
          !Array.isArray(key) ||
          key.length !== 2 ||
          key[0] !== this.#namespace.prefix ||
          typeof key[1] !== 'string'
        )
          throw sqliteError(SqliteErrorCode.decodeFailed)
        return key[1]
      })
    )
  /** Both clear ports retain the original same native callback. */
  readonly clearValues: IStorageJournalNamespaceView['clearValues'] = () => this.#clear()
  /** Keep the original clear callback identity. */
  readonly clearAll = this.clearValues
  /** Bound key encoding never reads mutable native or host state. */
  #key(input: unknown): string {
    return sqliteNamespaceKey(this.#namespace, input)
  }
}
/** Project only the original native terminal sets and authentic short-lived view. */
function sqliteNamespaceProject<TValue>(
  namespace: ISqliteNamespaceContext<TValue>,
  scope: Omit<ITransactionScope, 'use'>
): IBackendJournalTransaction {
  const terminal = sqliteJournalScope(namespace.organization, scope).terminal
  const listen = (effects: Set<() => void>, effect: () => void) => {
    effects.add(effect)
    return () => {
      effects.delete(effect)
    }
  }
  return {
    run: (work) => work(new SqliteJournalNamespaceView(namespace, scope)),
    onCommit: (effect) => listen(terminal.committed, effect),
    onRollback: (effect) => listen(terminal.rolledBack, effect),
    onEnd: (effect) => listen(terminal.ended, effect)
  }
}
/** Open one native namespace through the existing canonical journal resource owner. */
async function sqliteOpenJournalNamespace<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  prefix: string
): Promise<import('@migaia/storage-host').IStorageJournalNamespace> {
  organization.controller.assertLive()
  if (typeof prefix !== 'string' || prefix.length === 0)
    throw new StorageContractError(StorageContractErrorCode.invalidArgument)
  const bounds = snapshotStorageKeyPrefix([prefix], SqliteNames.backend)
  const namespace: ISqliteNamespaceContext<TValue> = {
    organization,
    prefix,
    lower: keyHex(bounds.lower),
    upper: keyHex(bounds.upper),
    openedGeneration: organization.journalGeneration.value,
    exclusive: !organization.wal && typeof organization.physical !== 'string'
  }
  return createBackendJournalNamespace({
    assertLive: () => {
      organization.controller.assertLive()
      if (
        !organization.wal &&
        typeof organization.physical !== 'string' &&
        namespace.openedGeneration !== organization.journalGeneration.value
      )
        throw new StorageContractError(StorageContractErrorCode.disposed, {
          backend: SqliteNames.backend
        })
    },
    closingSignal: organization.controller.closingSignal,
    report: (error) => reportCleanupError(organization.report, error),
    /** Only this caller-owned memory connection has reliable lifetime exclusivity. */
    nativeAtomic: true,
    ...(namespace.exclusive ? {} : { indexExclusive: false as const }),
    backend: SqliteNames.backend,
    reserve: (hold) =>
      !namespace.exclusive
        ? hold()
        : runWithConcurrency(
            {
              store: organization.store,
              options: { lock: [lockKey.record([SqliteNames.journalOwner, namespace.prefix])] },
              policy: ConcurrencyPolicy.fail()
            },
            {
              attempt: (context) =>
                sqliteLocalGroup(organization, organization.runtime.orgId).locks.attemptMetadata(
                  context,
                  {
                    owner: organization.controller.origin,
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
                  organization.concurrencyStages,
                  organization.controller.closingSignal
                )
            }
          ),
    authenticate: (scope) => ({
      info: sqliteJournalScope(organization, scope).info,
      port: sqliteNamespaceProject(namespace, scope)
    }),
    transaction: (work) =>
      sqliteTransact(
        organization,
        (scope) => work(sqliteNamespaceProject(namespace, scope)),
        {},
        false
      )
  })
}
/** Private journal I/O borrows original organization scopes and native rows. */
function createSqliteJournal<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): Omit<IStorageJournalBackendBinding, 'forOrg'> {
  return {
    externalWal: true,
    lockTarget: (target) => {
      const { channel, key } = sqliteTargetKey(organization, target)
      return sqliteRevisionKey(organization, channel, key)
    },
    changes: (scope) =>
      sqliteJournalChanges(organization, sqliteJournalScope(organization, scope).state),
    readImage: (scope, target) =>
      runTransactionOperation(scope, () => {
        const state = sqliteJournalScope(organization, scope).state
        const { channel, key } = sqliteTargetKey(organization, target)
        return Promise.resolve(sqliteJournalImage(organization, state, channel, key))
      }),
    readRevision: (scope, target) =>
      runTransactionOperation(scope, () => {
        const state = sqliteJournalScope(organization, scope).state
        const { channel, key } = sqliteTargetKey(organization, target)
        sqliteRevision(organization, state, channel, key)
        const current = sqliteCurrentRevision(
          organization,
          state,
          channel,
          sqliteRevisionIdentity(organization, channel, key)
        )
        return Promise.resolve({ birth: current.birth ?? null, version: current.version })
      }),
    writeImage: (scope, target, image) =>
      runTransactionOperation(scope, () => {
        const state = sqliteJournalScope(organization, scope).state
        const { channel, key } = sqliteTargetKey(organization, target)
        sqliteRevision(organization, state, channel, key)
        if (!image.present) {
          sqliteRemove(organization, channel, key, state)
          return Promise.resolve()
        }
        const payload = organization.recordCodec.decode(image.value)
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
        sqliteStatement(
          organization,
          'INSERT INTO ' +
            organization.tables[channel] +
            '(org_id,key,value' +
            (channel === 'metadata' ? '' : ',expires_at') +
            ') VALUES(?,?,?' +
            (channel === 'metadata' ? '' : ',?') +
            ') ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value' +
            (channel === 'metadata' ? '' : ',expires_at=excluded.expires_at'),
          [
            state.orgId,
            sqliteEncoded(organization, channel, key),
            channel === 'bytes' ? base64ToBytes(value) : value,
            ...(channel === 'metadata' ? [] : [deadline as ISqliteValue])
          ],
          'run',
          state
        )
        sqliteChanged(organization, state, channel, key)
        return Promise.resolve()
      }),
    writeCommitMarker: (scope, txId) =>
      runTransactionOperation(scope, () => {
        const current = sqliteJournalScope(organization, scope)
        if (current.info.id !== txId)
          throw new StorageContractError(StorageContractErrorCode.invalidArgument)
        sqliteStatement(
          organization,
          'INSERT INTO ' +
            organization.tables.markers +
            '(org_id,key) VALUES(?,?) ON CONFLICT(org_id,key) DO NOTHING',
          [current.state.orgId, txId],
          'run',
          current.state
        )
        return Promise.resolve()
      }),
    hasCommitMarker: (txId) =>
      sqliteMarker(
        organization,
        txId,
        (state) =>
          sqliteStatement<TValue, ISqliteRow | undefined>(
            organization,
            'SELECT key FROM ' + organization.tables.markers + ' WHERE org_id=? AND key=?',
            [state.orgId, txId],
            'get',
            state
          ) !== undefined
      ),
    removeCommitMarker: (txId) =>
      sqliteMarker(organization, txId, (state) => {
        sqliteStatement(
          organization,
          'DELETE FROM ' + organization.tables.markers + ' WHERE org_id=? AND key=?',
          [state.orgId, txId],
          'run',
          state
        )
      }),
    openNamespace: async (prefix) => sqliteOpenJournalNamespace(organization, prefix)
  }
}
/** Release only this organization references after the original controller drains. */
async function disposeSqliteOrganization<TValue>(
  organization: ISqliteOrganizationContext<TValue>
): Promise<void> {
  if (organization.shared === undefined) await organization.physicalAdmission.dispose()
  for (const dispose of organization.snapshots) await dispose()
  organization.statements.clear()
  if (organization.shared === undefined) claimedDrivers.delete(organization.driver)
  if (organization.group && --organization.group.references === 0) {
    physicalGroups.get(organization.physical)?.delete(organization.groupId)
    if (physicalGroups.get(organization.physical)?.size === 0)
      physicalGroups.delete(organization.physical)
    await organization.group.locks.dispose()
  }
}
/** Native layout probing mutates only installation facts before the organization is published. */
type ISqlitePhysicalLayout = Pick<
  ISqliteOrganizationContext<unknown>,
  | 'driver'
  | 'statements'
  | 'tables'
  | 'table'
  | 'shared'
  | 'core'
  | 'groupId'
  | 'physical'
  | 'wal'
  | 'group'
> & { readonly requestedWal: boolean | undefined }
/**
 * Probe actual physical identity and WAL, initialize fixed tables, then join the original local
 * group.
 */
function initializeSqliteLayout(layout: ISqlitePhysicalLayout): void {
  try {
    if (layout.shared === undefined) {
      /** PRAGMA database_list returns an empty main filename for an in-memory connection. */
      const main = layout.statements
        .get(SqliteControl.databases)
        .all()
        .find((row) => row.name === 'main')
      if (typeof main?.file === 'string' && main.file !== '') layout.physical = main.file
      layout.wal = layout.requestedWal ?? typeof layout.physical === 'string'
      /** OFF cannot support the package's rollback guarantee, even when WAL was disabled explicitly. */
      const current = layout.statements.get(SqliteControl.journal).get()
      if (String(current?.journal_mode).toLowerCase() === 'off')
        throw new Error(SqliteErrorText.walUnavailable)
      if (layout.wal) {
        const actual = layout.statements.get(SqliteControl.wal).get()
        if (String(actual?.journal_mode).toLowerCase() !== 'wal')
          throw new Error(SqliteErrorText.walUnavailable)
      }
      layout.driver.exec(SqliteControl.busy)
      for (const channel of [
        SqliteNames.text,
        SqliteNames.bytes,
        'record',
        SqliteNames.metadata
      ] as const) {
        /** Metadata is isolated from public-channel expiry and conflict checks. */
        const metadata = channel === SqliteNames.metadata
        layout.driver.exec(
          `CREATE TABLE IF NOT EXISTS ${layout.tables[channel]}(org_id TEXT NOT NULL,key ${channel === 'record' ? 'BLOB' : 'TEXT'} NOT NULL,value ${channel === SqliteNames.bytes ? 'BLOB' : 'TEXT'} NOT NULL${metadata ? '' : ',expires_at INTEGER'},PRIMARY KEY(org_id,key))`
        )
        if (!metadata)
          layout.driver.exec(
            `CREATE INDEX IF NOT EXISTS ${quoteSqliteIdentifier(`${layout.table}_${channel}_expiry`)} ON ${layout.tables[channel]}(org_id,expires_at,key)`
          )
      }
      layout.driver.exec(
        `CREATE TABLE IF NOT EXISTS ${layout.tables.journal}(org_id TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(org_id,key));CREATE TABLE IF NOT EXISTS ${layout.tables.markers}(org_id TEXT NOT NULL,key TEXT NOT NULL,PRIMARY KEY(org_id,key))`
      )
      if (layout.wal)
        layout.driver.exec(
          `CREATE TABLE IF NOT EXISTS ${layout.tables.locks}(org_id TEXT NOT NULL,key TEXT NOT NULL,owner TEXT NOT NULL,attempt_token TEXT NOT NULL,label TEXT,pid INTEGER,since INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(org_id,key));CREATE TABLE IF NOT EXISTS ${layout.tables.revisions}(org_id TEXT NOT NULL,key TEXT NOT NULL,revision INTEGER NOT NULL,birth TEXT NOT NULL DEFAULT(lower(hex(randomblob(16)))),PRIMARY KEY(org_id,key))`
        )
    }
    if (layout.shared === undefined && layout.wal) {
      /** The private row gains immutable native identity without changing prior user values. */
      const columns = layout.driver
        .prepare('PRAGMA table_info(' + layout.tables.revisions + ')')
        .all()
      if (!columns.some((column) => column.name === 'birth')) {
        layout.driver.exec(
          'ALTER TABLE ' + layout.tables.revisions + " ADD COLUMN birth TEXT NOT NULL DEFAULT ''"
        )
        layout.driver.exec(
          'UPDATE ' +
            layout.tables.revisions +
            " SET birth=lower(hex(randomblob(16))) WHERE birth=''"
        )
      }
    }
    if (!layout.wal) {
      /** Different handles to one file share logical locks; memory connections stay independent. */
      let groups = physicalGroups.get(layout.physical)
      if (!groups) {
        groups = new Map()
        physicalGroups.set(layout.physical, groups)
      }
      layout.group = groups.get(layout.groupId)
      if (!layout.group) {
        layout.group = {
          locks: layout.core.createKeyLockPort(),
          revisions: layout.core.createRevisionPort(),
          birth: crypto.randomUUID(),
          references: 0
        }
        groups.set(layout.groupId, layout.group)
      }
      layout.group.references++
    }
  } catch (cause) {
    layout.statements.clear()
    if (layout.shared === undefined) claimedDrivers.delete(layout.driver)
    throw normalizeSqliteFailure(cause)
  }
}
/** Capture deployment metadata and initialize the original native physical layout once. */
function createSqliteContext<TValue>(
  input: ISqliteOptions,
  runtime: ISqliteRuntime,
  shared?: ISqlitePhysicalState
): ISqliteOrganizationContext<TValue> {
  const {
    driver,
    table = SqliteNames.table,
    concurrency,
    owner,
    maxLockMs = SqliteLimits.maxLockMs,
    wal: requestedWal
  } = input
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
  const { core } = runtime
  const journalGeneration = runtime.journalGeneration ?? { value: {} }
  const scheduler = core.featureExpose.getScheduler()
  const report = createStorageOperationReporter()
  const statements = createSqliteStatements(driver)
  const client: ISqliteDriver = shared?.client ?? {
    exec: (text: string) => driver.exec(text),
    prepare: (text: string) => driver.prepare(text)
  }
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
  const channelRanges = (['text', 'bytes', 'record'] as const).map((channel) => ({
    channel,
    ...snapshotConcurrencyLockRange({ channel }, SqliteNames.backend)
  }))

  const groupId = JSON.stringify([table, runtime.orgId])
  const layout: ISqlitePhysicalLayout = {
    driver,
    statements,
    tables,
    table,
    requestedWal,
    shared,
    core,
    groupId,
    physical: shared?.physical ?? driver,
    wal: shared?.wal ?? false,
    group: undefined
  }

  initializeSqliteLayout(layout)
  const { physical, wal, group } = layout
  const physicalState: ISqlitePhysicalState = shared ?? {
    admission: createConcurrencyLimiter({ concurrency: 1 }),
    client,
    physical,
    wal,
    active: undefined
  }
  const physicalAdmission = physicalState.admission
  const snapshots = new Set<() => Promise<void>>()
  const organization: ISqliteOrganizationContext<TValue> = {
    driver: driver,
    table: table,
    concurrency: concurrency,
    maxLockMs: maxLockMs,
    label: label,
    core: core,
    journalGeneration: journalGeneration,
    scheduler: scheduler,
    report: report,
    statements: statements,
    client: client,
    tables: tables,
    channelRanges: channelRanges,
    physical: physical,
    wal: wal,
    group: group,
    groupId: groupId,
    physicalState: physicalState,
    physicalAdmission: physicalAdmission,
    snapshots: snapshots,
    controller: undefined!,
    textCodec: undefined!,
    recordCodec: undefined!,
    store: undefined!,
    installer: undefined!,
    transactionOwner: undefined!,
    stages: undefined!,
    operationStages: undefined!,
    sqlStages: undefined!,
    codecStages: undefined!,
    concurrencyStages: undefined!,
    transactionStages: undefined!,
    symbolic: undefined,
    expectedToken: undefined,
    runtime: runtime,
    shared: shared
  }
  organization.controller = core.createChangeController(
    {
      backend: SqliteNames.backend,
      platform: driver,
      options: input,
      finalize: () => disposeSqliteOrganization(organization)
    },
    createBackendChangeController
  )
  organization.textCodec = defineJsonCodec({ version: 1 })
  organization.recordCodec = defineCollectionsJsonCodec({ version: 1 })
  return organization
}
/** Bind record query and prefix terminals to one canonical transaction operation view. */
function createSqliteTransactionRecordApi<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  scope: object
): ITransactionRecordsApi<TValue> {
  return {
    query: <R = TValue>() =>
      createRecordQuery<R, undefined>(
        {
          asyncDisposeKey,
          pushdown: {
            operators: [],
            operations: [],
            source: SqliteNames.backend,
            index: `${organization.table}_${SqliteNames.record}`
          },
          execute: () =>
            sqliteTransactionIterator(
              organization,
              scope as ISqliteTransactionScope<TValue>,
              undefined
            )
        },
        organization.core.getChainMethods('query')
      ),
    removeByPrefix: (prefix) =>
      sqliteScoped(
        organization,
        scope,
        SqliteOperation.removeByPrefix,
        // Operation middleware may await; retain the caller's original prefix until terminal use.
        () => ({ prefix: snapshotStorageKey(prefix, SqliteNames.backend) }),
        (state, _current, input) => {
          /** The admitted native segment has no await, so validation does not copy the key again. */
          const prefix = (input as { prefix: IStorageKey }).prefix
          assertStorageKey(prefix, SqliteNames.backend)
          return sqliteRemovePrefix(organization, 'record', prefix, state)
        }
      )
  }
}
/** Install one organization using named native jobs and the original physical state. */
export function createSqliteStore<TValue>(
  input: ISqliteOptions,
  runtime: ISqliteRuntime,
  shared?: ISqlitePhysicalState
): ISqliteConstruction<TValue> {
  const organization = createSqliteContext<TValue>(input, runtime, shared)
  const base = createSqliteBase(organization)
  const keyValue = createSqliteKeyValue(organization, base)
  const kvImplementation = implement(kv, keyValue, { forTransaction: (scope) => scope })
  const recordApi = createSqliteRecordApi(organization)
  const recordImplementation = implement(records, recordApi, {
    forTransaction: (scope) => createSqliteTransactionRecordApi(organization, scope)
  })
  const sqlImplementation = implement(
    sql,
    { sql: base.sql },
    {
      forTransaction: (scope) => ({ sql: (scope as ISqliteTransactionScope<TValue>).sql })
    }
  )
  const timeToLive = createSqliteTtlApi(organization)
  const counters = createSqliteCounterApi(organization)
  const ttlImplementation = implement(ttl, timeToLive, {
    forTransaction: (scope) => (scope as ISqliteInternalScope<TValue>)[ttlOperations]
  })
  const counterImplementation = implement(counter, counters, {
    forTransaction: (scope) => (scope as ISqliteInternalScope<TValue>)[counterOperations]
  })
  try {
    organization.store = provideCapabilities(
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
          organization.installer = value
        }
      }
    )
    organization.stages = organization.core.stageBindings
    organization.operationStages = organization.stages.operationStages(organization.store)
    organization.sqlStages = organization.stages.sqlStages(organization.store)
    organization.codecStages = organization.stages.codecStages(organization.store)
    organization.concurrencyStages = organization.stages.concurrencyStages(organization.store)
    organization.transactionStages = organization.stages.transactionStages(organization.store)
    organization.transactionOwner = createTransactionOwner<TValue, ISqliteTransactionScope<TValue>>(
      organization.store,
      normalizeTransactionFailure,
      {
        activityMode: 'managed',
        asyncDisposeKey,
        defaultPolicy: organization.concurrency,
        concurrencyStages: organization.concurrencyStages
      }
    )
    const journal = createSqliteJournal(organization)
    return {
      store: organization.store,
      client: organization.client,
      controller: organization.controller,
      installer: organization.installer,
      journal,
      createOrg: (orgId, orgCore) =>
        createSqliteStore<TValue>(
          {
            driver: organization.driver,
            table: organization.table,
            concurrency: organization.concurrency,
            owner: { label: organization.label },
            maxLockMs: organization.maxLockMs,
            wal: organization.wal
          },
          {
            core: orgCore,
            orgId,
            ...(orgId === organization.runtime.orgId
              ? { journalGeneration: organization.journalGeneration }
              : {})
          },
          organization.physicalState
        ),
      dropOrg: () =>
        sqliteRootWrite(organization, SqliteOperation.dropOrg, undefined, undefined, () => ({
          keys: [],
          committed: () => {
            organization.journalGeneration.value = {}
          },
          guard: { channels: ['text', 'bytes', 'record'] },
          run: (state) => {
            sqliteClear(organization, ['text', 'bytes', 'record'], state)
            for (const name of [
              'metadata',
              'journal',
              'markers',
              ...(organization.wal ? (['locks', 'revisions'] as const) : [])
            ] as const)
              sqliteStatement(
                organization,
                'DELETE FROM ' + organization.tables[name] + ' WHERE org_id=?',
                [state.orgId],
                'run',
                state
              )
          }
        })),
      getTransactionClient: (scope) => {
        sqliteNativeFor(organization, scope)
        return organization.client
      }
    }
  } catch (error) {
    void organization.controller
      .dispose()
      .catch((cleanup) => reportCleanupError(organization.report, cleanup))
    throw normalizeSqliteFailure(error)
  }
}
