import type { IAbortSignal } from './abort.js'
import type { IDisposerContext } from './disposer-context.js'
import type { ILifecycleScheduler } from './scheduler.js'
import { LifecycleErrorPolicy, LifecycleState, LifecycleUnitState } from './state-constants.js'

/**
 * Synchronous, idempotent teardown/unregister function.
 *
 * Declared locally rather than imported from `@migaia/reactive` — this package is a zero-dependency
 * leaf (`docs/lifecycle/lifecycle-extraction.sdd.md` §1.1) and must not pull in any other workspace
 * package just to share a structural type.
 */
export type IDisposer = () => void

/**
 * Minimal ownership surface exposed to callers that only need to hand resources off to a scope,
 * without depending on the full `LifecycleScope` API. `ProvisionalScope.commitTo()` accepts this
 * type so any real scope (async or sync) can be a commit target.
 *
 * The descriptor is required, not optional — this package never sniffs a resource's shape to guess
 * a release strategy (that would be a small but real piece of domain knowledge about what
 * "disposable" looks like, which §1.1 rules out). Every SDD example registers a resource with an
 * explicit descriptor, and `commitTo()` always has one on hand (the descriptor the resource was
 * originally `own()`-ed with), so requiring it here costs nothing.
 */
export type ILifecycleOwner = {
  own<T>(resource: T, descriptor: IReleaseDescriptor): T
}

/**
 * Internal brand stamped on every `LifecycleScope`/`ProvisionalScope` instance so
 * `SyncLifecycleScope.own()` can reject one even if it arrives wrapped in a `syncSafe: true`
 * descriptor claiming otherwise (§4.5: "`SyncLifecycleScope` 明确禁止 own `LifecycleScope`、
 * `ProvisionalScope`"). Not exported — this is an internal cross-module check, not public API.
 */
export const ASYNC_OWNER_BRAND: unique symbol = Symbol('@migaia/lifecycle/async-owner')

/** Container survival axis (`lifecycle-extraction.sdd.md` §4.2, axis 1). */
export type ILifecycleState = (typeof LifecycleState)[keyof typeof LifecycleState]

/** Unit loading axis (`lifecycle-extraction.sdd.md` §4.2, axis 2). */
export type IUnitState = (typeof LifecycleUnitState)[keyof typeof LifecycleUnitState]

/**
 * The context handed to a release descriptor's `graceful`/`force`/`custom` callback.
 *
 * `deadlineAt` is the transaction-wide shared absolute deadline (same value for every item in one
 * `DisposeTransaction` run, per §4.6 "全程共享同一份绝对 deadline" / L-T32) — it is not recomputed per
 * item.
 */
export type IReleaseContext = {
  /** Aborts when the owning transaction/scope enters `closing` (L-T26). */
  readonly signal: IAbortSignal
  readonly deadlineAt: number | undefined
  /**
   * The scheduler whose `now()` produced `deadlineAt`（R-9 时间域契约）. Omitted → `systemScheduler`.
   * Exposed so descriptor callbacks and the graceful-phase deadline share one clock source instead
   * of silently mixing domains.
   */
  readonly scheduler?: ILifecycleScheduler
  /** Side-channel diagnostic reporter; its own throws are contained (L-T26). */
  readonly report: (error: unknown) => void
  /** Owner-bound self-join guard; absent when a generic transaction has no scope owner. */
  readonly disposer?: IDisposerContext
}

/**
 * Declares how one resource is released. The core package has zero knowledge of what a resource
 * _is_ — descriptors are the only vocabulary a domain package uses to express release intent
 * (`lifecycle-extraction.sdd.md` §4.4).
 */
export type IReleaseDescriptor = {
  /**
   * Declares this descriptor may be accepted by `SyncLifecycleScope`. Does not change the static
   * type of the general-purpose `LifecycleScope` (D-6) — a scope's sync/async nature is determined
   * by which concrete type you construct, never inferred from descriptor content.
   */
  readonly syncSafe?: boolean
  /**
   * Release ordering key. Higher values release first, lower values release last (lower "sinks to
   * the bottom" of the release order — the opposite of allocation order). Omitted keys are treated
   * as `0`. Only meaningful in `DisposeTransaction`'s `order` mode (D-3: this package never
   * computes order, it only executes an order supplied by the caller).
   */
  readonly order?: number
  /**
   * Graceful release. A timeout abandons waiting for it (does not cancel it) and falls through to
   * `force`.
   */
  readonly graceful?: (context: IReleaseContext) => void | PromiseLike<void>
  /** Budget for the graceful phase, capped by the transaction's shared `deadlineAt` if one exists. */
  readonly gracefulTimeoutMs?: number
  /** Forced release. Must complete unconditionally; must not throw a recoverable error. */
  readonly force: (context: IReleaseContext) => void | PromiseLike<void>
  /**
   * GC fallback. When set, the core registers a `FinalizationRegistry` entry that unregisters on
   * explicit release.
   */
  readonly gcFallback?: boolean
  /**
   * Escape hatch: fully takes over this resource's release. The core only orders and collects
   * errors.
   */
  readonly custom?: (context: IReleaseContext) => void | PromiseLike<void>
}

/** One release failure, labeled by the caller-supplied `source` identity for that item. */
export type ICollectedError = {
  readonly source: string
  readonly error: unknown
}

/**
 * The four release error outcomes (`lifecycle-extraction.sdd.md` §4.5, D-4).
 *
 * `firstError` is not a general-purpose default — it exists only to give a caller migrating
 * `web-rpc`'s `discovery-registry` first-error-wins semantics an exact equivalent; new call sites
 * should reach for `throw`, `collect`, or `report` instead.
 */
export type IErrorPolicy = (typeof LifecycleErrorPolicy)[keyof typeof LifecycleErrorPolicy]
