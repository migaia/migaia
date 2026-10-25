import {
  type ILockKey,
  type IConcurrencyPolicy,
  type ITransactionOptions,
  ConcurrencyHolderState,
  type IConcurrencyHolder,
  type IConcurrencyDecision,
  type IConcurrencyStageObserver,
  type IConcurrencyConflict,
  type ILockHolding,
  ConcurrencyLocking,
  invalidConcurrencyArgument,
  assertConcurrencyPolicy,
  readConcurrencyPolicy,
  defineConcurrencyPolicy,
  LockChannel,
  type INormalizedLockKey,
  invalidLockArgument,
  assertLockKey,
  type IConcurrencyAttempt,
  type IConcurrencyAttemptContext,
  type IConcurrencyPort,
  type IConcurrencyRequest,
  assertStringStorageKey,
  type IQuad,
  type IBackendKind,
  StorageContractError,
  StorageContractErrorCode,
  StorageContractErrorText,
  type IConflictPolicy,
  type IOperationContext,
  type IStorageKey
} from '@migaia/storage-contract'
import {
  createAbortTimeoutSignal,
  raceWithAbort,
  sleep,
  withTimeout,
  hostRethrowReporter,
  type IAbortTimeoutSignal,
  type IUtilsReporter
} from '@migaia/utils/promise'
import { IdentifyError, isUtilsAbortError, isUtilsTimeoutError } from '@migaia/utils/error'
import { observeThenableRejection } from '@migaia/utils/function'
import { systemScheduler } from '@migaia/utils/scheduler'
import { snapshotOperationContext } from './context.js'
import { readTransactionConcurrency, resolveConcurrencyPolicy } from './transaction.js'
import {
  snapshotStorageKey,
  encodeOrderedStorageKey,
  snapshotStorageKeyPrefix,
  storageKeyBytesIdentity,
  sortStorageByteIdentities
} from './key.js'
import { snapshotStorageRdfQuad, encodeRdfQuadSnapshot } from './rdf.js'

/** Stable decision values stay in the original concurrency owner. */
const ConcurrencyAction = { wait: 'wait', reject: 'reject', retry: 'retry' } as const

/** Preset labels describe policy behavior and never authorize a structurally copied policy. */
const ConcurrencyPreset = { wait: 'wait', fail: 'fail', optimistic: 'optimistic' } as const

/** Existing waiting semantics use thirty seconds only for logical lock admission. */
const DEFAULT_LOCK_WAIT_MS = 30_000

/** The optimistic preset retries three real conflicts unless explicitly configured otherwise. */
const DEFAULT_OPTIMISTIC_RETRIES = 3

/** Preset retry delay is independent of physical database admission. */
const DEFAULT_OPTIMISTIC_BACKOFF_MS = 20

/** Preset options are ordinary records; every admitted duration/count is a nonnegative safe integer. */
function policyNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalidConcurrencyArgument()
  return value
}

/** Rejects unsupported option containers before executing any policy callback. */
function assertPolicyOptions(options: unknown): void {
  if (
    options !== undefined &&
    (typeof options !== 'object' || options === null || Array.isArray(options))
  )
    throw invalidConcurrencyArgument()
}

/** Presets create authentic policy identities through the same canonical definition path. */
export const ConcurrencyPolicy = Object.freeze({
  /** Wait only on acquisition; commit conflicts reject after the native attempt has ended. */
  wait(options?: {
    readonly timeoutMs?: number
  }): IConcurrencyPolicy & { readonly locking: 'pessimistic' } {
    assertPolicyOptions(options)
    /** Logical wait budget never becomes a physical database timeout. */
    const timeoutMs = policyNumber(options?.timeoutMs, DEFAULT_LOCK_WAIT_MS)
    return defineConcurrencyPolicy({
      name: ConcurrencyPreset.wait,
      locking: ConcurrencyLocking.pessimistic,
      decide: (conflict) =>
        conflict.phase === 'acquire'
          ? { action: ConcurrencyAction.wait, timeoutMs }
          : { action: ConcurrencyAction.reject }
    })
  },
  /** Reject every actual conflict without imposing an artificial physical-admission budget. */
  fail(): IConcurrencyPolicy & { readonly locking: 'pessimistic' } {
    return defineConcurrencyPolicy({
      name: ConcurrencyPreset.fail,
      locking: ConcurrencyLocking.pessimistic,
      decide: () => ({ action: ConcurrencyAction.reject })
    })
  },
  /** Retry the configured number of real conflicts, then reject; successful attempts do not decide. */
  optimistic(options?: {
    readonly retries?: number
    readonly backoffMs?: number
  }): IConcurrencyPolicy & { readonly locking: 'optimistic' } {
    assertPolicyOptions(options)
    /** Real conflict sequence counts from one; zero disables strategy retries. */
    const retries = policyNumber(options?.retries, DEFAULT_OPTIMISTIC_RETRIES)
    /** Backoff is captured independently and never reads mutable caller configuration again. */
    const backoffMs = policyNumber(options?.backoffMs, DEFAULT_OPTIMISTIC_BACKOFF_MS)
    return defineConcurrencyPolicy({
      name: ConcurrencyPreset.optimistic,
      locking: ConcurrencyLocking.optimistic,
      decide: (conflict) =>
        conflict.attempt <= retries
          ? { action: ConcurrencyAction.retry, delayMs: backoffMs }
          : { action: ConcurrencyAction.reject }
    })
  }
})

/** Disjoint channel markers prevent equal user keys in different channels from colliding. */
const LockChannelRank = { text: 1, bytes: 2, record: 3, vector: 4, rdf: 5 } as const

/** Capture text identity before queued lock admission can observe caller key changes. */
function parseTextLock(
  value: Extract<ILockKey, { channel: 'text' }>,
  backend: IBackendKind | undefined
): ILockKey {
  return { channel: LockChannel.text, key: snapshotStorageKey(value.key, backend) }
}

/** Bytes retain the existing string-only key domain without allocating another key image. */
function parseBytesLock(value: Extract<ILockKey, { channel: 'bytes' }>): ILockKey {
  return { channel: LockChannel.bytes, key: value.key }
}

/** Capture mutable record key components before the real lock queue yields. */
function parseRecordLock(
  value: Extract<ILockKey, { channel: 'record' }>,
  backend: IBackendKind | undefined
): ILockKey {
  return { channel: LockChannel.record, key: snapshotStorageKey(value.key, backend) }
}

