import { internalsOf } from './internals.js'
import { DependencyTracker } from './dependency-tracker.class.js'
import type {
  IObservable,
  IObserver,
  IReactiveComputed,
  IReactiveNodeOptions,
  IReactiveSignal,
  IRuntime
} from './types.js'
import type { IComputedConfig } from '../reactive/computed.class.js'

/**
 * Factory view for implementation layers that need the existing graph protocols.
 *
 * Nodes retain the same runtime ownership, notification path, and public lifecycle. This view adds
 * read-only graph relationships and observer operations without exposing mutable edge sets or the
 * runtime tracker, scheduler, and clock objects.
 */
export type IInternalRuntime = Omit<IRuntime, 'signal' | 'computed'> & {
  signal<T>(value: T, options?: IReactiveNodeOptions): IReactiveSignal<T> & IObservable
  computed<T>(
    fn: () => T,
    config?: IComputedConfig<T>
  ): IReactiveComputed<T> & IObservable & IObserver
}

/** Validates runtime registration before exposing graph factory types to implementation layers. */
export function internalRuntimeOf(runtime: IRuntime): IInternalRuntime {
  internalsOf(runtime)
  return runtime as IInternalRuntime
}

/** Reads the existing version clock; fabricated runtimes retain the NOT_RUNTIME_OWNED failure. */
export function currentRuntimeVersion(runtime: IRuntime): number {
  return internalsOf(runtime).clock.current()
}

/** Read-only tracking-context query for node-building implementation layers. */
export function isRuntimeTracking(runtime: IRuntime): boolean {
  return internalsOf(runtime).tracker.isTracking()
}

/** True when a dependency frame is active in any Runtime. */
export function isAnyRuntimeTracking(): boolean {
  return DependencyTracker.isAnyTracking()
}
