/**
 * Owns Runtime capability registration and trusted lookup; public graph views expose no service
 * bundle.
 */
import type { DependencyTracker } from './dependency-tracker.class.ts'
import type { Scheduler } from './scheduler.class.ts'
import type { VersionClock } from './version-clock.class.ts'
import type { IObservable, IRuntime, IRuntimeTraceEvent } from './types.ts'
import { createReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { noteRuntimeCopy } from './copy-check.ts'
import { ReactiveErrorText } from '../error-text.ts'

/**
 * Kernel internals boundary.
 *
 * Exposing the tracker, scheduler, clock, and notification port on `IRuntime` would let extensions
 * bypass ownership checks, observation lifecycle, trace records, bidirectional disconnection, and
 * scheduling atomicity.
 *
 * A module-owned WeakMap provides runtime encapsulation. TypeScript `private` only restricts types,
 * and a symbol property remains accessible to holders of that symbol. The WeakMap storage cannot be
 * obtained outside this module.
 *
 * `architecture.test.ts` restricts imports to the kernel and explicitly allowed advanced entry
 * points. Ordinary enhancement layers cannot import these internals.
 */
export type IRuntimeInternals = {
  readonly clock: VersionClock
  readonly tracker: DependencyTracker
  readonly scheduler: Scheduler
  /** Monotonic duration clock supplied by `adapter.now`. */
  now(): number
  /** Event timestamp supplied by `adapter.timestamp` for trace records. */
  timestamp(): number
  /**
   * Keeps diagnostic writes internal. External consumers subscribe but cannot fabricate action or
   * dependency events.
   */
  traceEnabled(): boolean
  emitTrace(event: IRuntimeTraceEvent): void
  /**
   * Advances the version and marks downstream nodes dirty. Custom sources such as Wasm fields share
   * this notification path.
   */
  notify(source: IObservable): void
  /** Reserve a version, perform a source write, then publish exactly once. */
  commitSource<T>(source: IObservable, write: () => T): T
  /**
   * Schedules deferred cleanup, including suspension of an unobserved `Computed`.
   *
   * Cleanup timing is separate from flush timing. Sharing a synchronous flush strategy would
   * disconnect upstream edges after each read and repeat work on a second read. The cleanup channel
   * is configurable through `IRuntimeOptions` instead of hard-coding `queueMicrotask`.
   */
  deferIdle(task: () => void): void
}

/** Runtime identity keeps canonical services alive without publishing them on observable properties. */
const INTERNALS = new WeakMap<object, IRuntimeInternals>()

/**
 * Registers internals during runtime construction. Duplicate registration is rejected as a
 * programming error.
 */
export function registerInternals(runtime: IRuntime, internals: IRuntimeInternals): void {
  if (INTERNALS.has(runtime)) {
    throw createReactiveError(
      ReactiveErrorCode.internalsRegistered,
      ReactiveErrorText.internalsAlreadyRegistered
    )
  }
  INTERNALS.set(runtime, internals)
}

/**
 * Retrieves runtime internals.
 *
 * Missing registration throws instead of returning `undefined`. Rejecting an object that
 * impersonates a runtime at this boundary prevents later failures with unclear origins.
 */
export function internalsOf(runtime: IRuntime): IRuntimeInternals {
  /** Only an entry registered by this library copy grants authority over this Runtime's graph. */
  const internals = INTERNALS.get(runtime)
  if (internals) return internals
  // 双实例自检（copy-check.ts）：读取内部面也是正确性边界，登记本副本。
  noteRuntimeCopy()
  throw createReactiveError(
    ReactiveErrorCode.notRuntimeOwned,
    ReactiveErrorText.runtimeNotCreatedByFactory
  )
}

/** Checks whether this library creates the runtime. Ownership checks do not expose its internals. */
export const isRuntime = (candidate: unknown): candidate is IRuntime =>
  typeof candidate === 'object' && candidate !== null && INTERNALS.has(candidate)