/** Vector point identity consists only of its collection/id strings. */
function parseVectorLock(value: Extract<ILockKey, { channel: 'vector' }>): ILockKey {
  return { channel: LockChannel.vector, collection: value.collection, id: value.id }
}

/** Ground quad fields span queued lock admission and share the canonical RDF capture owner. */
function parseRdfLock(
  value: Extract<ILockKey, { channel: 'rdf' }>,
  backend: IBackendKind | undefined
): ILockKey {
  return { channel: LockChannel.rdf, quad: snapshotStorageRdfQuad(value.quad, backend) }
}

/** Dispatch the supported channel once; each channel owns exactly its actual input fields. */
export function snapshotLockKey(value: unknown, backend: IBackendKind | undefined): ILockKey {
  assertLockKey(value, backend)
  /** Only the snapshot boundary detaches mutable keys or ground term objects for queued use. */
  const key = value
  switch (key.channel) {
    case LockChannel.text:
      return parseTextLock(key, backend)
    case LockChannel.bytes:
      return parseBytesLock(key)
    case LockChannel.record:
      return parseRecordLock(key, backend)
    case LockChannel.vector:
      return parseVectorLock(key)
    case LockChannel.rdf:
      return parseRdfLock(key, backend)
    default:
      throw invalidLockArgument(backend)
  }
}

/** Public factories snapshot immediately without inventing a backend when no store exists yet. */
export const lockKey = Object.freeze({
  /** Text locks use the same typed key domain as single and batch text identity. */
  text(key: IStorageKey): Extract<ILockKey, { readonly channel: 'text' }> {
    return snapshotLockKey({ channel: LockChannel.text, key }, undefined) as Extract<
      ILockKey,
      { readonly channel: 'text' }
    >
  },
  /** Byte locks retain their existing string-only physical channel. */
  bytes(key: string): Extract<ILockKey, { readonly channel: 'bytes' }> {
    return snapshotLockKey({ channel: LockChannel.bytes, key }, undefined) as Extract<
      ILockKey,
      { readonly channel: 'bytes' }
    >
  },
  /** Record locks detach Dates, buffers and nested arrays through the existing validator. */
  record(key: IStorageKey): Extract<ILockKey, { readonly channel: 'record' }> {
    return snapshotLockKey({ channel: LockChannel.record, key }, undefined) as Extract<
      ILockKey,
      { readonly channel: 'record' }
    >
  },
  /** Vector locks share one exact collection/point identity with native writes and TTL. */
  vector(collection: string, id: string): Extract<ILockKey, { readonly channel: 'vector' }> {
    return snapshotLockKey({ channel: LockChannel.vector, collection, id }, undefined) as Extract<
      ILockKey,
      { readonly channel: 'vector' }
    >
  },
  /** RDF locks detach a complete ground quad through its canonical term owner. */
  rdf(quad: IQuad): Extract<ILockKey, { readonly channel: 'rdf' }> {
    return snapshotLockKey({ channel: LockChannel.rdf, quad }, undefined) as Extract<
      ILockKey,
      { readonly channel: 'rdf' }
    >
  }
})

/** Encodes only canonical channel content for both native identity and unchanged diagnostics. */
function encodeLockContent(key: ILockKey, backend: IBackendKind | undefined): Uint8Array {
  return key.channel === LockChannel.rdf
    ? encodeRdfQuadSnapshot(key.quad)
    : encodeOrderedStorageKey(
        key.channel === LockChannel.vector ? [key.collection, key.id] : key.key,
        backend
      )
}

/** Adds only channel identity around the sole canonical ordered-key encoder. */
function encodeLockIdentity(key: ILockKey, backend: IBackendKind | undefined): Uint8Array {
  /** Key-order and RDF own all self-delimiting content bytes. */
  const ordered = encodeLockContent(key, backend)
  /** New vector/RDF markers follow the unchanged text < bytes < record order. */
  const encoded = new Uint8Array(ordered.length + 1)
  encoded[0] = LockChannelRank[key.channel]
  encoded.set(ordered, 1)
  return encoded
}

/**
 * Detaches only the current inspection rows and orders them with the original stable byte radix.
 * Equal keys retain their individual holder/lease rows; no lock or resource authority is granted.
 */
export function snapshotConcurrencyLockHoldings(
  rows: readonly ILockHolding[]
): readonly ILockHolding[] {
  if (!Array.isArray(rows)) throw invalidLockArgument(undefined)
  /** Encodings belong only to this inspection and never replace authentic attempt metadata. */
  const entries: { readonly encoded: Uint8Array; readonly row: ILockHolding }[] = []
  for (const row of rows) {
    /** Public diagnostics can retain and mutate Date/binary keys while the lease remains active. */
    const captured = { ...row, key: snapshotLockKey(row.key, undefined) }
    entries.push({ encoded: encodeLockIdentity(captured.key, undefined), row: captured })
  }
  sortStorageByteIdentities(entries)
  return entries.map((entry) => entry.row)
}

/** Adjacent deduplication charges each compared encoding at most twice. */
function equalLockIdentity(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1)
    if (left[index] !== right[index]) return false
  return true
}

/**
 * Internal owner/builder normalization snapshots once, encodes once and sorts by actual byte
 * suffixes. The immutable result has independent keys and no comparison sort or global cache.
 */
export function normalizeLockKeys(
  keys: unknown,
  backend: IBackendKind
): readonly INormalizedLockKey[] {
  if (!Array.isArray(keys)) throw invalidLockArgument(backend)
  /** Normalization keeps only this input's independent key snapshots and encodings. */
  const entries: INormalizedLockKey[] = []
  for (const value of keys) {
    /** Mutable key components must survive actual queued acquisition and asynchronous retries. */
    const key = snapshotLockKey(value, backend)
    entries.push({ key, encoded: encodeLockIdentity(key, backend) })
  }
  return uniqueNormalizedLockKeys(entries)
}

/** Reuses captured byte identities when original options acquire additional implicit locks. */
function uniqueNormalizedLockKeys(entries: INormalizedLockKey[]): readonly INormalizedLockKey[] {
  sortStorageByteIdentities(entries)
  /** Only adjacent canonical identities are compared; mutable object identity never deduplicates. */
  const unique: INormalizedLockKey[] = []
  for (const entry of entries) {
    /** The last retained item is already in canonical order. */
    const previous = unique[unique.length - 1]
    if (!previous || !equalLockIdentity(previous.encoded, entry.encoded)) unique.push(entry)
  }
  return unique
}

