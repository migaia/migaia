import { type IStorageBase } from './store.ts'
import { assertStorageKey, assertStringStorageKey } from './key.ts'
import { assertStorageRdfQuad, type IQuad } from './capabilities/rdf.ts'
import { type IBackendKind } from './capabilities.ts'
import { StorageContractError, StorageContractErrorCode } from './errors.ts'
import { StorageContractErrorText } from './error-text.ts'
import { type StorageStageKind } from './stage-kind.ts'
import { type IAbortSignal } from '@migaia/utils/promise'
import { type IConflictPolicy, type IOperationContext, type IStorageKey } from './context.ts'

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

/** Native atomic backends can run without declared keys while accepting only optimistic policies. */
export type IOptimisticTransactionBuilder<
  TScope,
  TAugmentMethods extends object = Record<never, never>
> = {
  concurrency(
    policy: IConcurrencyPolicy & { readonly locking: 'optimistic' }
  ): IOptimisticTransactionBuilder<TScope, TAugmentMethods>
  signal(signal: IAbortSignal): IOptimisticTransactionBuilder<TScope, TAugmentMethods>
  timeout(ms: number): IOptimisticTransactionBuilder<TScope, TAugmentMethods>
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
export const ConcurrencyLocking = { pessimistic: 'pessimistic', optimistic: 'optimistic' } as const

/** Produces the existing coded argument boundary without executing policy callbacks. */
export function invalidConcurrencyArgument(cause?: unknown): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { cause },
    StorageContractErrorText.concurrencyArgument
  )
}

/** Internal identity admission is reused by the original transaction owner and decision loop. */
export function assertConcurrencyPolicy(
  policy: unknown,
  locking?: IConcurrencyPolicy['locking'],
  backend?: IBackendKind
): asserts policy is IConcurrencyPolicy {
  if (
    typeof policy !== 'object' ||
    policy === null ||
    !concurrencyPolicies.has(policy as IConcurrencyPolicy)
  )
    throw invalidConcurrencyArgument()
  /** The original policy registry also owns optional native-backend locking-mode admission. */
  if (locking !== undefined && (policy as IConcurrencyPolicy).locking !== locking)
    throw new StorageContractError(StorageContractErrorCode.unsupported, { backend })
}

/** Reads the original policy definition without invoking it or creating runtime state. */
export function readConcurrencyPolicy(policy: IConcurrencyPolicy): IConcurrencyDecide | undefined {
  return concurrencyPolicies.get(policy)
}

/** Register canonical policy metadata and its original private decision callback. */
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
  /** The definition supplies the callback retained by this authentic policy identity. */
  const { name, locking, decide } = definition
  /** Validation cannot confuse a source-thrown coded error with this boundary's own error. */
  if (
    typeof name !== 'string' ||
    name.trim().length === 0 ||
    (locking !== ConcurrencyLocking.pessimistic && locking !== ConcurrencyLocking.optimistic) ||
    typeof decide !== 'function'
  )
    throw invalidConcurrencyArgument()
  /** Policy metadata carries no public callback or mutable configuration. */
  const policy = { name, locking }
  concurrencyPolicies.set(policy, decide)
  return policy
}

/** Existing physical channel order precedes the canonical key encoding, never its own key tags. */
export const LockChannel = {
  text: 'text',
  bytes: 'bytes',
  record: 'record',
  vector: 'vector',
  rdf: 'rdf'
} as const

/** Internal snapshots retain independently owned canonical bytes across all actual attempts. */
export type INormalizedLockKey = { readonly key: ILockKey; readonly encoded: Uint8Array }

/** Builds the existing coded lock-argument boundary with an optional actual backend diagnostic. */
export function invalidLockArgument(
  backend: IBackendKind | undefined,
  cause?: unknown
): StorageContractError {
  return new StorageContractError(
    StorageContractErrorCode.invalidArgument,
    { backend, cause },
    StorageContractErrorText.lockArgument
  )
}

/** Validate the canonical lock channels without allocating a detached lock or logical key. */
export function assertLockKey(
  value: unknown,
  backend: IBackendKind | undefined
): asserts value is ILockKey {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalidLockArgument(backend)
  /** Channel discrimination reads only fields belonging to that supported physical domain. */
  const key = value as ILockKey
  switch (key.channel) {
    case LockChannel.text:
    case LockChannel.record:
      assertStorageKey(key.key, backend)
      return
    case LockChannel.bytes:
      assertStringStorageKey(key.key, backend)
      return
    case LockChannel.vector:
      assertStringStorageKey(key.collection, backend)
      assertStringStorageKey(key.id, backend)
      return
    case LockChannel.rdf:
      assertStorageRdfQuad(key.quad, backend)
      return
    default:
      throw invalidLockArgument(backend)
  }
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

/**
 * Runs the only logical decision/retry loop. A port attempt is always awaited to its actual native
 * terminal and cleanup before cancellation, a policy decision, or another attempt can finish. The
 * supplied genuine policy is the sole effective policy; omission resolves the captured override or
 * default through the original transaction owner. Nested calls receiving the exact attempt context
 * borrow its budget and signal; only the outermost call releases that signal.
 */
/** Preparation and pipeline ports wrap only the original logical loop and its existing budget. */
export type IConcurrencyRequest<TResult> = {
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
   * with execute. A stage may halt or recover by returning without rethrowing the exact conflict.
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
}
