import {
  createAbortTimeoutSignal,
  raceWithAbort,
  sleep,
  withTimeout,
  hostRethrowReporter,
  type IAbortTimeoutSignal,
  type IUtilsReporter
} from '@migaia/utils/promise'
import { isUtilsAbortError, isUtilsTimeoutError } from '@migaia/utils/error'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { systemScheduler } from '@migaia/utils/scheduler'
import { snapshotOperationContext } from './operation-context.js'
import { readTransactionConcurrency } from './transaction.js'
import type { IStorageBase } from './store.js'
import { snapshotStorageKey, assertStringStorageKey } from './key.js'
import { encodeOrderedStorageKey } from './key-order.js'
import type { IBackendKind } from './capabilities.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'
import type { StorageStageKind } from './stage-kind.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IOperationContext, IStorageKey } from './context.js'

/** Physical channel identities used by the original transaction and concurrency owners. */
export type ILockKey =
  | { readonly channel: 'text'; readonly key: IStorageKey }
  | { readonly channel: 'bytes'; readonly key: string }
  | { readonly channel: 'record'; readonly key: IStorageKey }

/** Public policy metadata; these fields do not grant runtime policy authority. */
export type IConcurrencyPolicy = {
  readonly name: string
  readonly locking: 'pessimistic' | 'optimistic'
}

/** One transaction uses the original operation timing, declared locks and selected policy. */
export type ITransactionOptions = IOperationContext & {
  readonly lock?: readonly ILockKey[]
  readonly concurrency?: IConcurrencyPolicy
}

/** A root write can override the original owner's concurrency policy. */
export type IWriteConcurrencyOptions = { readonly concurrency?: IConcurrencyPolicy }

/** An unlocked builder carries augmentation but exposes no execution method. */
export type ITransactionBuilder<TScope, TAugmentMethods extends object = Record<never, never>> = {
  lock(
    first: ILockKey,
    ...rest: readonly ILockKey[]
  ): ILockedTransactionBuilder<TScope, TAugmentMethods>
  concurrency(policy: IConcurrencyPolicy): ITransactionBuilder<TScope, TAugmentMethods>
  signal(signal: IAbortSignal): ITransactionBuilder<TScope, TAugmentMethods>
  timeout(ms: number): ITransactionBuilder<TScope, TAugmentMethods>
} & TAugmentMethods

/** Declaring a lock enables the original transaction terminal while retaining every augmentation. */
export type ILockedTransactionBuilder<
  TScope,
  TAugmentMethods extends object = Record<never, never>
> = {
  lock(
    first: ILockKey,
    ...rest: readonly ILockKey[]
  ): ILockedTransactionBuilder<TScope, TAugmentMethods>
  concurrency(policy: IConcurrencyPolicy): ILockedTransactionBuilder<TScope, TAugmentMethods>
  signal(signal: IAbortSignal): ILockedTransactionBuilder<TScope, TAugmentMethods>
  timeout(ms: number): ILockedTransactionBuilder<TScope, TAugmentMethods>
  run<TResult>(run: (scope: TScope) => TResult): Promise<Awaited<TResult>>
} & TAugmentMethods

/** A handoff interval never borrows the previous holder's identity. */
export const ConcurrencyHolderState = { held: 'held', handingOff: 'handing-off' } as const
/** Holder state names share the canonical runtime declaration. */
export type ConcurrencyHolderState = keyof typeof ConcurrencyHolderState
/** Real holder metadata stays distinct from the permitted remote handoff interval. */
export type IConcurrencyHolder =
  | {
      readonly status: typeof ConcurrencyHolderState.held
      readonly owner: string
      readonly label?: string
      readonly pid?: number
      readonly since: number
      readonly scope: 'local' | 'remote'
    }
  | {
      readonly status: typeof ConcurrencyHolderState.handingOff
      readonly scope: 'remote'
      readonly owner?: never
      readonly label?: never
      readonly pid?: never
      readonly since?: never
    }
