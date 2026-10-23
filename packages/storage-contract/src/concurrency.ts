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
/** Canonical locking values are shared by policy validation and the forthcoming decision loop. */
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