/**
 * Captures one canonical lock set and its matching immutable identities without granting admission
 * authority. Consumers share the original key snapshot, ordered encoder and stable deduplication.
 */
export function snapshotConcurrencyLockKeys(
  keys: unknown,
  backend: IBackendKind
): { readonly keys: readonly ILockKey[]; readonly identities: readonly string[] } {
  /** One normalization supplies both detached logical keys and their already captured bytes. */
  const locks = normalizeLockKeys(keys, backend)
  return {
    keys: locks.map((entry) => entry.key),
    identities: snapshotLockIdentities(locks)
  }
}

/**
 * Projects one channel or typed prefix into the same half-open hexadecimal identity interval as
 * active locks. This is a pure range snapshot, without a lock table or acquisition authority.
 */
export function snapshotConcurrencyLockRange(
  range: { readonly channel: ILockKey['channel']; readonly prefix?: IStorageKey },
  backend: IBackendKind
): { readonly lower: string; readonly upper: string } {
  if (typeof range !== 'object' || range === null || Array.isArray(range))
    throw invalidLockArgument(backend)
  /** Scalar channel/prefix intent is consumed synchronously by the canonical encoder. */
  const { channel, prefix } = range
  if (
    channel !== LockChannel.text &&
    channel !== LockChannel.bytes &&
    channel !== LockChannel.record &&
    channel !== LockChannel.vector &&
    channel !== LockChannel.rdf
  )
    throw invalidLockArgument(backend)
  /** Only the original channel owner supplies its finite physical ordering. */
  const rank = LockChannelRank[channel]
  if (prefix === undefined)
    return {
      lower: storageKeyBytesIdentity(new Uint8Array([rank])),
      upper: storageKeyBytesIdentity(new Uint8Array([rank + 1]))
    }
  if (channel === LockChannel.vector || channel === LockChannel.rdf)
    throw invalidLockArgument(backend)
  if (channel === LockChannel.bytes) assertStringStorageKey(prefix, backend)
  /** The original prefix writer owns all type tags, variable terminators and strict successors. */
  const bounds = snapshotStorageKeyPrefix(prefix, backend)
  /** Each bound adds only the same channel byte used by individual lock normalization. */
  const withChannel = (bytes: Uint8Array): string => {
    /** One allocation holds the captured channel and the original bound bytes. */
    const encoded = new Uint8Array(bytes.length + 1)
    encoded[0] = rank
    encoded.set(bytes, 1)
    return storageKeyBytesIdentity(encoded)
  }
  return { lower: withChannel(bounds.lower), upper: withChannel(bounds.upper) }
}

/** Fixed fields have already been captured by the original option/context admission path. */
const capturedConcurrencyFields = {
  lock: true,
  concurrency: true,
  signal: true,
  timeoutMs: true,
  pageSize: true,
  conflictPolicy: true,
  orgId: true
}

/**
 * Captures backend extension fields once for contexts that cross real preparation and attempt
 * awaits.
 */
function snapshotConcurrencyExtensions(options: ITransactionOptions): object {
  /** Plain owned properties preserve native option values and symbol fields on every attempt. */
  const extensions = {}
  for (const key of Reflect.ownKeys(options)) {
    if (Object.hasOwn(capturedConcurrencyFields, key)) continue
    Object.defineProperty(extensions, key, {
      value: options[key as keyof ITransactionOptions],
      enumerable: true
    })
  }
  return extensions
}

/** Canonical attempt states stay with the original concurrency loop. */
const ConcurrencyAttemptStatus = { committed: 'committed', conflict: 'conflict' } as const

/** Only an actual policy decision can change a subsequent attempt to waiting admission. */
const ConcurrencyAdmission = { try: 'try', wait: 'wait' } as const

/** Acquisition refusal and completed-rollback conflicts have distinct public failure codes. */
const ConcurrencyPhase = { acquire: 'acquire', commit: 'commit' } as const

/** A pipeline may return a recovery value or preserve the exact failure it observed. */
const ConcurrencyExecutionStatus = { returned: 'returned', threw: 'threw' } as const

/** One logical operation owns timing and conflict counters, including nested persist admission. */
type IConcurrencyBudget = {
  readonly cancellation: IAbortTimeoutSignal
  readonly deadlineFailure: StorageContractError
  readonly backend: IBackendKind
  readonly report: IUtilsReporter
  waitedMs: number
  logicalWaitedMs: number
  conflicts: number
}

/**
 * Captured options share canonical lock metadata and an optional running budget without granting
 * authority.
 */
const concurrencyAttemptBudgets = new WeakMap<
  ITransactionOptions,
  {
    readonly budget?: IConcurrencyBudget
    readonly locks: readonly INormalizedLockKey[] | undefined
    readonly identities: readonly string[]
  }
>()

/**
 * Builder-only metadata shares the existing options table and creates no timing or transaction
 * owner.
 */
export function associateNormalizedLockKeys(
  options: ITransactionOptions,
  locks: readonly INormalizedLockKey[]
): void {
  concurrencyAttemptBudgets.set(options, { locks, identities: snapshotLockIdentities(locks) })
}

/** One immutable ordered string list is retained with the original normalized option metadata. */
function snapshotLockIdentities(
  locks: readonly INormalizedLockKey[] | undefined
): readonly string[] {
  return locks?.map((entry) => storageKeyBytesIdentity(entry.encoded)) ?? []
}

/**
 * Reads the same active attempt's normalized, sorted and deduplicated lock identities. Repeated
 * reads and nested native attempts share one immutable string list; no logical key is inspected or
 * re-encoded here. Forged, builder-only and settled contexts reject with INVALID_ARGUMENT. This
 * grants no transaction, registration, lock acquisition or lifecycle authority.
 */
export function readConcurrencyLockIdentities(ctx: IConcurrencyAttemptContext): readonly string[] {
  /** Only the original live attempt metadata can grant read access to its immutable identities. */
  const captured = concurrencyAttemptBudgets.get(ctx)
  if (captured?.budget === undefined) throw invalidConcurrencyArgument()
  return captured.identities
}