/** Incompatible policy fields are excluded before the runtime owner checks a decision. */
export type IConcurrencyDecision =
  | { readonly action: 'wait'; readonly timeoutMs?: number; readonly delayMs?: never }
  | { readonly action: 'reject'; readonly timeoutMs?: never; readonly delayMs?: never }
  | { readonly action: 'retry'; readonly delayMs?: number; readonly timeoutMs?: never }
/** Observations reuse the original host registry and grant no lock or retry authority. */
export type IConcurrencyStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.concurrency
  beforeLockAcquire?: (policyName: string, keyCount: number) => void | PromiseLike<void>
  onLockAcquired?: (attempt: number, keyCount: number) => void | PromiseLike<void>
  onLockConflict?: (
    phase: 'acquire' | 'commit',
    attempt: number,
    keyCount: number,
    holder: IConcurrencyHolder | undefined
  ) => void | PromiseLike<void>
  onLockWait?: (attempt: number, waitedMs: number) => void | PromiseLike<void>
  onConcurrencyDecision?: (
    action: IConcurrencyDecision['action'],
    attempt: number
  ) => void | PromiseLike<void>
  onRetry?: (
    attempt: number,
    delayMs: number,
    reason?: 'physical' | 'write-conflict'
  ) => void | PromiseLike<void>
  onLockReleased?: (attempt: number, keyCount: number) => void | PromiseLike<void>
  onLockLost?: (attempt: number, keyCount: number) => void | PromiseLike<void>
  beforeLockInspect?: () => void | PromiseLike<void>
  afterLockInspect?: (count: number) => void | PromiseLike<void>
  onLockInspectError?: (code?: string) => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>

/** Public conflict data contains identity only; each actual decision receives fresh key snapshots. */
type IConcurrencyConflictData = {
  readonly keys: readonly ILockKey[]
  readonly attempt: number
  readonly waitedMs: number
  readonly holder: IConcurrencyHolder | undefined
  readonly signal?: IAbortSignal
}
/** Phase discrimination keeps acquisition and completed-rollback conflicts explicit. */
export type IConcurrencyConflict = IConcurrencyConflictData &
  ({ readonly phase: 'acquire' } | { readonly phase: 'commit' })
/** A lock inspection row describes lease expiry without claiming a remote process is dead. */
export type ILockHolding = {
  readonly key: ILockKey
  readonly holder: IConcurrencyHolder
  readonly expired: boolean
  readonly expiresAt?: number
}
/** One captured callback belongs to one authentic policy identity and stays private. */
type IConcurrencyDecide = (
  conflict: IConcurrencyConflict
) => IConcurrencyDecision | Promise<IConcurrencyDecision>
/** The sole policy registry proves identity and captures its original callback in the same lookup. */
const concurrencyPolicies = new WeakMap<IConcurrencyPolicy, IConcurrencyDecide>()
/** Canonical locking values are shared by policy validation and the original decision loop. */
const ConcurrencyLocking = { pessimistic: 'pessimistic', optimistic: 'optimistic' } as const
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

/** Produces the existing coded argument boundary without executing policy callbacks. */
function invalidConcurrencyArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { cause },
    StorageContractErrorText.concurrencyArgument
  )
}
/** Internal identity admission is reused by the original transaction owner and decision loop. */
export function assertConcurrencyPolicy(policy: unknown): asserts policy is IConcurrencyPolicy {
  if (
    typeof policy !== 'object' ||
    policy === null ||
    !concurrencyPolicies.has(policy as IConcurrencyPolicy)
  )
    throw invalidConcurrencyArgument()
}
/** Captures three definition fields exactly once and publishes only immutable public metadata. */
export function defineConcurrencyPolicy<
  const TName extends string,
  const TLocking extends IConcurrencyPolicy['locking']
