import type {
  IDisposable,
  IObservable,
  IObserver,
  IReactiveNodeOptions,
  IRuntime
} from '../runtime/types.js'
import { internalsOf, type IRuntimeInternals } from '../runtime/internals.js'
import { claimOwnership } from '../runtime/ownership.js'
import { describeObservable, emitTraceSafely } from '../runtime/diagnostics.js'
import { registerSubs } from '../runtime/node-internals.js'
import { createReactiveError, tagReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { markSubscribers } from '../runtime/dependency-tracker.class.js'
import {
  ReactiveErrorPhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from '../runtime/trace-constants.js'
import { ReactiveErrorText } from '../error-text.js'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'

// Writable atom: the source value from which `Computed` and `Effect` derive their results.
// Each node owns a runtime reference. Only nodes in the same runtime share a graph and version clock.
// The runtime type import avoids a runtime dependency on the concrete `Runtime` class.
export class Signal<T> implements IObservable, IDisposable {
  #subs = new Set<IObserver>()
  readonly subs: ReadonlySet<IObserver>
  #version: number
  get version(): number {
    return this.#version
  }
  /** Lifecycle hooks stay private; callers receive a removal token instead. */
  #observedHooks = new Set<() => void>()
  #unobservedHooks = new Set<() => void>()
  get onObserved(): (() => void) | undefined {
    return this.#composeHooks(this.#observedHooks)
  }
  get onUnobserved(): (() => void) | undefined {
    return this.#composeHooks(this.#unobservedHooks)
  }
  readonly runtime: IRuntime
  /** Immutable kernel services captured once from this node's owning Runtime. */
  readonly #internals: IRuntimeInternals
  debugName?: string
  #value: T
  #disposed = false
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
  get disposed(): boolean {
    return this.#disposed
  }
  get observed(): boolean {
    return !this.#disposed && this.subs.size > 0
  }
  #assertActive(): void {
    if (this.#disposed) {
      throw createReactiveError(ReactiveErrorCode.nodeDisposed, ReactiveErrorText.disposedSignal)
    }
  }
  get value(): T {
    this.#assertActive()
    this.#internals.tracker.track(this)
    return this.#value
  }
  set value(next: T) {
    this.#assertActive()
    if (Object.is(next, this.#value)) return // 相等短路，杜绝无效触发
    // 先领取版本，再提交值。时钟耗尽时赋值必须保持原子失败，不能留下
    // “值已变、version 未变、下游未通知”的永久陈旧状态。
    /** This node always uses its original Runtime services. */
    const runtime = this.#internals
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
    // 先快照 subs：同步 scheduler 可能在通知过程中重新追踪并改动 subs，直接迭代活 Set 会死循环
    runtime.scheduler.runDeferred(markSubscribers, this)
  }
  peek(): T {
    this.#assertActive()
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
    this.#internals.tracker.disconnectObservable(this, 'dispose')
  }

  /** Compose an owner lifecycle callback without silently replacing one. */
  addObservedHooks(hooks: { onObserved?: () => void; onUnobserved?: () => void }): () => void {
    const onObserved = hooks.onObserved
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
    const ownedObserved = onObserved ? () => onObserved() : undefined
    /** The matching unobserved callback shares only this group's removal token. */
    const ownedUnobserved = onUnobserved ? () => onUnobserved() : undefined
    if (ownedObserved) this.#observedHooks.add(ownedObserved)
    if (ownedUnobserved) this.#unobservedHooks.add(ownedUnobserved)
    return () => {
      if (ownedObserved) this.#observedHooks.delete(ownedObserved)
      if (ownedUnobserved) this.#unobservedHooks.delete(ownedUnobserved)
    }
  }
  #composeHooks(hooks: Set<() => void>): (() => void) | undefined {
    if (hooks.size === 0) return undefined
    return () => {
      const errors: unknown[] = []
      for (const hook of Array.from(hooks)) {
        try {
          const result = hook()
          const inspection = inspectThenable(result)
          if ('error' in inspection) {
            throw tagReactiveError(
              new TypeError(
                ReactiveErrorText.synchronousCallbackReturnedThenable('lifecycle hook'),
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
              ReactiveErrorText.synchronousCallbackReturnedThenable('lifecycle hook')
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
}
