import { internalsOf } from './internals.js'
import { DependencyTracker } from './dependency-tracker.class.js'
import type { IReactiveNodeOptions, IRuntime } from './types.js'
import type { Signal } from '../reactive/signal.class.js'
import type { Computed, IComputedConfig } from '../reactive/computed.class.js'

/**
 * Factory view that retains concrete node classes for implementation layers.
 *
 * Public `IRuntime.signal()` and `computed()` return the narrow `ISignal` and `IComputedValue`
 * views. Graph implementation layers need concrete classes, such as collections disposing cells or
 * object views using `Computed` configuration.
 *
 * This module stays separate from `internals.ts`, which controls access to the tracker, scheduler,
 * clock, and notification port. Those capabilities can bypass ownership, lifecycle, and scheduling
 * guarantees. Concrete factory return types therefore do not expand the internals import
 * allowlist.
 *
 * Nodes still come from the same runtime and use the same ownership registration and notification
 * path. Only their exposed types are wider. Values without library runtime registration still
 * throw.
 */
export type IInternalRuntime = Omit<IRuntime, 'signal' | 'computed'> & {
  signal<T>(value: T, options?: IReactiveNodeOptions): Signal<T>
  computed<T>(fn: () => T, config?: IComputedConfig<T>): Computed<T>
}

/**
 * Validates library runtime registration before exposing concrete factory return types to
 * implementation layers.
 */
export function internalRuntimeOf(runtime: IRuntime): IInternalRuntime {
  internalsOf(runtime)
  return runtime as IInternalRuntime
}

/** Read-only tracking-context query for node-building implementation layers. */
export function isRuntimeTracking(runtime: IRuntime): boolean {
  return internalsOf(runtime).tracker.isTracking()
}

/** True when a dependency frame is active in any Runtime. */
export function isAnyRuntimeTracking(): boolean {
  return DependencyTracker.isAnyTracking()
}