>(definition: {
  readonly name: TName
  readonly locking: TLocking
  readonly decide: IConcurrencyDecide
}): IConcurrencyPolicy & { readonly name: TName; readonly locking: TLocking } {
  if (typeof definition !== 'object' || definition === null || Array.isArray(definition))
    throw invalidConcurrencyArgument()
  /** Field getters are the only borrowed work in definition admission. */
  let captured: { name: TName; locking: TLocking; decide: IConcurrencyDecide }
  try {
    captured = { name: definition.name, locking: definition.locking, decide: definition.decide }
  } catch (cause) {
    throw invalidConcurrencyArgument(cause)
  }
  /** Validation cannot confuse a source-thrown coded error with this boundary's own error. */
  const { name, locking, decide } = captured
  if (
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    (locking !== ConcurrencyLocking.pessimistic && locking !== ConcurrencyLocking.optimistic) ||
    typeof decide !== 'function'
  )
    throw invalidConcurrencyArgument()
  /** Policy metadata carries no public callback or mutable configuration. */
  const policy = Object.freeze({ name, locking })
  concurrencyPolicies.set(policy, decide)
  return policy
}
/** Preset options are ordinary records; every admitted duration/count is a nonnegative safe integer. */
function policyNumber(value: unknown, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw invalidConcurrencyArgument()
  return value
}
/** Rejects unsupported option containers before invoking any getter or policy callback. */
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
    /** Capture the borrowed field separately so even coded accessor errors remain the exact cause. */
    let suppliedTimeout: number | undefined
    try {
      suppliedTimeout = options?.timeoutMs
    } catch (cause) {
      throw invalidConcurrencyArgument(cause)
    }
    /** Logical wait budget never becomes a physical database timeout. */
    const timeoutMs = policyNumber(suppliedTimeout, DEFAULT_LOCK_WAIT_MS)
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
    /** Capture both numeric fields once before either preset value is admitted. */
    let suppliedRetries: number | undefined
    /** Backoff remains independent of the real-conflict count. */
    let suppliedBackoff: number | undefined
    try {
      suppliedRetries = options?.retries
      suppliedBackoff = options?.backoffMs
    } catch (cause) {
      throw invalidConcurrencyArgument(cause)
    }
    /** Real conflict sequence counts from one; zero disables strategy retries. */
    const retries = policyNumber(suppliedRetries, DEFAULT_OPTIMISTIC_RETRIES)
    /** Backoff is captured independently and never reads mutable caller configuration again. */
    const backoffMs = policyNumber(suppliedBackoff, DEFAULT_OPTIMISTIC_BACKOFF_MS)
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

/** Existing physical channel order precedes the canonical key encoding, never its own key tags. */
const LockChannel = { text: 'text', bytes: 'bytes', record: 'record' } as const
/** Disjoint channel markers prevent equal user keys in different channels from colliding. */
const LockChannelRank = { text: 1, bytes: 2, record: 3 } as const
/** Internal snapshots retain independently owned canonical bytes across all actual attempts. */
export type INormalizedLockKey = { readonly key: ILockKey; readonly encoded: Uint8Array }
/** Explicit stack frames visit only still-shared suffixes rather than maximum-length padding. */
type ILockRadixFrame = { readonly start: number; readonly end: number; readonly depth: number }
/** Byte values occupy 1..256; bucket zero is reserved for a genuinely ended encoding. */
const LOCK_RADIX_BUCKETS = 257

