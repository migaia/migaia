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
