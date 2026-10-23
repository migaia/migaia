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
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { systemScheduler } from '@migaia/utils/scheduler'
import { snapshotOperationContext } from './operation-context.js'
import { readTransactionConcurrency, resolveConcurrencyPolicy } from './transaction.js'
import type { IStorageBase } from './store.js'
import { snapshotStorageKey, assertStringStorageKey } from './key.js'
import { snapshotStorageRdfQuad, encodeRdfQuadSnapshot, type IQuad } from './capabilities/rdf.js'
import {
  encodeOrderedStorageKey,
  snapshotStorageKeyPrefix,
  storageKeyBytesIdentity,
  sortStorageByteIdentities
} from './key-order.js'
import type { IBackendKind } from './capabilities.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'
import type { StorageStageKind } from './stage-kind.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IConflictPolicy, IOperationContext, IStorageKey } from './context.js'

/** Physical channel identities used by the original transaction and concurrency owners. */
export type ILockKey =
  | { readonly channel: 'text'; readonly key: IStorageKey }
  | { readonly channel: 'bytes'; readonly key: string }
  | { readonly channel: 'record'; readonly key: IStorageKey }
  | { readonly channel: 'vector'; readonly collection: string; readonly id: string }
  | { readonly channel: 'rdf'; readonly quad: IQuad }

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
const LockChannel = {
  text: 'text',
  bytes: 'bytes',
  record: 'record',
  vector: 'vector',
  rdf: 'rdf'
} as const
/** Disjoint channel markers prevent equal user keys in different channels from colliding. */
const LockChannelRank = { text: 1, bytes: 2, record: 3, vector: 4, rdf: 5 } as const
/** Internal snapshots retain independently owned canonical bytes across all actual attempts. */
export type INormalizedLockKey = { readonly key: ILockKey; readonly encoded: Uint8Array }
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
  /** Original key fields retain their existing getter and error order. */
  let key: unknown
  /** Vector locks capture only their exact collection and point fields. */
  let collection: unknown
  /** Strings retain spelling without adding a backend-specific identifier policy. */
  let id: unknown
  /** RDF locks borrow one quad before the canonical term owner detaches it. */
  let quad: IQuad | undefined
  try {
    channel = (value as { channel?: unknown }).channel
    if (channel === LockChannel.vector) {
      collection = (value as { collection?: unknown }).collection
      id = (value as { id?: unknown }).id
    } else if (channel === LockChannel.rdf) quad = (value as { quad: IQuad }).quad
    else key = (value as { key?: unknown }).key
  } catch (cause) {
    throw invalidLockArgument(backend, cause)
  }
  if (channel === LockChannel.vector) {
    assertStringStorageKey(collection, backend)
    assertStringStorageKey(id, backend)
    return Object.freeze({ channel, collection, id })
  }
  if (channel === LockChannel.rdf)
    return Object.freeze({ channel, quad: snapshotStorageRdfQuad(quad!, backend) })
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
  /** Captured length prevents borrowed accessors from extending the snapshot. */
  let length: number
  try {
    length = rows.length
  } catch (cause) {
    throw invalidLockArgument(undefined, cause)
  }
  for (let index = 0; index < length; index += 1) {
    /** Capture the original row fields once before canonical key admission. */
    let captured: ILockHolding
    try {
      /** Each borrowed inspection row is read once before its individual fields. */
      const row = rows[index]!
      captured = {
        key: row.key,
        holder: Object.freeze({ ...row.holder }),
        expired: row.expired,
        expiresAt: row.expiresAt
      }
    } catch (cause) {
      throw invalidLockArgument(undefined, cause)
    }
    /** Keys detach Dates and binary segments through the existing unique key snapshot. */
    const key = snapshotLockKey(captured.key, undefined)
    entries.push({
      encoded: encodeLockIdentity(key, undefined),
      row: Object.freeze({ ...captured, key })
    })
  }
  sortStorageByteIdentities(entries)
  return Object.freeze(entries.map((entry) => entry.row))
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
  return Object.freeze(unique)
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
  return Object.freeze({
    keys: Object.freeze(locks.map((entry) => entry.key)),
    identities: snapshotLockIdentities(locks)
  })
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
  /** Borrowed fields are captured once before either channel or typed prefix admission. */
  let channel: ILockKey['channel']
  /** Omission selects the entire physical channel without introducing a fabricated logical key. */
  let prefix: IStorageKey | undefined
  try {
    channel = range.channel
    prefix = range.prefix
  } catch (cause) {
    throw invalidLockArgument(backend, cause)
  }
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
    return Object.freeze({
      lower: storageKeyBytesIdentity(new Uint8Array([rank])),
      upper: storageKeyBytesIdentity(new Uint8Array([rank + 1]))
    })
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
  return Object.freeze({ lower: withChannel(bounds.lower), upper: withChannel(bounds.upper) })
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
  readonly attempt: number
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
  return Object.freeze(locks?.map((entry) => storageKeyBytesIdentity(entry.encoded)) ?? [])
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
 * supplied genuine policy is the sole effective policy; omission resolves the captured override or
 * default through the original transaction owner. Nested calls receiving the exact attempt context
 * borrow its budget and signal; only the outermost call releases that signal.
 */