/** Internal managed waits distinguish logical policy budgets from physical database scheduling. */
const ConcurrencyWaitKind = { logical: 'logical', physical: 'physical' } as const

/** An observation failure never replaces an operation result, even if the configured reporter fails. */
function reportConcurrencyFailure(
  stages: IConcurrencyStageObserver | undefined,
  error: unknown
): void {
  observeThenableRejection(undefined, { error }, (failure) => {
    if (stages) stages.report(failure)
    else hostRethrowReporter(failure, { operation: 'raceWithAbort', phase: 'late-rejection' })
  })
}

/** Invoke an actual stage method with its receiver and observe ordinary Promise completion. */
function observeConcurrencyResult(
  stages: IConcurrencyStageObserver,
  name: Exclude<keyof IConcurrencyStageObserver, 'kind' | 'report'>,
  args: readonly unknown[]
): void {
  try {
    /** The stage registry owns the callback receiver; no detached method or then getter is captured. */
    const result = (
      stages as unknown as Record<string, (...values: readonly unknown[]) => unknown>
    )[name]!(...args)
    if (result !== undefined)
      void Promise.resolve(result).catch((error) => reportConcurrencyFailure(stages, error))
  } catch (error) {
    reportConcurrencyFailure(stages, error)
  }
}

/** Optional stage selection does not grant cancellation or admission authority. */
function readConcurrencyStage<
  TName extends Exclude<keyof IConcurrencyStageObserver, 'kind' | 'report'>
>(stages: IConcurrencyStageObserver | undefined, name: TName): IConcurrencyStageObserver[TName] {
  return stages?.[name]
}

/** Constructs lock diagnostics once at failure, detached from mutable policy/backend key views. */
function concurrencyLockFailure(
  code: typeof StorageContractErrorCode.lockRejected | typeof StorageContractErrorCode.lockTimeout,
  backend: IBackendKind,
  keys: readonly ILockKey[],
  holder: IConcurrencyHolder | undefined,
  cause?: unknown
): StorageContractError {
  /** Error keys own their mutable components and cannot change a later attempt's physical identity. */
  const snapshot = keys.map((key) => snapshotLockKey(key, backend))
  /** Canonical bytes retain binary identity while JSON keeps ordinary logical keys readable. */
  const keyDescription =
    holder === undefined
      ? undefined
      : JSON.stringify(
          snapshot.map((key) => ({
            ...key,
            encoded: storageKeyBytesIdentity(encodeLockContent(key, backend))
          }))
        )
  /** Handoff is a real identity gap, never a substituted old label. */
  const holderDescription =
    holder?.status === ConcurrencyHolderState.held
      ? (holder.label ?? holder.owner)
      : ConcurrencyHolderState.handingOff
  return new StorageContractError(
    code,
    { backend, keys: snapshot, holder, cause },
    keyDescription === undefined
      ? undefined
      : StorageContractErrorText.lockFailure(code, keyDescription, holderDescription)
  )
}

/**
 * Maps only cancellation owned by this operation; backend failures otherwise pass through
 * unchanged.
 */
function concurrencyAbort(
  budget: IConcurrencyBudget,
  physical: boolean,
  keys: readonly ILockKey[] = []
): StorageContractError | undefined {
  /** The single merged signal owns first-abort identity and preserves an external reason. */
  const signal = budget.cancellation.signal
  if (!signal?.aborted) return undefined
  /** This original signal retains the operation's first cancellation reason. */
  const reason = signal.reason
  if (reason === budget.deadlineFailure)
    return physical
      ? concurrencyLockFailure(
          StorageContractErrorCode.lockTimeout,
          budget.backend,
          keys,
          undefined,
          reason
        )
      : budget.deadlineFailure
  return new StorageContractError(StorageContractErrorCode.aborted, {
    backend: budget.backend,
    cause: reason
  })
}

/**
 * Uses utils waiting primitives only. Timeout ends this wait, never an accepted native attempt; the
 * backend must remove its queued waiter and finish cleanup before its attempt settles.
 */
async function waitForConcurrency<T>(
  budget: IConcurrencyBudget,
  pending: Promise<T>,
  kind: (typeof ConcurrencyWaitKind)[keyof typeof ConcurrencyWaitKind],
  logicalTimeoutMs: number | undefined,
  keys: readonly ILockKey[],
  holder: IConcurrencyHolder | undefined
): Promise<T> {
  /**
   * The pending Promise already exists; observe it even if utils rejects before starting its lazy
   * operation.
   */
  let started = false
  void pending.catch((error) => {
    if (!started) {
      /** Only this operation's own reason acknowledges cancellation. */
      const acknowledgement = error === budget.cancellation.signal?.reason
      if (!acknowledgement)
        budget.report(error, { operation: 'raceWithAbort', phase: 'late-rejection' })
    }
  })
  /** Only this actual blocking interval contributes to cumulative admission statistics. */
  const start = systemScheduler.now()
  try {
    /** The lazy operation transfers rejection observation to the canonical utils implementation. */
    const operation = (): Promise<T> => {
      started = true
      return pending
    }
    if (kind === ConcurrencyWaitKind.logical && logicalTimeoutMs !== undefined)
      return await withTimeout(operation, {
        timeoutMs: Math.max(0, logicalTimeoutMs - budget.logicalWaitedMs),
        signal: budget.cancellation.signal,
        report: budget.report
      })
    return await raceWithAbort(operation, {
      signal: budget.cancellation.signal,
      report: budget.report
    })
  } catch (error) {
    /**
     * Physical deadlines have their own public classification; external cancellation keeps its
     * reason.
     */
    const aborted = concurrencyAbort(budget, kind === ConcurrencyWaitKind.physical, keys)
    if (aborted) throw aborted
    if (kind === ConcurrencyWaitKind.logical && isUtilsTimeoutError(error))
      throw concurrencyLockFailure(
        StorageContractErrorCode.lockTimeout,
        budget.backend,
        keys,
        holder,
        error
      )
    if (isUtilsAbortError(error))
      throw new StorageContractError(StorageContractErrorCode.aborted, {
        backend: budget.backend,
        cause: error.cause
      })
    throw error
  } finally {
    /** Callback and cleanup execution are deliberately outside these measured waiting intervals. */
    const elapsed = Math.max(0, systemScheduler.now() - start)
    budget.waitedMs += elapsed
    if (kind === ConcurrencyWaitKind.logical) budget.logicalWaitedMs += elapsed
  }
}