/** Builds the existing coded lock-argument boundary with an optional actual backend diagnostic. */
function invalidLockArgument(
  backend: IBackendKind | undefined,
  cause?: unknown
): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend, cause },
    StorageContractErrorText.lockArgument
  )
}
/** Captures one lock container and reuses the canonical key-domain snapshot, never object identity. */
export function snapshotLockKey(value: unknown, backend: IBackendKind | undefined): ILockKey {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalidLockArgument(backend)
  /** Channel and key accessors are borrowed once before validation or copying. */
  let channel: unknown
  /** Key failures remain distinct from malformed lock-container failures. */
  let key: unknown
  try {
    channel = (value as { channel?: unknown }).channel
    key = (value as { key?: unknown }).key
  } catch (cause) {
    throw invalidLockArgument(backend, cause)
  }
  if (channel === LockChannel.bytes) {
    assertStringStorageKey(key, backend)
    return Object.freeze({ channel, key })
  }
  if (channel === LockChannel.text || channel === LockChannel.record)
    return Object.freeze({ channel, key: snapshotStorageKey(key, backend) })
  throw invalidLockArgument(backend)
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
  }
})
/** Adds only channel identity around the sole canonical ordered-key encoder. */
function encodeLockIdentity(key: ILockKey, backend: IBackendKind): Uint8Array {
  /** Key-order owns every key tag and self-delimiting scalar/array representation. */
  const ordered = encodeOrderedStorageKey(key.key, backend)
  /** One channel marker keeps the original text < bytes < record order. */
  const encoded = new Uint8Array(ordered.length + 1)
  encoded[0] = LockChannelRank[key.channel]
  encoded.set(ordered, 1)
  return encoded
}
/** Stable MSD buckets process each present suffix byte a constant number of times. */
function sortLockIdentities(entries: INormalizedLockKey[]): void {
  if (entries.length < 2) return
  /** One shared scratch array serves every disjoint frame, without copying prefixes. */
  const scratch: INormalizedLockKey[] = []
  scratch.length = entries.length
  /** Fixed alphabet state is reused for every frame instead of retained per depth. */
  const counts = new Uint32Array(LOCK_RADIX_BUCKETS)
  /** Write positions are independently advanced while stable scattering fills the scratch region. */
  const positions = new Uint32Array(LOCK_RADIX_BUCKETS)
  /** LIFO suffix work avoids call-stack growth for long equal prefixes. */
  const frames: ILockRadixFrame[] = [{ start: 0, end: entries.length, depth: 0 }]
  while (frames.length > 0) {
    /** Frames are disjoint at this depth and never include an already ended key. */
    const { start, end, depth } = frames.pop()!
    counts.fill(0)
    for (let index = start; index < end; index += 1) {
      /** Actual zero bytes stay ordinary content; only absence enters the terminator bucket. */
      const encoded = entries[index]!.encoded
      counts[depth < encoded.length ? encoded[depth]! + 1 : 0] += 1
    }
    /** Bucket boundaries use absolute array positions, independent of key length. */
    let boundary = start
    for (let bucket = 0; bucket < LOCK_RADIX_BUCKETS; bucket += 1) {
      positions[bucket] = boundary
      boundary += counts[bucket]!
    }
    for (let index = start; index < end; index += 1) {
      /** Stable movement retains the first snapshot when duplicate identities later collapse. */
      const entry = entries[index]!
      /** End-of-key has its own bucket and cannot be confused with embedded binary zero. */
      const bucket = depth < entry.encoded.length ? entry.encoded[depth]! + 1 : 0
      scratch[positions[bucket]!] = entry
      positions[bucket] += 1
    }
    for (let index = start; index < end; index += 1) entries[index] = scratch[index]!
    boundary = start + counts[0]!
    for (let bucket = 1; bucket < LOCK_RADIX_BUCKETS; bucket += 1) {
      /** Singleton and terminated ranges need no further byte inspection. */
      const size = counts[bucket]!
      if (size > 1) frames.push({ start: boundary, end: boundary + size, depth: depth + 1 })
      boundary += size
    }
  }
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
  /** Capture array length once so accessor side effects cannot extend this admission loop. */
  let length: number
  try {
    length = keys.length
  } catch (cause) {
    throw invalidLockArgument(backend, cause)
  }
  if (!Number.isSafeInteger(length) || length < 0) throw invalidLockArgument(backend)
  for (let index = 0; index < length; index += 1) {
    /** Array getters can fail separately from a lock's channel/key fields. */
    let value: unknown
    try {
      value = keys[index]
    } catch (cause) {
      throw invalidLockArgument(backend, cause)
    }
    /** Invalid or sparse entries fail through the same lock-container admission. */
    const key = snapshotLockKey(value, backend)
    entries.push(Object.freeze({ key, encoded: encodeLockIdentity(key, backend) }))
  }
  sortLockIdentities(entries)
  /** Only adjacent canonical identities are compared; mutable object identity never deduplicates. */
  const unique: INormalizedLockKey[] = []
  for (const entry of entries) {
    /** The last retained item is already in canonical order. */
    const previous = unique[unique.length - 1]
    if (!previous || !equalLockIdentity(previous.encoded, entry.encoded)) unique.push(entry)
  }
  return Object.freeze(unique)
}

