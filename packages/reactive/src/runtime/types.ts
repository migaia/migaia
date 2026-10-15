// 反应式内核的公共类型——只放类型，不放实现。谁需要这些类型就从这里 import，不必经过任何具体类/类实例。

import type { IComputedConfig } from '../reactive/computed.class.js'
import {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from './trace-constants.js'

/**
 * A runtime is a registered object created by this library, not a structurally fabricated SPI.
 *
 * The public entry does not export this symbol. The internals WeakMap still checks actual
 * authority. This brand aligns the type contract with runtime ownership. Compose `createRuntime()`
 * instead of creating an object without registered internals.
 */
export const RUNTIME_BRAND: unique symbol = Symbol('store.runtime')

export type IReactiveNodeOptions = {
  debugName?: string
}

/**
 * Public writable node view. Graph bookkeeping stays behind Runtime internals; consumers only
 * receive value/lifecycle operations.
 */
export type IReactiveSignal<T> = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
  readonly observed: boolean
  readonly version: number
  value: T
  peek(): T
  /** Registers observation callbacks and returns a token that removes only those callbacks. */
  addObservedHooks(hooks: { onObserved?: () => void; onUnobserved?: () => void }): IDisposer
}

/** Public read-only derived value view. */
export type IReactiveComputed<T> = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
  readonly observed: boolean
  readonly version: number
  readonly value: T
  peek(): T
}

/** Public scheduled-effect lifecycle; dependency bookkeeping remains on the graph node. */
export type IReactiveEffect = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
}

/** Public, immutable identity for a reactive graph node. */
export type IRuntimeNodeKind = 'observable' | 'observer' | 'computed'

/**
 * Diagnostic callbacks receive this descriptor, never the mutable graph node. `id` remains stable
 * for the node lifetime and correlates trace relationships within one loaded library copy.
 * Aggregators must namespace streams from independently bundled copies.
 */
export type IRuntimeNodeDescriptor = Readonly<{
  id: string
  kind: IRuntimeNodeKind
  debugName?: string
}>

export type IRuntimeTraceEvent =
  | {
      readonly type: typeof ReactiveTraceType.observableChange
      readonly timestamp: number
      readonly observable: IRuntimeNodeDescriptor
      readonly reason: typeof ReactiveTraceReason.set | typeof ReactiveTraceReason.notify
    }
  | {
      readonly type: typeof ReactiveTraceType.dependency
      readonly timestamp: number
      readonly phase: typeof ReactiveTracePhase.connect | typeof ReactiveTracePhase.disconnect
      readonly observable: IRuntimeNodeDescriptor
      readonly observer: IRuntimeNodeDescriptor
      readonly reason?:
        | typeof ReactiveTraceReason.retrack
        | typeof ReactiveTraceReason.invalidate
        | typeof ReactiveTraceReason.dispose
    }
  | {
      readonly type: typeof ReactiveTraceType.observerRun
      readonly timestamp: number
      readonly phase:
        | typeof ReactiveTracePhase.start
        | typeof ReactiveTracePhase.end
        | typeof ReactiveTracePhase.error
      readonly observer: IRuntimeNodeDescriptor
      readonly durationMs?: number
      readonly error?: unknown
    }
  | {
      readonly type: typeof ReactiveTraceType.action
      readonly timestamp: number
      readonly phase:
        | typeof ReactiveTracePhase.start
        | typeof ReactiveTracePhase.end
        | typeof ReactiveTracePhase.error
      readonly name: string
      readonly durationMs?: number
      readonly error?: unknown
    }

/**
 * Consumer interface for one clock, dependency tracker, scheduler, and node factories. Nodes in one
 * `IRuntime` share a graph and version clock. Different runtimes are isolated. Only the library's
 * `Runtime` implements this interface. Nodes, Wasm fields, and React adapters depend on this view
 * rather than the concrete class. Public factories expose value and lifecycle operations without
 * graph mutation methods.
 */