/**
 * Captures policy fields once and rejects inapplicable combinations after the old attempt is
 * closed.
 */
function readConcurrencyDecision(
  value: unknown,
  phase: IConcurrencyConflict['phase']
): IConcurrencyDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(StorageContractErrorText.concurrencyDecision)
  /** A changing result cannot supply different action/budget fields during validation and use. */
  const { action, timeoutMs, delayMs } = value as IConcurrencyDecision
  if (action === ConcurrencyAction.reject && timeoutMs === undefined && delayMs === undefined)
    return value as IConcurrencyDecision
  if (
    action === ConcurrencyAction.wait &&
    phase === ConcurrencyPhase.acquire &&
    delayMs === undefined &&
    (timeoutMs === undefined || (Number.isFinite(timeoutMs) && timeoutMs >= 0))
  )
    return value as IConcurrencyDecision
  if (
    action === ConcurrencyAction.retry &&
    timeoutMs === undefined &&
    (delayMs === undefined || (Number.isFinite(delayMs) && delayMs >= 0))
  )
    return value as IConcurrencyDecision
  throw new TypeError(StorageContractErrorText.concurrencyDecision)
}

/** Original pipeline segment outcomes are observed before another native attempt begins. */
type IAttemptExecution<TResult> = {
  readonly ready: Promise<void>
  readonly completed: Promise<
    | {
        readonly status: typeof ConcurrencyExecutionStatus.returned
        readonly value: Awaited<TResult>
      }
    | { readonly status: typeof ConcurrencyExecutionStatus.threw; readonly cause: unknown }
  >
  readonly entered: boolean
  resolve(value: Awaited<TResult>): void
  reject(cause: unknown): void
}

/** A segment borrows only its real pipeline callback and the original loop’s preparation port. */
type IAttemptExecutionPort<TResult> = {
  execute(invoke: () => Promise<Awaited<TResult>>): Awaited<TResult> | PromiseLike<Awaited<TResult>>
  prepare(): StorageContractError | undefined
}

/** Own one segment’s terminal admission and native result without another loop or timing owner. */
class ConcurrencyAttemptExecution<TResult> implements IAttemptExecution<TResult> {
  /** The runner owns the actual preparation and executeAttempt callbacks. */
  readonly #port: IAttemptExecutionPort<TResult>
  /**
   * Native settlement stays pending through acquisition refusals and resolves only after actual
   * cleanup.
   */
  readonly #native: Promise<Awaited<TResult>>
  /** Complete the exact native Promise borrowed by the pipeline terminal. */
  #resolveNative!: (value: Awaited<TResult>) => void
  /** Preserve the exact coded failure observed by catch and recovery. */
  #rejectNative!: (cause: unknown) => void
  /** Wake the original loop at terminal admission or actual pipeline completion. */
  #resolveReady!: () => void
  /** A terminal can admit native work once for this actual segment. */
  #invoked = false
  /** Successful preparation is the sole authority to begin this segment’s native attempts. */
  #entered = false
  /** Original loop waits for terminal admission or a legal stage halt. */
  readonly ready: Promise<void>
  /** Both outcomes are observed before a completed segment is released. */
  readonly completed: IAttemptExecution<TResult>['completed']
  /** Build all result ports before invoking the real pipeline callback. */
  constructor(port: IAttemptExecutionPort<TResult>) {
    this.#port = port
    this.#native = new Promise((resolve, reject) => {
      this.#resolveNative = resolve
      this.#rejectNative = reject
    })
    void this.#native.then(undefined, () => undefined)
    this.ready = new Promise((resolve) => {
      this.#resolveReady = resolve
    })
    this.completed = this.#complete()
  }
  /** Admission facts have no setter and grant no native port to callers. */
  get entered(): boolean {
    return this.#entered
  }
  /** Actual native commit settlement resumes the pipeline’s after-next path. */
  resolve(value: Awaited<TResult>): void {
    this.#resolveNative(value)
  }
  /** Actual native conflict/failure resumes that same pipeline’s catch/finally path. */
  reject(cause: unknown): void {
    this.#rejectNative(cause)
  }
  /** Duplicate calls reject before key derivation or native admission. */
  #enter(): Promise<Awaited<TResult>> {
    if (this.#invoked) return Promise.reject(invalidConcurrencyArgument())
    this.#invoked = true
    /** Preparation runs synchronously at the original terminal before it yields to the native loop. */
    const aborted = this.#port.prepare()
    if (aborted) return Promise.reject(aborted)
    this.#entered = true
    this.#resolveReady()
    return this.#native
  }
  /** Observe the original segment’s complete asynchronous unwind, including legal early return. */
  async #complete(): IAttemptExecution<TResult>['completed'] {
    try {
      return {
        status: ConcurrencyExecutionStatus.returned,
        value: await this.#port.execute(() => this.#enter())
      }
    } catch (cause) {
      return { status: ConcurrencyExecutionStatus.threw, cause }
    } finally {
      this.#resolveReady()
    }
  }
}

