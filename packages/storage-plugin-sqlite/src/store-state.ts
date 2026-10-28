// Organization context types, physical groups and statement access for the SQLite store (see ./store.ts).
import {
  createTransactionOwner,
  assertTransactionOwner,
  snapshotConcurrencyLockRange,
  createStorageOperationReporter,
  reportCleanupError,
  throwIfAborted,
  type IBackendChangeController,
  type IBackendKeyLockPort,
  type IBackendRevisionPort
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageKey,
  type IStorageBase,
  type ITransactionScope,
  type IStorageBatchKey,
  type ITtlTarget,
  type ITransactionTtlApi,
  type ITransactionCounterApi,
  type IOperationContext,
  type ICapabilityInstallPort,
  type IConcurrencyAttemptContext,
  type IConcurrencyHolder,
  type ILockKey,
  type IBackendStageBindings
} from '@migaia/storage-contract'
import type {
  IStoragePluginCore,
  IStorageJournalBackendBinding,
  IStorageJournalImage,
  IStorageJournalChange,
  IStorageJournalTarget,
  IStorageJournalExecutionPort
} from '@migaia/storage-host'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import { createConcurrencyLimiter } from '@migaia/utils/promise'
import { SqliteNames } from './constants.js'
import { sqliteError, normalizeSqliteFailure } from './errors.js'
import { SqliteErrorCode } from '@migaia/storage-contract/error-code'
import { SqliteErrorText } from './error-text.js'
import { createSqliteStatements } from './sql.js'
import type { ISqliteJournalTerminal } from './journal.js'
import type {
  ISqliteOptions,
  ISqliteStore,
  ISqliteDriver,
  ISqliteTransactionScope,
  ISqliteValue
} from './types.js'

/** Physical driver ownership is exclusive and released only after its store has drained. */
export const claimedDrivers = new WeakSet<object>()
/** File/table/org groups share the existing host lock provider, independent of driver handles. */
export const physicalGroups = new Map<
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
export type IChannel = 'text' | 'bytes' | 'record' | 'metadata'
/** Trusted short control segments use the same connection owner field without granting a scope. */
export const SQLITE_CONTROL_ACTIVE = Symbol('sqlite-control-active')
/** A complete revision distinguishes ordinary updates from native row deletion and recreation. */
export type ISqliteRevision = { readonly version: number; readonly birth: string | undefined }
/** A native callback and every short view refer to one actual active transaction. */
export type INativeState = {
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
export type ISqlitePhysicalState = {
  readonly admission: ReturnType<typeof createConcurrencyLimiter>
  readonly client: ISqliteDriver
  readonly physical: object | string
  readonly wal: boolean
  active: INativeState | typeof SQLITE_CONTROL_ACTIVE | undefined
}
/** Only native write failures created here trigger physical optimistic recovery. */
export class SqlitePhysicalBusy extends Error {
  /** Preserve native BUSY identity without classifying arbitrary user callback errors. */
  constructor(cause: unknown) {
    super(SqliteErrorText.sqliteFailed, { cause })
  }
}
/** Native range deletion reports real intersecting holders to the original decision loop. */
export class SqliteLogicalConflict extends Error {
  /** Only this backend-created evidence can turn an internal clear into an acquire conflict. */
  constructor(
    readonly keys: readonly ILockKey[],
    readonly holder: IConcurrencyHolder | undefined
  ) {
    super(SqliteErrorText.transactionFailed)
  }
}
/** Clear and prefix operations inspect only their actual public channel range. */
export type IWriteGuard = {
  readonly channels: readonly ('text' | 'bytes' | 'record')[]
  readonly prefix?: IStorageKey
}
/** A root operation prepares its payload and exact protected range before any admission can wait. */
export type IRootMutation<R> = {
  readonly keys: readonly ILockKey[]
  readonly guard?: IWriteGuard
  /** Publish owner facts only after this mutation's actual native COMMIT. */
  readonly committed?: () => void
  /** An unselected read keeps its original native segment instead of opening a writer. */
  readonly read?: (observeKey?: (key: ILockKey) => void) => R
  run(state: INativeState): R
}
/** Native batch rows retain the one canonical key capture and detached text payload. */
export type ITextBatchEntry = IStorageBatchKey & {
  readonly value: string
  readonly ttlMs?: number
}
/** Presence distinguishes a native batch from the unchanged single-operation observation path. */
export type IBatchObservation = { readonly count: number | undefined }
/** Scope-local native APIs are borrowed only through the original capability transaction binder. */
export const ttlOperations = Symbol('sqlite-ttl-operations')
/** Counter access shares the same complete native scope without a separate owner registry. */
export const counterOperations = Symbol('sqlite-counter-operations')
/** This backend owns only the three expiring native tables. */
export type ISqliteTtlTarget = Extract<
  ITtlTarget,
  { readonly channel: 'text' | 'bytes' | 'record' }
>
/** Private symbol methods are created by the same original complete scope factory. */
export type ISqliteInternalScope<TValue> = ISqliteTransactionScope<TValue> & {
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
export type ISqliteOrganizationContext<TValue> = {
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
export function sqliteOperationOrg<TValue>(
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
export function sqliteLocalGroup<TValue>(
  organization: ISqliteOrganizationContext<TValue>,
  orgId: string
) {
  return orgId === organization.runtime.orgId
    ? organization.group!
    : physicalGroups.get(organization.physical)!.get(JSON.stringify([organization.table, orgId]))!
}
/** The existing org call context supplies the one configured journal port for its actual org. */
export function sqliteJournalFor<TValue>(
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
export function sqliteAssertRoot<TValue>(organization: ISqliteOrganizationContext<TValue>): void {
  organization.controller.assertLive()
  if (organization.physicalState.active) throw sqliteError(SqliteErrorCode.transactionFailed)
}
/** Scope authorization returns the existing native attempt, never a copy or public marker. */
export function sqliteNativeFor<TValue>(
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
export function sqliteJournalScope<TValue>(
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
export function sqliteFinishJournal<TValue>(
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
export function sqliteStatement<TValue, R>(
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
export function sqliteIsBusy<TValue>(
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