export type IRuntime = {
  readonly [RUNTIME_BRAND]: true
  // The public view excludes the clock, tracker, scheduler, and notification port, which could bypass ownership,
  // observation lifecycle, trace records, and scheduling atomicity. See `runtime/internals.ts`.
  // A WeakMap enforces the boundary at runtime; TypeScript `private` alone would not.
  /**
   * Creates a writable node owned by this runtime and sharing its dependency graph and version
   * clock.
   */
  signal<T>(value: T, options?: IReactiveNodeOptions): IReactiveSignal<T>
  computed<T>(fn: () => T, config?: IComputedConfig<T>): IReactiveComputed<T>
  /** Creates an immediately executed effect whose handle owns idempotent disposal. */
  effect(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IReactiveEffect
  batch<T>(fn: () => T): T
  untracked<T>(fn: () => T): T
  /**
   * Flushes synchronously. Reentrant observer calls return `deferred`; the outer call returns
   * `completed` after draining the queue.
   */
  flush(): IFlushResult
  /**
   * Runs and traces an action. Callers provide only its name and function, never fabricated phases
   * or trace events.
   */
  runTracedAction<T>(name: string, fn: () => T): T
  reportError(error: unknown, context: IRuntimeErrorReportContext): void
  /**
   * Subscribes to read-only diagnostics. Only the trusted kernel emits action and dependency
   * records.
   */
  subscribeTrace(listener: (event: IRuntimeTraceEvent) => void): IDisposer
}

export type IRuntimeErrorPhase = (typeof ReactiveErrorPhase)[keyof typeof ReactiveErrorPhase]

export type IRuntimeErrorContext = {
  phase: IRuntimeErrorPhase
  observer?: IRuntimeNodeDescriptor
  observable?: IRuntimeNodeDescriptor
}

/**
 * Input accepted by `reportError`. Runtime implementations must snapshot object metadata before
 * invoking public callbacks; raw objects are never forwarded.
 */
export type IRuntimeErrorReportContext = {
  phase: IRuntimeErrorPhase
  observer?: object
  observable?: object
}

/**
 * Host capability injection boundary (`docs/contracts/runtime-neutrality.sdd.md` R-9).
 *
 * As in `@migaia/utils/scheduler`, `now()` is monotonic and measures durations
 * (`IScheduler.now()`). `timestamp()` supplies epoch event time (`IWallClock.timestamp()`). Do not
 * mix the two clocks. See `default-runtime-adapter.ts` for defaults.
 */
export type IReactiveRuntimeAdapter = {
  /** Schedules one microtask. */
  scheduleMicrotask(task: () => void): void
  /** Supplies monotonic time for durations. */
  now(): number
  /** Supplies event timestamps independently of duration measurements. */
  timestamp(): number
  /** Default error reporting channel. */
  reportError(error: unknown, context: IRuntimeErrorContext): void
}

export type IRuntimeOptions = {
  /** Injects host capabilities. Missing entries use `defaultRuntimeAdapter`. */
  adapter?: Partial<IReactiveRuntimeAdapter>
  onError?: (error: unknown, context: IRuntimeErrorContext) => void
  onTrace?: (event: IRuntimeTraceEvent) => void
  /**
   * Maximum executions for one observer within one flush. The default is 100. Exceeding the limit
   * is treated as a self-triggering cycle and throws after clearing the queue.
   *
   * The limit is configurable scheduling policy, not a physical constant.
   */
  maxFlushPasses?: number
  /**
   * Schedules suspension of an unobserved `Computed`. Defaults to the adapter's
   * `scheduleMicrotask`.
   *
   * Suspension is cleanup, so its timing is separate from flushing. This configurable channel can
   * align cleanup with animation-frame or idle policies without requiring callers or tests to wait
   * for a hard-coded microtask.
   */
  scheduleIdle?: (task: () => void) => void
  /** Selects flush timing at creation; the runtime does not expose strategy replacement. */
  schedulerStrategy?: ISchedulerStrategy
}

/**
 * Kernel graph protocol exposed as a type from the `@migaia/reactive/extension` entry.
 *
 * Third-party extensions compose public signals instead of implementing and changing `subs` or
 * `version`. Built-in Wasm and SAB sources join the graph through controlled extension bindings.
 * They must register runtime ownership first.
 */
export type IObservable = {
  readonly runtime: IRuntime
  debugName?: string
  /** Reverse edges are maintained by the Runtime tracker, not extension code. */
  readonly subs: ReadonlySet<IObserver>
  readonly version: number
  pull?(): void // Settles lazy node versions before reading; data nodes do not need it.
  // Pure synchronous state check. It must not evaluate, mutate the graph, or throw user computation errors.
  isStale?(): boolean
  onObserved?(): void // Runs when the first downstream subscription is established.
  onUnobserved?(): void // Runs when the last downstream subscription leaves.
}

/**
 * Reads `IObservable` values and receives change notifications. `Computed` and `Effect` implement
 * this observer role.
 */
export type IObserver = {
  readonly runtime: IRuntime
  readonly disposed: boolean
  debugName?: string
  readonly deps: ReadonlySet<IObservable>
  readonly depVersions: ReadonlyMap<IObservable, number>
  markDirty(): void
  onDependencyDisconnected(observable: IObservable): void
}

/**
 * Cleanup callback for an effect or custom source. Reverses side effects before rerun or disposal,
 * such as subscriptions, timers, or resource ownership.
 */
export type IDisposer = () => void

/**
 * Resource with explicit ownership and lifecycle, supporting disposal and a disposal-state query.
 * `Computed`, `Effect`, and scopes use this contract for LIFO release by the owning scope. It also
 * serves future Wasm fields or worker subscriptions.
 */
export type IDisposable = {
  dispose(): void
  readonly disposed: boolean
}

/**
 * Controls when pending reactive effects execute. Defaults to merged microtasks and can use
 * animation frames, idle callbacks, or priority queues. `Scheduler` owns a strategy instance.
 */
export type ISchedulerStrategy = (flush: () => void) => void

/**
 * Outcome of an explicit flush. Distinct strings expose reentrancy instead of hiding it behind
 * boolean truthiness.
 */
export type IFlushResult = 'completed' | 'deferred'

/**
 * Minimal queued-item contract describing how a flush processes the item. `Effect` is the current
 * implementation, but this structural view avoids a direct class reference. Otherwise importing
 * `Effect` from `Scheduler` would create a circular dependency.
 */
export type IFlushable = {
  tick(): void
  /** Identifies discarded pending work when loop protection triggers. */
  readonly debugName?: string
}
