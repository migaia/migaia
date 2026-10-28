/** Owns extension factory views and the argument-bound batch capability; graph state stays internal. */
import { internalsOf, type IRuntimeInternals } from './internals.ts'
import { runReactiveCallbackWith } from '../errors.ts'
import { DependencyTracker } from './dependency-tracker.class.ts'
import type {
  IObservable,
  IObserver,
  IReactiveComputed,
  IReactiveNodeOptions,
  IReactiveSignal,
  IRuntime
} from './types.ts'
import type { IComputedConfig } from '../reactive/computed.class.ts'
import { ReactiveTraceReason } from './trace-constants.ts'

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

/** Invalidates downstream bindings while preserving this exact observable's cache and upstream. */
export function invalidateObservable(runtime: IRuntime, observable: IObservable): void {
  internalsOf(runtime).tracker.disconnectObservable(observable, ReactiveTraceReason.invalidate)
}

/** Argument-bound operations share canonical callback, tracking and batch boundaries. */
class BatchedOperation<TArg, TResult> {
  /** Services are admitted once; invoking the capability never repeats ownership lookup. */
  readonly #services: IRuntimeInternals
  /** Caller operation retains its original single-argument invocation. */
  readonly #operation: (arg: TArg) => TResult
  /** Restores tracking before the inner callback error admission. */
  readonly #untracked = (arg: TArg): TResult =>
    this.#services.tracker.untrackedWith(this.#operation, arg)
  /** Preserves Runtime.untracked's callback error boundary without per-invocation allocation. */
  readonly #execute = (arg: TArg): TResult => runReactiveCallbackWith(this.#untracked, arg)
  /** Batch exit retains flush timing and the existing business-error precedence. */
  readonly #batched = (arg: TArg): TResult =>
    this.#services.scheduler.runBatchedWith(this.#execute, arg)

  /** Validates the runtime at capability creation and captures its canonical services. */
  constructor(runtime: IRuntime, operation: (arg: TArg) => TResult) {
    this.#services = internalsOf(runtime)
    this.#operation = operation
  }

  /** Returns a detached callback with the public batch error boundary and one argument. */
  callback(): (arg: TArg) => TResult {
    return (arg: TArg): TResult => runReactiveCallbackWith(this.#batched, arg)
  }
}

/**
 * Binds one lower-level operation to canonical batch and untracked boundaries. Each invocation
 * receives one argument without creating callback closures; finally/error handling stays in the
 * scheduler. Public batch/untracked callbacks retain their zero-argument invocation. Business
 * errors keep precedence over final flush failures.
 */
export function createBatchedOperation<TArg, TResult>(
  runtime: IRuntime,
  operation: (arg: TArg) => TResult
): (arg: TArg) => TResult {
  return new BatchedOperation(runtime, operation).callback()
}
