/**
 * Owns writable source values, publication and observation hooks; dependency edges stay in the
 * tracker.
 */
import type {
  IDisposable,
  IObservable,
  IObserver,
  IReactiveNodeOptions,
  IRuntime
} from '../runtime/types.ts'
import { internalsOf, type IRuntimeInternals } from '../runtime/internals.ts'
import { claimOwnership } from '../runtime/ownership.ts'
import { describeObservable, emitTraceSafely } from '../runtime/diagnostics.ts'
import { registerSubs } from '../runtime/node-internals.ts'
import { createReactiveError, tagReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { markSubscribers } from '../runtime/subscriber-graph.ts'
import {
  ReactiveErrorPhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from '../runtime/trace-constants.ts'
import { ReactiveErrorText } from '../error-text.ts'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { createReceiverCallback } from '../runtime/receiver.ts'

// Writable atom: the source value from which `Computed` and `Effect` derive their results.
// Each node owns a runtime reference. Only nodes in the same runtime share a graph and version clock.
// The runtime type import avoids a runtime dependency on the concrete `Runtime` class.
export class Signal<T> implements IObservable, IDisposable {
  /** Canonical writable subscriber membership remains private to the graph kernel. */
  #subs = new Set<IObserver>()
  /** Extensions observe a read-only live view of this signal's canonical subscribers. */
  readonly subs: ReadonlySet<IObserver>
  /** Last successfully published version supports downstream stale-dependency checks. */
  #version: number
  /** Reports the committed version without admitting a dependency read. */
  get version(): number {
    return this.#version
  }
  /** Lifecycle hooks stay private; callers receive a removal token instead. */
  #observedHooks?: Set<() => void>
  /** Unobserved callbacks allocate storage only when an owner registers one. */
  #unobservedHooks?: Set<() => void>
  /** Returns an invocation-time snapshot runner when observation hooks are registered. */
  get onObserved(): (() => void) | undefined {
    return this.#composeHooks(this.#observedHooks)
  }
  /** Returns the corresponding runner for the final downstream-edge removal. */
  get onUnobserved(): (() => void) | undefined {
    return this.#composeHooks(this.#unobservedHooks)
  }
  /** Owning graph identity is stable for this signal's entire lifetime. */
  readonly runtime: IRuntime
  /** Immutable kernel services captured once from this node's owning Runtime. */
  readonly #internals: IRuntimeInternals
  /** Optional diagnostic label is independent of the signal's graph identity. */
  debugName?: string
  /** Committed source value changes only after reserving its next graph version. */
  #value: T
  /** Terminal state rejects later reads and writes before touching graph state. */
  #disposed = false
  /** Registers ownership and subscriber metadata before reserving the initial source version. */
  constructor(v: T, runtime: IRuntime, options: IReactiveNodeOptions = {}) {
    this.subs = registerSubs(this, this.#subs)
    this.runtime = runtime
    // 归属登记走唯一那张表，不再靠字段名让下游去猜
    claimOwnership(this, runtime)
    this.debugName = options.debugName
    this.#value = v
    this.#internals = internalsOf(runtime)
    this.#version = this.#internals.clock.next()
  }
  /** Reports whether terminal disposal has begun, including during reentrant graph disconnection. */
  get disposed(): boolean {
    return this.#disposed
  }
  /** A disposed source is unobserved even while terminal disconnection is reentrant. */
  get observed(): boolean {
    return !this.#disposed && this.#subs.size > 0
  }
  /** Owns cold-path error construction after a public operation observes terminal disposal. */
  #throwDisposed(): never {
    throw createReactiveError(ReactiveErrorCode.nodeDisposed, ReactiveErrorText.disposedSignal)
  }
  /** Tracks the source in the current frame before returning its committed value. */
  get value(): T {
    if (this.#disposed) this.#throwDisposed()
    this.#internals.tracker.track(this)
    return this.#value
  }
  /** Publishes unequal values atomically, then traces and marks the entry subscriber snapshot. */
  set value(next: T) {
    if (this.#disposed) this.#throwDisposed()
    if (Object.is(next, this.#value)) return // 相等短路，杜绝无效触发
    // 先领取版本，再提交值。时钟耗尽时赋值必须保持原子失败，不能留下
    // “值已变、version 未变、下游未通知”的永久陈旧状态。
    /** This node always uses its original Runtime services. */
    const runtime = this.#internals
    /** Reserving first keeps clock exhaustion from partially committing a new source value. */
    const nextVersion = runtime.clock.next()
    this.#value = next
    this.#version = nextVersion
    if (runtime.traceEnabled()) {
      emitTraceSafely(
        {
          timestamp: runtime.timestamp,
          emitTrace: runtime.emitTrace,
          reportError: (error) =>
            this.runtime.reportError(error, {
              phase: ReactiveErrorPhase.traceListener,
              observable: this
            })
        },
        (timestamp) => ({
          type: ReactiveTraceType.observableChange,
          timestamp,
          observable: describeObservable(this),
          reason: ReactiveTraceReason.set
        })
      )
    }
    // 通知入口快照可按拓扑复用；扩展 markDirty 仍可同步重新追踪并改动 subs。
    runtime.scheduler.runDeferred(markSubscribers, this)
  }
  /** Reads the committed source value without adding a dependency to the active frame. */
  peek(): T {
    if (this.#disposed) this.#throwDisposed()
    return this.#value
  } // Reads without creating a dependency.

  /**
   * Disposes the signal and disconnects all downstream edges.
   *
   * This public operation gives source owners, such as collection cells and `AtomStore` instances,
   * a release path without importing `runtime/internals` and gaining access to the whole graph.
   * `Computed` and `Effect` expose the same lifecycle operation.
   *
   * Disposal is terminal, as it is for `Computed`. The signal is marked disposed before downstream
   * notification. A forced effect rerun therefore reads an explicit error instead of resubscribing
   * to a disposed node.
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#internals.tracker.disconnectObservable(this, ReactiveTraceReason.dispose)
  }

  /** Compose an owner lifecycle callback without silently replacing one. */
  addObservedHooks(hooks: { onObserved?: () => void; onUnobserved?: () => void }): () => void {
    /** Snapshot each caller getter once before validating or registering either callback. */
    const onObserved = hooks.onObserved
    /** The paired callback follows the original observed-then-unobserved getter order. */
    const onUnobserved = hooks.onUnobserved
    if (onObserved !== undefined && typeof onObserved !== 'function') {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('onObserved')),
        ReactiveErrorCode.invalidOption
      )
    }
    if (onUnobserved !== undefined && typeof onUnobserved !== 'function') {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('onUnobserved')),
        ReactiveErrorCode.invalidOption
      )
    }
    /** Each registration owns distinct callbacks even when callers supplied the same function. */
    const ownedObserved = onObserved ? createReceiverCallback(onObserved, undefined) : undefined
    /** The matching unobserved callback shares only this group's removal token. */
    const ownedUnobserved = onUnobserved
      ? createReceiverCallback(onUnobserved, undefined)
      : undefined
    if (ownedObserved) (this.#observedHooks ??= new Set()).add(ownedObserved)
    if (ownedUnobserved) (this.#unobservedHooks ??= new Set()).add(ownedUnobserved)
    return () => {
      if (ownedObserved) this.#observedHooks?.delete(ownedObserved)
      if (ownedUnobserved) this.#unobservedHooks?.delete(ownedUnobserved)
    }
  }
  /** Omits empty lifecycle channels while retaining invocation-time membership for live runners. */
  #composeHooks(hooks: Set<() => void> | undefined): (() => void) | undefined {
    if (hooks === undefined || hooks.size === 0) return undefined
    return () => this.#runHooks(hooks)
  }

  /** Runs an invocation-time hook snapshot and retains every failure before reporting the group. */
  #runHooks(hooks: Set<() => void>): void {
    /** Hook failures are collected in invocation order so one hook cannot suppress its peers. */
    const errors: unknown[] = []
    /** Each entry hook runs once even if callbacks add or remove live membership reentrantly. */
    for (const hook of Array.from(hooks)) {
      try {
        /** Synchronous hooks retain their original zero-argument, receiver-free invocation. */
        const result = hook()
        /** Admission snapshots a possible then getter once before reporting unsupported async work. */
        const inspection = inspectThenable(result)
        if ('error' in inspection) {
          throw tagReactiveError(
            new TypeError(
              ReactiveErrorText.synchronousCallbackReturnedThenable(
                ReactiveErrorText.lifecycleHookLabel
              ),
              { cause: inspection.error }
            ),
            ReactiveErrorCode.invalidOption
          )
        }
        if (inspection.then !== undefined) {
          observeThenableRejection(result, inspection, (error) => {
            this.runtime.reportError(error, { phase: ReactiveErrorPhase.lifecycleHook })
          })
          throw createReactiveError(
            ReactiveErrorCode.invalidOption,
            ReactiveErrorText.synchronousCallbackReturnedThenable(
              ReactiveErrorText.lifecycleHookLabel
            )
          )
        }
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length === 1) throw errors[0]
    if (errors.length > 1) {
      throw tagReactiveError(
        new AggregateError(errors, ReactiveErrorText.multipleLifecycleHooksFailed),
        ReactiveErrorCode.observerFailed
      )
    }
  }
}