/** Fixed fields have already been captured by the original option/context admission path. */
const capturedConcurrencyFields = Object.freeze({
  lock: true,
  concurrency: true,
  signal: true,
  timeoutMs: true,
  pageSize: true,
  conflictPolicy: true,
  orgId: true
})
/** Captures backend extension fields once without re-reading any admitted fixed-field getter. */
function snapshotConcurrencyExtensions(options: ITransactionOptions): object {
  /** Plain owned properties preserve native option values and symbol fields on every attempt. */
  const extensions = {}
  try {
    for (const key of Reflect.ownKeys(options)) {
      if (Object.hasOwn(capturedConcurrencyFields, key)) continue
      Object.defineProperty(extensions, key, { value: Reflect.get(options, key), enumerable: true })
    }
  } catch (cause) {
    throw invalidConcurrencyArgument(cause)
  }
  return extensions
}

/** A conflict can escape a backend only after its native work, rollback and resources have ended. */
export type IConcurrencyAttempt<TResult> =
  | { readonly status: 'committed'; readonly value: TResult }
  | {
      readonly status: 'conflict'
      readonly phase: 'acquire' | 'commit'
      readonly keys: readonly ILockKey[]
      readonly holder: IConcurrencyHolder | undefined
      readonly cause?: unknown
    }
/** Each backend attempt borrows the same operation signal and records only real admission waits. */
export type IConcurrencyAttemptContext = ITransactionOptions & {
  readonly admission: 'try' | 'wait'
  readonly locking: IConcurrencyPolicy['locking']
  readonly waitTimeoutMs?: number
  wait<T>(pendingAdmission: Promise<T>): Promise<T>
  waitPhysical<T>(pendingAdmission: Promise<T>): Promise<T>
}
/** The backend retains ownership of native attempt termination and resource cleanup. */
export type IConcurrencyPort<TResult> = {
  attempt(context: IConcurrencyAttemptContext): Promise<IConcurrencyAttempt<TResult>>
}
/** Canonical attempt states stay with the original concurrency loop. */
const ConcurrencyAttemptStatus = { committed: 'committed', conflict: 'conflict' } as const
/** Only an actual policy decision can change a subsequent attempt to waiting admission. */
const ConcurrencyAdmission = { try: 'try', wait: 'wait' } as const
/** Acquisition refusal and completed-rollback conflicts have distinct public failure codes. */
const ConcurrencyPhase = { acquire: 'acquire', commit: 'commit' } as const
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
  concurrencyAttemptBudgets.set(options, { locks })
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
/** Invokes one already-selected observation with its original receiver and captured then semantics. */
function observeConcurrencyResult(
  stages: IConcurrencyStageObserver,
  handler: (...args: never[]) => unknown,
  args: readonly unknown[]
): void {
  try {
    /** Callback invocation and captured then admission share the same report-only failure boundary. */
    const result = Reflect.apply(handler, stages, args)
    observeThenableRejection(result, inspectThenable(result), (error) => stages.report(error))
  } catch (error) {
    reportConcurrencyFailure(stages, error)
  }
}
/** Live stage selection returns undefined without constructing an argument array or payload. */
function readConcurrencyStage<
  TName extends Exclude<keyof IConcurrencyStageObserver, 'kind' | 'report'>