/** All logical retry state belongs to one named runner and the original transaction registration. */
class ConcurrencyRunner<TResult> {
  /** The caller supplies actual preparation and pipeline ports; no second runner is installed. */
  #request: IConcurrencyRequest<TResult>
  /** The backend owns every actual attempt through its original port. */
  #port: IConcurrencyPort<TResult>
  /** Original owner diagnostics stay fixed through retries and cancellation. */
  #backend: IBackendKind
  /** Observation uses the original host stage binding without admission authority. */
  #stages: IConcurrencyStageObserver | undefined
  /** The original option policy is forwarded independently of the effective request policy. */
  #capturedOverride: IConcurrencyPolicy | undefined
  /** One authentic effective policy decides only after real native conflicts. */
  #policy: IConcurrencyPolicy
  /** Authentic nested contexts borrow the existing lock facts and timing budget. */
  #inherited: ReturnType<(typeof concurrencyAttemptBudgets)['get']>
  /** Canonical lock images remain stable while native work and policy callbacks await. */
  #locks: readonly INormalizedLockKey[] | undefined
  /** Each real pipeline replay starts from the original declared lock set. */
  #originalLocks: readonly INormalizedLockKey[] | undefined
  /** Operation fields must remain fixed across preparation and native attempt awaits. */
  #context: ReturnType<typeof snapshotOperationContext>
  /** The original normalized bytes supply one identity list across retries. */
  #identities: readonly string[]
  /** Native option fields travel with the same operation across asynchronous pipeline stages. */
  #extensions: object
  /** The existing reporter owns cleanup and late rejection diagnostics. */
  #report: IUtilsReporter
  /** The sole merged signal and cumulative conflict/wait counters belong to this logical operation. */
  #budget: IConcurrencyBudget
  /** Only a real policy decision switches subsequent acquisition from try to wait. */
  #admission: IConcurrencyAttemptContext['admission']
  /** Policy wait duration remains separate from the overall operation deadline. */
  #logicalTimeoutMs: number | undefined
  /** Original conflict facts survive an awaiting policy without borrowing its mutable argument view. */
  #lastConflict: Pick<IConcurrencyConflict, 'keys' | 'holder'> | undefined
  /** Actual attempt stages share fixed fields and this operation owner’s running signal. */
  #executionContext: (IOperationContext & { readonly conflictPolicy?: IConflictPolicy }) | undefined
  /** Only the current original pipeline segment remains live until its unwind finishes. */
  #execution: IAttemptExecution<TResult> | undefined
  /** The original outer pipeline terminal may enter its logical loop exactly once. */
  #outerInvoked = false
  /** Admit the current supported request before any pipeline or native attempt starts. */
  constructor(request: IConcurrencyRequest<TResult>, port: IConcurrencyPort<TResult>) {
    this.#request = request
    this.#port = port
    /** Admission time counts against the one overall deadline. */
    const startedAt = systemScheduler.now()
    /** Original registration supplies diagnostics and the sole host stage binding. */
    const registration = readTransactionConcurrency(request.store)
    this.#backend = registration.backend
    this.#stages = registration.stages
    if (request.policy !== undefined) assertConcurrencyPolicy(request.policy)
    if (
      typeof request.options !== 'object' ||
      request.options === null ||
      Array.isArray(request.options)
    )
      throw invalidConcurrencyArgument()
    /** Declared lock input spans all later asynchronous attempts and is captured once. */
    const declaredLocks = request.options.lock
    this.#capturedOverride = request.options.concurrency
    if (this.#capturedOverride !== undefined) assertConcurrencyPolicy(this.#capturedOverride)
    if (
      (request.lock !== undefined && typeof request.lock !== 'function') ||
      (request.prepare !== undefined && typeof request.prepare !== 'function') ||
      (request.execute !== undefined && typeof request.execute !== 'function') ||
      (request.executeAttempt !== undefined && typeof request.executeAttempt !== 'function') ||
      (request.execute !== undefined && request.executeAttempt !== undefined)
    )
      throw invalidConcurrencyArgument()
    this.#policy = request.policy ?? resolveConcurrencyPolicy(request.store, this.#capturedOverride)
    this.#inherited = concurrencyAttemptBudgets.get(request.options)
    this.#locks = this.#inherited
      ? this.#inherited.locks
      : declaredLocks === undefined
        ? undefined
        : normalizeLockKeys(declaredLocks, this.#backend)
    this.#originalLocks = this.#locks
    this.#context = snapshotOperationContext(request.options)
    if (!request.prepare && !request.execute && !request.executeAttempt) this.#derivePreparedLocks()
    this.#identities =
      this.#locks === this.#inherited?.locks && this.#inherited
        ? this.#inherited.identities
        : snapshotLockIdentities(this.#locks)
    this.#extensions = snapshotConcurrencyExtensions(request.options)
    /** Nested calls preserve the original deadline failure identity. */
    const deadlineFailure =
      this.#inherited?.budget?.deadlineFailure ??
      new StorageContractError(StorageContractErrorCode.aborted, { backend: this.#backend })
    this.#report =
      this.#inherited?.budget?.report ?? ((error) => reportConcurrencyFailure(this.#stages, error))
    this.#budget = this.#inherited?.budget ?? {
      cancellation: createAbortTimeoutSignal({
        signal: this.#context?.signal,
        timeoutMs:
          this.#context?.timeoutMs === undefined
            ? undefined
            : Math.max(0, this.#context.timeoutMs - (systemScheduler.now() - startedAt)),
        timeoutReason: () => deadlineFailure,
        report: this.#report
      }),
      deadlineFailure,
      backend: this.#backend,
      report: this.#report,
      waitedMs: 0,
      logicalWaitedMs: 0,
      conflicts: 0
    }
    this.#admission = ConcurrencyAdmission.try
    this.#executionContext = request.executeAttempt
      ? { ...this.#extensions, ...this.#context, signal: this.#budget.cancellation.signal }
      : undefined
  }
  /** Derive only new fixed-input keys; native/inherited identity facts stay on their original owner. */
  #derivePreparedLocks(captured = this.#context!): void {
    if (!this.#request.lock) return
    /** Only new keys are captured and encoded; inherited normalized entries remain unchanged. */
    let additional: readonly ILockKey[]
    try {
      additional = this.#request.lock(captured)
    } catch (cause) {
      if (IdentifyError.identityOf(cause)) throw cause
      throw invalidConcurrencyArgument(cause)
    }
    /** Stable sorting retains the original entry when an implicit lock duplicates an explicit one. */
    const normalized = normalizeLockKeys(additional, this.#backend)
    if (normalized.length > 0)
      this.#locks = uniqueNormalizedLockKeys([...(this.#locks ?? []), ...normalized])
  }
  /** Create a segment only when the actual original executeAttempt stage is ready to run. */
  #startAttemptExecution(): IAttemptExecution<TResult> {
    return new ConcurrencyAttemptExecution({
      execute: (invoke) => this.#request.executeAttempt!(this.#executionContext!, invoke),
      prepare: () => this.#prepareExecution()
    })
  }
  /** Replays derive from the caller’s original lock set and the same running budget. */
  #prepareExecution(): StorageContractError | undefined {
    const aborted = concurrencyAbort(this.#budget, false)
    if (aborted) return aborted
    this.#locks = this.#originalLocks
    this.#derivePreparedLocks(this.#executionContext!)
    this.#identities =
      this.#locks === this.#inherited?.locks && this.#inherited
        ? this.#inherited.identities
        : snapshotLockIdentities(this.#locks)
    return undefined
  }
  /** Preserve preparation, outer pipeline and cleanup within the one original call budget. */
  async run(): Promise<Awaited<TResult>> {
    try {
      if (this.#request.prepare) {
        /** An already canceled call starts neither its pipeline nor a native attempt. */
        const beforePreparation = concurrencyAbort(this.#budget, false)
        if (beforePreparation) throw beforePreparation
        /**
         * The original fields stay captured; only this owner supplies the running cancellation
         * signal.
         */
        const preparationContext = {
          ...this.#extensions,
          ...this.#context,
          signal: this.#budget.cancellation.signal
        }
        await this.#request.prepare(preparationContext)
        /** Accepted preparation settles before cancellation can release this call's signal owner. */
        const afterPreparation = concurrencyAbort(this.#budget, false)
        if (afterPreparation) throw afterPreparation
        if (!this.#request.execute && !this.#request.executeAttempt)
          this.#derivePreparedLocks(preparationContext)
        this.#identities =
          this.#locks === this.#inherited?.locks && this.#inherited
            ? this.#inherited.identities
            : snapshotLockIdentities(this.#locks)
      }
      if (this.#request.execute) {
        /** Pre-canceled calls start neither an outer pipeline nor native work. */
        const beforeExecution = concurrencyAbort(this.#budget, false)
        if (beforeExecution) throw beforeExecution
        /** After-next and catch stay around actual native settlement under the original call budget. */
        const logicalExecutionContext = {
          ...this.#extensions,
          ...this.#context,
          signal: this.#budget.cancellation.signal
        }
        return (await this.#request.execute(logicalExecutionContext, () =>
          this.#invokeOriginalLoop(logicalExecutionContext)
        )) as Awaited<TResult>
      }
      return await this.#runOriginalLoop()
    } catch (cause) {
      if (!this.#execution) throw cause
      /** Cancellation, native and policy errors also await the original stage's actual unwind. */
      this.#execution.reject(cause)
      const completed = await this.#execution.completed
      if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
      throw completed.cause
    } finally {
      if (!this.#inherited?.budget) this.#budget.cancellation.dispose()
    }
  }
  /** Admit the outer pipeline terminal once before deriving actual fixed-input keys. */
  #invokeOriginalLoop(context: IOperationContext): Promise<Awaited<TResult>> {
    if (this.#outerInvoked) return Promise.reject(invalidConcurrencyArgument())
    this.#outerInvoked = true
    /** Expired before-next work never derives keys or opens a native attempt. */
    const aborted = concurrencyAbort(this.#budget, false)
    if (aborted) return Promise.reject(aborted)
    this.#derivePreparedLocks(context)
    this.#identities =
      this.#locks === this.#inherited?.locks && this.#inherited
        ? this.#inherited.identities
        : snapshotLockIdentities(this.#locks)
    return this.#runOriginalLoop()
  }
  /** The original logical attempt/decision loop is the sole owner of retry admission. */
  async #runOriginalLoop(): Promise<Awaited<TResult>> {
    while (true) {
      if (this.#request.executeAttempt && !this.#execution) {
        /** Cancellation before a fresh stage cannot start another pipeline or native attempt. */
        const beforeExecution = concurrencyAbort(this.#budget, false)
        if (beforeExecution) throw beforeExecution
        this.#execution = this.#startAttemptExecution()
        await this.#execution.ready
        if (!this.#execution.entered) {
          /** A legal stage halt/recovery may complete without ever calling its terminal. */
          const completed = await this.#execution.completed
          this.#execution = undefined
          if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
          throw completed.cause
        }
      }
      /** Cancellation before resource admission starts no native attempt. */
      const aborted = concurrencyAbort(this.#budget, false)
      if (aborted) throw aborted
      /** The original attempt metadata is present only while this actual native call is live. */
      const attemptContext = this.#attemptContext()
      concurrencyAttemptBudgets.set(attemptContext, {
        budget: this.#budget,
        locks: this.#locks,
        identities: this.#identities
      })
      /** No handler means no argument array or event payload is created. */
      const beforeAcquire = readConcurrencyStage(this.#stages, 'beforeLockAcquire')
      if (beforeAcquire)
        observeConcurrencyResult(this.#stages!, 'beforeLockAcquire', [
          this.#policy.name,
          this.#locks?.length ?? 0
        ])
      /**
       * Cleanup completion precedes every policy decision; abort never detaches accepted native
       * work.
       */
      let result: IConcurrencyAttempt<TResult>
      try {
        result = await this.#port.attempt(attemptContext)
      } finally {
        concurrencyAttemptBudgets.delete(attemptContext)
      }
      if (result.status === ConcurrencyAttemptStatus.committed) {
        /** The stage's after-next path observes the actual committed value, then fully settles. */
        const value = await result.value
        if (!this.#execution) return value
        this.#execution.resolve(value)
        const completed = await this.#execution.completed
        this.#execution = undefined
        if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
        throw completed.cause
      }
      if (this.#execution && result.phase === ConcurrencyPhase.commit) {
        /** Absent or uncoded causes need one explicit boundary identity before stage intervention. */
        const failure = IdentifyError.identityOf(result.cause)
          ? result.cause
          : new StorageContractError(StorageContractErrorCode.writeConflict, {
              backend: this.#backend,
              cause: result.cause
            })
        this.#execution.reject(failure)
        const completed = await this.#execution.completed
        this.#execution = undefined
        if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
        if (completed.cause !== failure) throw completed.cause
        /** A policy rejection retains the same coded boundary the stage actually observed. */
        if (failure !== result.cause) result = { ...result, cause: failure }
      }
      /** A backend can report conflict only after finishing rollback and resource cleanup. */
      const afterAttemptAbort = concurrencyAbort(this.#budget, false)
      if (afterAttemptAbort) throw afterAttemptAbort
      this.#budget.conflicts += 1
      this.#lastConflict = {
        keys: result.keys.map((key) => snapshotLockKey(key, this.#backend)),
        holder: result.holder
      }
      /** Conflict observations run after the complete backend attempt has ended. */
      const onConflict = readConcurrencyStage(this.#stages, 'onLockConflict')
      if (onConflict)
        observeConcurrencyResult(this.#stages!, 'onLockConflict', [
          result.phase,
          this.#budget.conflicts,
          result.keys.length,
          result.holder
        ])
      /** Policy work begins only after native rollback/resource cleanup has completed. */
      const decision = await this.#decide(result)
      /** Decision observations cannot veto, delay or rewrite the captured action. */
      const onDecision = readConcurrencyStage(this.#stages, 'onConcurrencyDecision')
      if (onDecision)
        observeConcurrencyResult(this.#stages!, 'onConcurrencyDecision', [
          decision.action,
          this.#budget.conflicts
        ])
      /** A wait decision remains synchronous; only the original retry delay yields here. */
      const retry = this.#applyDecision(decision, result)
      if (retry) await retry
    }
  }
  /** Construct one native attempt using the original budget and already-normalized lock images. */
  #attemptContext(): IConcurrencyAttemptContext {
    /** Captured native fields are forwarded while the original deadline remains owned here. */
    const { timeoutMs: _originalTimeout, ...fields } = this.#context ?? {}
    /**
     * Every real attempt gets detached keys so a previous borrowed view cannot mutate future
     * identity.
     */
    const attemptContext: IConcurrencyAttemptContext = {
      ...this.#extensions,
      ...fields,
      signal: this.#budget.cancellation.signal,
      lock: this.#locks?.map((entry) => snapshotLockKey(entry.key, this.#backend)),
      concurrency: this.#capturedOverride,
      attempt: this.#budget.conflicts + 1,
      admission: this.#admission,
      locking: this.#policy.locking,
      waitTimeoutMs:
        this.#logicalTimeoutMs === undefined
          ? undefined
          : Math.max(0, this.#logicalTimeoutMs - this.#budget.logicalWaitedMs),
      wait: (pending) =>
        waitForConcurrency(
          this.#budget,
          pending,
          ConcurrencyWaitKind.logical,
          this.#logicalTimeoutMs,
          this.#lastConflict?.keys ?? attemptContext.lock ?? [],
          this.#lastConflict?.holder
        ),
      waitPhysical: (pending) =>
        waitForConcurrency(
          this.#budget,
          pending,
          ConcurrencyWaitKind.physical,
          undefined,
          attemptContext.lock ?? [],
          undefined
        )
    }
    return attemptContext
  }
  /** Await the real policy through utils cancellation and validate only its supported result fields. */
  async #decide(
    result: Extract<IConcurrencyAttempt<TResult>, { status: 'conflict' }>
  ): Promise<IConcurrencyDecision> {
    /** Each callback receives independent key components; policy mutation grants no lock authority. */
    const conflict: IConcurrencyConflict = {
      phase: result.phase,
      keys: this.#lastConflict!.keys.map((key) => snapshotLockKey(key, this.#backend)),
      attempt: this.#budget.conflicts,
      waitedMs: this.#budget.waitedMs,
      holder: result.holder,
      signal: this.#budget.cancellation.signal
    }
    /** Policy callbacks run only after real conflicts and outside every active native attempt. */
    try {
      return readConcurrencyDecision(
        await raceWithAbort(() => readConcurrencyPolicy(this.#policy)!(conflict), {
          signal: this.#budget.cancellation.signal,
          report: this.#report
        }),
        result.phase
      )
    } catch (cause) {
      /** Cancellation is distinct from a failed user policy and preserves the first abort reason. */
      const policyAbort = concurrencyAbort(this.#budget, false)
      if (policyAbort) throw policyAbort
      throw new StorageContractError(StorageContractErrorCode.concurrencyPolicyFailed, {
        backend: this.#backend,
        cause
      })
    }
  }
  /** Apply a real wait/reject/retry decision after the original native stage has fully settled. */
  #applyDecision(
    decision: IConcurrencyDecision,
    result: Extract<IConcurrencyAttempt<TResult>, { status: 'conflict' }>
  ): Promise<void> | undefined {
    if (decision.action === ConcurrencyAction.reject) {
      if (result.phase === ConcurrencyPhase.acquire)
        throw concurrencyLockFailure(
          StorageContractErrorCode.lockRejected,
          this.#backend,
          this.#lastConflict!.keys,
          this.#lastConflict!.holder,
          result.cause
        )
      throw new StorageContractError(StorageContractErrorCode.writeConflict, {
        backend: this.#backend,
        cause: result.cause
      })
    }
    if (decision.action === ConcurrencyAction.wait) {
      this.#logicalTimeoutMs = decision.timeoutMs
      if (
        this.#logicalTimeoutMs !== undefined &&
        this.#budget.logicalWaitedMs >= this.#logicalTimeoutMs
      )
        throw concurrencyLockFailure(
          StorageContractErrorCode.lockTimeout,
          this.#backend,
          this.#lastConflict!.keys,
          this.#lastConflict!.holder,
          result.cause
        )
      this.#admission = ConcurrencyAdmission.wait
      /** Waiting statistics refer only to the shared measured admission intervals. */
      const onWait = readConcurrencyStage(this.#stages, 'onLockWait')
      if (onWait)
        observeConcurrencyResult(this.#stages!, 'onLockWait', [
          this.#budget.conflicts,
          this.#budget.waitedMs
        ])
    } else {
      this.#admission = ConcurrencyAdmission.try
      /** Retry observation happens after rollback/cleanup and before the original utils delay. */
      const onRetry = readConcurrencyStage(this.#stages, 'onRetry')
      if (onRetry)
        observeConcurrencyResult(this.#stages!, 'onRetry', [
          this.#budget.conflicts,
          decision.delayMs ?? 0,
          result.phase === ConcurrencyPhase.commit ? 'write-conflict' : undefined
        ])
      return this.#retry(decision.delayMs ?? 0)
    }
    return undefined
  }
  /** The existing utility owns retry delay cancellation and its original first reason. */
  async #retry(delayMs: number): Promise<void> {
    try {
      await sleep(delayMs, { signal: this.#budget.cancellation.signal })
    } catch (cause) {
      throw concurrencyAbort(this.#budget, false) ?? cause
    }
  }
}

/** Execute the original logical concurrency owner without a second queue, budget or retry loop. */
export async function runWithConcurrency<TResult>(
  request: IConcurrencyRequest<TResult>,
  port: IConcurrencyPort<TResult>
): Promise<Awaited<TResult>> {
  return await new ConcurrencyRunner(request, port).run()
}
