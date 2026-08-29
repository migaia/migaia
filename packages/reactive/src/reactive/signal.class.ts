import type {
  IDisposable,
  IObservable,
  IObserver,
  IReactiveNodeOptions,
  IRuntime
} from '../runtime/types.js'
import { internalsOf } from '../runtime/internals.js'
import { claimOwnership } from '../runtime/ownership.js'
import { describeObservable, emitTraceSafely } from '../runtime/diagnostics.js'
import { registerSubs } from '../runtime/node-internals.js'
import { createReactiveError, tagReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import {
  ReactiveErrorPhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from '../runtime/trace-constants.js'
import { ReactiveErrorText } from '../error-text.js'
import { inspectThenable, observeThenableRejection } from '../runtime/receiver.js'

// 可写原子——反应式图里唯一的"真值来源"，Computed/Effect 都是从它（或从彼此）派生。
// 每个节点持有自己的 runtime：同一 runtime 内的节点才共享依赖图/版本时钟。
// 只通过 type 引用 runtime（不 import 任何 runtime 值），彻底断开与 Runtime 类的循环依赖。
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
    this.#version = internalsOf(runtime).clock.next()
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
    internalsOf(this.runtime).tracker.track(this)
    return this.#value
  }
  set value(next: T) {
    this.#assertActive()
    if (Object.is(next, this.#value)) return // 相等短路，杜绝无效触发
    // 先领取版本，再提交值。时钟耗尽时赋值必须保持原子失败，不能留下
    // “值已变、version 未变、下游未通知”的永久陈旧状态。
    const runtime = internalsOf(this.runtime)
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
    runtime.scheduler.runDeferred(() => {
      for (const s of Array.from(this.subs)) s.markDirty() // push：向下游标脏/入队
    })
  }
  peek(): T {
    this.#assertActive()
    return this.#value
  } // 不建立依赖读取

  /**
   * 释放：断开全部下游边。
   *
   * Computed 与 Effect 一直有 dispose，Signal 没有——于是任何「我建的源节点用完了」 的场景（collections 的 per-cell、AtomStore
   * 的实例释放）只能去 import `runtime/internals` 拿 tracker 自己断边，也就是为了一个本该公开的操作而拿到
   * 整张图的权限。补齐这个对称性之后，那些豁免就不必要了。
   *
   * 语义与 Computed 一致：释放是终态。先标记 disposed 再通知下游，强制重跑的 Effect 因此会读到明确错误，而不会重新订阅这个已释放节点。
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    internalsOf(this.runtime).tracker.disconnectObservable(this, 'dispose')
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
    if (onObserved) this.#observedHooks.add(onObserved)
    if (onUnobserved) this.#unobservedHooks.add(onUnobserved)
    return () => {
      if (onObserved) this.#observedHooks.delete(onObserved)
      if (onUnobserved) this.#unobservedHooks.delete(onUnobserved)
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