>(stages: IConcurrencyStageObserver | undefined, name: TName): IConcurrencyStageObserver[TName] {
  if (!stages) return undefined
  try {
    return stages[name]
  } catch (error) {
    reportConcurrencyFailure(stages, error)
    return undefined
  }
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
  const snapshot = Object.freeze(keys.map((key) => snapshotLockKey(key, backend)))
  /** Canonical bytes retain binary identity while JSON keeps ordinary logical keys readable. */
  const keyDescription =
    holder === undefined
      ? undefined
      : JSON.stringify(
          snapshot.map((key) => ({
            ...key,
            encoded: Array.from(encodeOrderedStorageKey(key.key, backend), (byte) =>
              byte.toString(16).padStart(2, '0')
            ).join('')
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
  /** Reason getter failures remain the exact externally supplied reason failure. */
  let reason: unknown
  try {
    reason = signal.reason
  } catch (cause) {
    reason = cause
  }
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
      /** Structural reason getters may fail; the original late rejection must still be reported. */
      let acknowledgement = false
      try {
        acknowledgement = error === budget.cancellation.signal?.reason
      } catch {
        /* A failed reason read cannot acknowledge this rejection. */
      }
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
function snapshotConcurrencyDecision(
  value: unknown,
  phase: IConcurrencyConflict['phase']
): IConcurrencyDecision {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(StorageContractErrorText.concurrencyDecision)
  /** A changing result cannot supply different action/budget fields during validation and use. */
  const { action, timeoutMs, delayMs } = value as IConcurrencyDecision
  if (action === ConcurrencyAction.reject && timeoutMs === undefined && delayMs === undefined)
    return { action }
  if (
    action === ConcurrencyAction.wait &&
    phase === ConcurrencyPhase.acquire &&
    delayMs === undefined &&
    (timeoutMs === undefined || (Number.isFinite(timeoutMs) && timeoutMs >= 0))
  )
    return { action, timeoutMs }
  if (
    action === ConcurrencyAction.retry &&
    timeoutMs === undefined &&
    (delayMs === undefined || (Number.isFinite(delayMs) && delayMs >= 0))
  )
    return { action, delayMs }
  throw new TypeError(StorageContractErrorText.concurrencyDecision)
}
/**
 * Runs the only logical decision/retry loop. A port attempt is always awaited to its actual native
 * terminal and cleanup before cancellation, a policy decision, or another attempt can finish. The
 * supplied genuine policy is the sole effective policy; callers resolve captured overrides through
 * the original transaction owner. Nested calls receiving the exact attempt context borrow its
 * budget and signal; only the outermost call releases that signal.
 */
export async function runWithConcurrency<TResult>(
  request: {
    readonly store: IStorageBase
    readonly options: ITransactionOptions
    readonly policy: IConcurrencyPolicy
  },
  port: IConcurrencyPort<TResult>
): Promise<Awaited<TResult>> {
  /** Overall deadlines start at public entry, including synchronous argument admission work. */
  const startedAt = systemScheduler.now()
  /** The original registration supplies immutable diagnostics and the host's sole stage binding. */
  const { backend, stages } = readTransactionConcurrency(request.store)
  assertConcurrencyPolicy(request.policy)
  if (
    typeof request.options !== 'object' ||
    request.options === null ||
    Array.isArray(request.options)
  )
    throw invalidConcurrencyArgument()
  /** Lock and override reflection admission occurs before any cancellation/timing fields are read. */
  let capturedLocks: readonly ILockKey[] | undefined
  /** The override is validated but cannot silently replace the already resolved request policy. */
  let capturedOverride: IConcurrencyPolicy | undefined
  try {
    capturedLocks = request.options.lock
    capturedOverride = request.options.concurrency
  } catch (cause) {
    throw invalidConcurrencyArgument(cause)
  }
  if (capturedOverride !== undefined) assertConcurrencyPolicy(capturedOverride)
  /** The exact outer attempt context carries the one shared budget and encoded lock set. */
  const inherited = concurrencyAttemptBudgets.get(request.options)
  /** The original logical identities are encoded/sorted once, not again on nested entries or retry. */
  const locks = inherited
    ? inherited.locks
    : capturedLocks === undefined
      ? undefined
      : normalizeLockKeys(capturedLocks, backend)
  /** Context snapshots preserve original signal identity, field causes, org identity and omission. */
  const context = snapshotOperationContext(request.options)
  /** Native options remain available to a backend while fixed fields keep their single capture. */
  const extensions = snapshotConcurrencyExtensions(request.options)
  /** Only the original operation creates a diagnostic deadline reason and utils signal owner. */
  const deadlineFailure =
    inherited?.budget?.deadlineFailure ??
    new StorageContractError(StorageContractErrorCode.aborted, { backend })
  /** The existing reporter contains cleanup and late-rejection failures without changing outcomes. */
  const report: IUtilsReporter =
    inherited?.budget?.report ?? ((error) => reportConcurrencyFailure(stages, error))
  /** Remaining overall time includes admission work and is never reset by nested attempts. */
  const budget: IConcurrencyBudget = inherited?.budget ?? {
    cancellation: createAbortTimeoutSignal({
      signal: context?.signal,
      timeoutMs:
        context?.timeoutMs === undefined
          ? undefined
          : Math.max(0, context.timeoutMs - (systemScheduler.now() - startedAt)),
      timeoutReason: () => deadlineFailure,
      report
    }),
    deadlineFailure,
    backend,
    report,
    waitedMs: 0,
    logicalWaitedMs: 0,
    conflicts: 0
  }
  /** Try remains the first admission regardless of a preset's later waiting decision. */
  let admission: IConcurrencyAttemptContext['admission'] = ConcurrencyAdmission.try
  /** Policy-selected total logical budget is separate from the overall call deadline. */
  let logicalTimeoutMs: number | undefined
  /**
   * Last actual acquisition conflict supplies logical-timeout diagnostics, separate from policy
   * mutation.
   */
  let lastConflict: Pick<IConcurrencyConflict, 'keys' | 'holder'> | undefined
  try {
    while (true) {
      /** Cancellation before resource admission starts no native attempt. */
      const aborted = concurrencyAbort(budget, false)
      if (aborted) throw aborted
      /** Captured native fields are forwarded while the original deadline remains owned here. */
      const { timeoutMs: _originalTimeout, ...fields } = context ?? {}
      /**
       * Every real attempt gets detached keys so a previous borrowed view cannot mutate future
       * identity.
       */
      const attemptContext: IConcurrencyAttemptContext = {
        ...extensions,
        ...fields,
        signal: budget.cancellation.signal,
        lock: locks?.map((entry) => snapshotLockKey(entry.key, backend)),
        concurrency: capturedOverride,
        admission,
        locking: request.policy.locking,
        waitTimeoutMs:
          logicalTimeoutMs === undefined
            ? undefined
            : Math.max(0, logicalTimeoutMs - budget.logicalWaitedMs),
        wait: (pending) =>
          waitForConcurrency(
            budget,
            pending,
            ConcurrencyWaitKind.logical,
            logicalTimeoutMs,
            lastConflict?.keys ?? attemptContext.lock ?? [],
            lastConflict?.holder
          ),
        waitPhysical: (pending) =>
          waitForConcurrency(
            budget,
            pending,
            ConcurrencyWaitKind.physical,
            undefined,
            attemptContext.lock ?? [],
            undefined
          )
      }
      concurrencyAttemptBudgets.set(attemptContext, { budget, locks })
      /** No handler means no argument array or event payload is created. */
      const beforeAcquire = readConcurrencyStage(stages, 'beforeLockAcquire')
      if (beforeAcquire)
        observeConcurrencyResult(stages!, beforeAcquire, [request.policy.name, locks?.length ?? 0])
      /**
       * Cleanup completion precedes every policy decision; abort never detaches accepted native
       * work.
       */
      let result: IConcurrencyAttempt<TResult>
      try {
        result = await port.attempt(attemptContext)
      } finally {
        concurrencyAttemptBudgets.delete(attemptContext)
      }
      if (result.status === ConcurrencyAttemptStatus.committed) return await result.value
      /** A backend can report conflict only after finishing rollback and resource cleanup. */
      const afterAttemptAbort = concurrencyAbort(budget, false)
      if (afterAttemptAbort) throw afterAttemptAbort
      budget.conflicts += 1
      lastConflict = {
        keys: result.keys.map((key) => snapshotLockKey(key, backend)),
        holder: result.holder
      }
      /** Conflict observations run after the complete backend attempt has ended. */
      const onConflict = readConcurrencyStage(stages, 'onLockConflict')
      if (onConflict)
        observeConcurrencyResult(stages!, onConflict, [
          result.phase,
          budget.conflicts,
          result.keys.length,
          result.holder
        ])
      /**
       * Each callback receives independent key components; policy mutation grants no lock
       * authority.
       */
      const conflict: IConcurrencyConflict = {
        phase: result.phase,
        keys: lastConflict.keys.map((key) => snapshotLockKey(key, backend)),
        attempt: budget.conflicts,
        waitedMs: budget.waitedMs,
        holder: result.holder,
        signal: budget.cancellation.signal
      }
      /** Policy callbacks run only after real conflicts and outside every active native attempt. */
      let decision: IConcurrencyDecision
      try {
        decision = snapshotConcurrencyDecision(
          await raceWithAbort(() => concurrencyPolicies.get(request.policy)!(conflict), {
            signal: budget.cancellation.signal,
            report
          }),
          result.phase
        )
      } catch (cause) {
        /** Cancellation is distinct from a failed user policy and preserves the first abort reason. */
        const policyAbort = concurrencyAbort(budget, false)
        if (policyAbort) throw policyAbort
        throw new StorageContractError(StorageContractErrorCode.concurrencyPolicyFailed, {
          backend,
          cause
        })
      }
      /** Decision observations cannot veto, delay or rewrite the captured action. */
      const onDecision = readConcurrencyStage(stages, 'onConcurrencyDecision')
      if (onDecision)
        observeConcurrencyResult(stages!, onDecision, [decision.action, budget.conflicts])
      if (decision.action === ConcurrencyAction.reject) {
        if (result.phase === ConcurrencyPhase.acquire)
          throw concurrencyLockFailure(
            StorageContractErrorCode.lockRejected,
            backend,
            lastConflict.keys,
            lastConflict.holder,
            result.cause
          )
        throw new StorageContractError(StorageContractErrorCode.writeConflict, {
          backend,
          cause: result.cause
        })
      }
      if (decision.action === ConcurrencyAction.wait) {
        logicalTimeoutMs = decision.timeoutMs
        if (logicalTimeoutMs !== undefined && budget.logicalWaitedMs >= logicalTimeoutMs)
          throw concurrencyLockFailure(
            StorageContractErrorCode.lockTimeout,
            backend,
            lastConflict.keys,
            lastConflict.holder,
            result.cause
          )
        admission = ConcurrencyAdmission.wait
        /** Waiting statistics refer only to the shared measured admission intervals. */
        const onWait = readConcurrencyStage(stages, 'onLockWait')
        if (onWait) observeConcurrencyResult(stages!, onWait, [budget.conflicts, budget.waitedMs])
      } else {
        admission = ConcurrencyAdmission.try
        /** Retry observation happens after rollback/cleanup and before the original utils delay. */
        const onRetry = readConcurrencyStage(stages, 'onRetry')
        if (onRetry)
          observeConcurrencyResult(stages!, onRetry, [
            budget.conflicts,
            decision.delayMs ?? 0,
            result.phase === ConcurrencyPhase.commit ? 'write-conflict' : undefined
          ])
        try {
          await sleep(decision.delayMs ?? 0, { signal: budget.cancellation.signal })
        } catch (cause) {
          throw concurrencyAbort(budget, false) ?? cause
        }
      }
    }
  } finally {
    if (!inherited?.budget) budget.cancellation.dispose()
  }
}