export async function runWithConcurrency<TResult>(
  request: {
    readonly store: IStorageBase
    readonly options: ITransactionOptions
    readonly policy?: IConcurrencyPolicy
    /**
     * Wraps the original logical loop so one pipeline terminal supplies fixed input before native
     * work.
     */
    readonly execute?: (
      captured: IOperationContext & { readonly conflictPolicy?: IConflictPolicy },
      invokeOriginalLoop: () => Promise<Awaited<TResult>>
    ) => Awaited<TResult> | PromiseLike<Awaited<TResult>>
    /**
     * Wraps each actual native commit attempt. Acquisition retries stay within the current stage;
     * commit conflicts finish its catch/finally before policy and another stage. Mutually exclusive
     * with execute. A stage may halt or recover by returning without rethrowing the exact
     * conflict.
     */
    readonly executeAttempt?: (
      captured: IOperationContext & { readonly conflictPolicy?: IConflictPolicy },
      invokeOriginalAttempt: () => Promise<Awaited<TResult>>
    ) => Awaited<TResult> | PromiseLike<Awaited<TResult>>
    /** Runs one original pipeline within this call's budget before deriving its fixed-input locks. */
    readonly prepare?: (
      captured: IOperationContext & { readonly conflictPolicy?: IConflictPolicy }
    ) => void | PromiseLike<void>
    /** Derives fixed-input locks once by default, or once per executeAttempt pipeline segment. */
    readonly lock?: (
      captured: IOperationContext & { readonly conflictPolicy?: IConflictPolicy }
    ) => readonly ILockKey[]
  },
  port: IConcurrencyPort<TResult>
): Promise<Awaited<TResult>> {
  /** Overall deadlines start at public entry, including synchronous argument admission work. */
  const startedAt = systemScheduler.now()
  /** The original registration supplies immutable diagnostics and the host's sole stage binding. */
  const { backend, stages } = readTransactionConcurrency(request.store)
  /**
   * Explicit policy remains the sole effective policy; omission resolves after original options
   * capture.
   */
  const suppliedPolicy = request.policy
  if (suppliedPolicy !== undefined) assertConcurrencyPolicy(suppliedPolicy)
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
  /** Backend derivation is borrowed once and cannot replace any caller-declared lock. */
  let deriveLocks: typeof request.lock
  /** Preparation is a single pre-attempt callback, never a native attempt or a retry hook. */
  let prepare: typeof request.prepare
  /** The actual outer pipeline may wrap only this original loop and its existing call budget. */
  let execute: typeof request.execute
  /** Native commit replay can reopen only this finite wrapper, never another logical loop. */
  let executeAttempt: typeof request.executeAttempt
  try {
    capturedLocks = request.options.lock
    capturedOverride = request.options.concurrency
    deriveLocks = request.lock
    prepare = request.prepare
    execute = request.execute
    executeAttempt = request.executeAttempt
  } catch (cause) {
    throw invalidConcurrencyArgument(cause)
  }
  if (capturedOverride !== undefined) assertConcurrencyPolicy(capturedOverride)
  if (
    (deriveLocks !== undefined && typeof deriveLocks !== 'function') ||
    (prepare !== undefined && typeof prepare !== 'function') ||
    (execute !== undefined && typeof execute !== 'function') ||
    (executeAttempt !== undefined && typeof executeAttempt !== 'function') ||
    (execute !== undefined && executeAttempt !== undefined)
  )
    throw invalidConcurrencyArgument()
  /** Default resolution belongs to the same owner, after the original override getter is read once. */
  const policy = suppliedPolicy ?? resolveConcurrencyPolicy(request.store, capturedOverride)
  /** The exact outer attempt context carries the one shared budget and encoded lock set. */
  const inherited = concurrencyAttemptBudgets.get(request.options)
  /** The original logical identities are encoded/sorted once, not again on nested entries or retry. */
  let locks = inherited
    ? inherited.locks
    : capturedLocks === undefined
      ? undefined
      : normalizeLockKeys(capturedLocks, backend)
  /** Each actual native replay derives from caller/inherited locks, without prior input transforms. */
  const originalLocks = locks
  /** Context snapshots preserve original signal identity, field causes, org identity and omission. */
  const context = snapshotOperationContext(request.options)
  /** Every path derives only after its pipeline has fixed the current segment's input. */
  function derivePreparedLocks(): void {
    if (!deriveLocks) return
    /** Only new keys are captured and encoded; inherited normalized entries remain unchanged. */
    let additional: readonly ILockKey[]
    try {
      additional = deriveLocks(context!)
    } catch (cause) {
      if (IdentifyError.identityOf(cause)) throw cause
      throw invalidConcurrencyArgument(cause)
    }
    /** Stable sorting retains the original entry when an implicit lock duplicates an explicit one. */
    const normalized = normalizeLockKeys(additional, backend)
    if (normalized.length > 0) locks = uniqueNormalizedLockKeys([...(locks ?? []), ...normalized])
  }
  // Preserve admission ordering for existing callers that have no preparation phase.
  if (!prepare && !execute && !executeAttempt) derivePreparedLocks()
  /** Unchanged inherited sets retain their exact immutable identity list as well as their budget. */
  let identities =
    locks === inherited?.locks && inherited ? inherited.identities : snapshotLockIdentities(locks)
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
  /** One current pipeline segment waits on the original loop's actual native settlement. */
  type IAttemptExecution = {
    readonly ready: Promise<void>
    readonly completed: Promise<
      | {
          readonly status: typeof ConcurrencyExecutionStatus.returned
          readonly value: Awaited<TResult>
        }
      | { readonly status: typeof ConcurrencyExecutionStatus.threw; readonly cause: unknown }
    >
    readonly entered: boolean
    readonly resolve: (value: Awaited<TResult>) => void
    readonly reject: (cause: unknown) => void
  }
  /** The same frozen captured fields and budget signal are reused by every actual segment. */
  const executionContext = executeAttempt
    ? Object.freeze({ ...context, signal: budget.cancellation.signal })
    : undefined
  /** Only an active segment is retained; a completed conflict releases it before replay. */
  let execution: IAttemptExecution | undefined
  /** Creates no native work until the real stage terminal enters the original logical loop. */
  function startAttemptExecution(): IAttemptExecution {
    /** The terminal receives the real native outcome, including rollback and cleanup completion. */
    let resolveNative!: (value: Awaited<TResult>) => void
    /** Rejecting with the exact failure lets stage catch/recovery keep its original semantics. */
    let rejectNative!: (cause: unknown) => void
    /** A logical acquire refusal does not settle this Promise or unwind its stage. */
    const native = new Promise<Awaited<TResult>>((resolve, reject) => {
      resolveNative = resolve
      rejectNative = reject
    })
    // A typed stage may return after calling its terminal without awaiting the native Promise.
    void native.then(undefined, () => undefined)
    /** Stage halt, failure and terminal admission all wake the original loop without a timer. */
    let resolveReady!: () => void
    /** The stage either reaches its terminal or completes without any native work. */
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve
    })
    /** Reusing one continuation cannot duplicate native work. */
    let invoked = false
    /** Only successful terminal preparation permits the loop to admit a native attempt. */
    let entered = false
    /** Capture both outcomes immediately so a late catch/finally never escapes observation. */
    const completed: IAttemptExecution['completed'] = (async () => {
      try {
        return {
          status: ConcurrencyExecutionStatus.returned,
          value: await executeAttempt!(executionContext!, () => {
            if (invoked) return Promise.reject(invalidConcurrencyArgument())
            invoked = true
            /** Expired before-next work derives no keys and starts no native admission. */
            const aborted = concurrencyAbort(budget, false)
            if (aborted) return Promise.reject(aborted)
            locks = originalLocks
            derivePreparedLocks()
            identities =
              locks === inherited?.locks && inherited
                ? inherited.identities
                : snapshotLockIdentities(locks)
            entered = true
            resolveReady()
            return native
          })
        }
      } catch (cause) {
        return { status: ConcurrencyExecutionStatus.threw, cause }
      } finally {
        resolveReady()
      }
    })()
    return {
      ready,
      completed,
      get entered() {
        return entered
      },
      resolve: resolveNative,
      reject: rejectNative
    }
  }
  try {
    if (prepare) {
      /** An already canceled call starts neither its pipeline nor a native attempt. */
      const beforePreparation = concurrencyAbort(budget, false)
      if (beforePreparation) throw beforePreparation
      /**
       * The original fields stay captured; only this owner supplies the running cancellation
       * signal.
       */
      const preparationContext = Object.freeze({ ...context, signal: budget.cancellation.signal })
      await prepare(preparationContext)
      /** Accepted preparation settles before cancellation can release this call's signal owner. */
      const afterPreparation = concurrencyAbort(budget, false)
      if (afterPreparation) throw afterPreparation
      if (!execute && !executeAttempt) derivePreparedLocks()
      identities =
        locks === inherited?.locks && inherited
          ? inherited.identities
          : snapshotLockIdentities(locks)
    }
    if (execute) {
      /** Pre-canceled calls start neither an outer pipeline nor native work. */
      const beforeExecution = concurrencyAbort(budget, false)
      if (beforeExecution) throw beforeExecution
      /** Reusing the continuation cannot create a second logical run or duplicate a committed write. */
      let invoked = false
      /** The pipeline terminal enters the same loop once after fixing its actual operation input. */
      const invokeOriginalLoop = (): Promise<Awaited<TResult>> => {
        if (invoked) return Promise.reject(invalidConcurrencyArgument())
        invoked = true
        /** Expired preparation or before-next work cannot derive keys or start native admission. */
        const aborted = concurrencyAbort(budget, false)
        if (aborted) return Promise.reject(aborted)
        derivePreparedLocks()
        identities =
          locks === inherited?.locks && inherited
            ? inherited.identities
            : snapshotLockIdentities(locks)
        return runOriginalLoop()
      }
      /** After-next and catch stay around actual native settlement under the original call budget. */
      const executionContext = Object.freeze({ ...context, signal: budget.cancellation.signal })
      return (await execute(executionContext, invokeOriginalLoop)) as Awaited<TResult>
    }
    return await runOriginalLoop()
  } catch (cause) {
    if (!execution) throw cause
    /** Cancellation, native and policy errors also await the original stage's actual unwind. */
    execution.reject(cause)
    const completed = await execution.completed
    if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
    throw completed.cause
  } finally {
    if (!inherited?.budget) budget.cancellation.dispose()
  }
  /** The sole existing logical loop retains all attempt, wait, decision and retry ownership. */
  async function runOriginalLoop(): Promise<Awaited<TResult>> {
    while (true) {
      if (executeAttempt && !execution) {
        /** Cancellation before a fresh stage cannot start another pipeline or native attempt. */
        const beforeExecution = concurrencyAbort(budget, false)
        if (beforeExecution) throw beforeExecution
        execution = startAttemptExecution()
        await execution.ready
        if (!execution.entered) {
          /** A legal stage halt/recovery may complete without ever calling its terminal. */
          const completed = await execution.completed
          execution = undefined
          if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
          throw completed.cause
        }
      }
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
        attempt: budget.conflicts + 1,
        admission,
        locking: policy.locking,
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
      concurrencyAttemptBudgets.set(attemptContext, { budget, locks, identities })
      /** No handler means no argument array or event payload is created. */
      const beforeAcquire = readConcurrencyStage(stages, 'beforeLockAcquire')
      if (beforeAcquire)
        observeConcurrencyResult(stages!, beforeAcquire, [policy.name, locks?.length ?? 0])
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
      if (result.status === ConcurrencyAttemptStatus.committed) {
        /** The stage's after-next path observes the actual committed value, then fully settles. */
        const value = await result.value
        if (!execution) return value
        execution.resolve(value)
        const completed = await execution.completed
        execution = undefined
        if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
        throw completed.cause
      }
      if (execution && result.phase === ConcurrencyPhase.commit) {
        /** Absent or uncoded causes need one explicit boundary identity before stage intervention. */
        const failure = IdentifyError.identityOf(result.cause)
          ? result.cause
          : new StorageContractError(StorageContractErrorCode.writeConflict, {
              backend,
              cause: result.cause
            })
        execution.reject(failure)
        const completed = await execution.completed
        execution = undefined
        if (completed.status === ConcurrencyExecutionStatus.returned) return completed.value
        if (completed.cause !== failure) throw completed.cause
        /** A policy rejection retains the same coded boundary the stage actually observed. */
        if (failure !== result.cause) result = { ...result, cause: failure }
      }
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
          await raceWithAbort(() => concurrencyPolicies.get(policy)!(conflict), {
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
  }
}
