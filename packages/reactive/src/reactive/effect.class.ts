import type {
  IDisposable,
  IDisposer,
  IObservable,
  IObserver,
  IReactiveNodeOptions,
  IRuntime
} from '../runtime/types.js'
import { internalsOf, type IRuntimeInternals } from '../runtime/internals.js'
import { claimOwnership } from '../runtime/ownership.js'
import { createObserverRunTrace, describeObserver } from '../runtime/diagnostics.js'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { registerDeps, registerDepVersions } from '../runtime/node-internals.js'
import { ReactiveErrorPhase } from '../runtime/trace-constants.js'
import { createReactiveError, tagReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'

// Effects are scheduled observers. A `Computed` propagates dirty state; the scheduler calls an `Effect` through `tick`.
export class Effect implements IObserver, IDisposable {
  #deps = new Set<IObservable>()
  #depVersions = new Map<IObservable, number>()
  readonly deps: ReadonlySet<IObservable>
  readonly depVersions: ReadonlyMap<IObservable, number>
  readonly runtime: IRuntime
  /** Immutable kernel services captured once from this node's owning Runtime. */
  readonly #internals: IRuntimeInternals
  debugName?: string
  #cleanup: void | IDisposer = undefined
  #disposed = false
  #fn: () => void | IDisposer
  #forceRun = false
  constructor(fn: () => void | IDisposer, runtime: IRuntime, options: IReactiveNodeOptions = {}) {
    this.deps = registerDeps(this, this.#deps)
    this.depVersions = registerDepVersions(this, this.#depVersions)
    this.#fn = fn
    this.runtime = runtime
    // 归属登记走唯一那张表，不再靠字段名让下游去猜
    claimOwnership(this, runtime)
    this.debugName = options.debugName
    this.#internals = internalsOf(runtime)
    this.run()
  }
  get disposed(): boolean {
    return this.#disposed
  }
  markDirty(): void {
    this.#internals.scheduler.enqueue(this)
  }
  tick(): void {
    // 冲刷时调用：仅当依赖真变才重跑
    if (this.#disposed) return
    if (this.#forceRun) {
      this.#forceRun = false
      this.run()
      return
    }
    if (this.#internals.tracker.hasStaleDependencies(this)) this.run()
  }
  onDependencyDisconnected(): void {
    this.#forceRun = true
    this.#internals.scheduler.enqueue(this)
  }
  /**
   * Runs cleanup and the effect body as one terminal-aware transaction. Cleanup may synchronously
   * dispose this effect; that terminal transition must prevent both a rerun and dependency commit.
   */
  run(): void {
    if (this.#disposed) return
    /** This node always uses its original Runtime services. */
    const runtime = this.#internals
    const tracing = runtime.traceEnabled()
    const trace = tracing
      ? createObserverRunTrace(describeObserver(this), {
          now: runtime.now,
          timestamp: runtime.timestamp,
          emitTrace: runtime.emitTrace,
          reportError: (error) =>
            this.runtime.reportError(error, {
              phase: ReactiveErrorPhase.traceListener,
              observer: this
            })
        })
      : undefined
    trace?.start()
    // 先摘掉旧 cleanup 再执行：否则若新 fn 抛错，赋值右侧未完成，this.cleanup 仍指向旧 cleanup，
    // 下次重跑/dispose 会重复执行旧 cleanup（重复 removeEventListener/释放资源/引用计数变负）。
    const previousCleanup = this.#cleanup
    this.#cleanup = undefined
    try {
      if (typeof previousCleanup === 'function') {
        const cleanupResult = this.runtime.untracked(previousCleanup) // cleanup 执行期间不建立依赖
        this.#assertSynchronousResult(cleanupResult, 'effect cleanup')
      }
      if (this.#disposed) return
      /** Candidate cleanup returned by the current body; terminal effects must consume it locally. */
      const nextCleanup = runtime.tracker.runTracked(this, () => {
        const result = this.#fn()
        this.#assertSynchronousResult(result, 'effect body')
        return result
      })
      if (this.#disposed) {
        if (typeof nextCleanup === 'function') {
          const cleanupResult = this.runtime.untracked(nextCleanup)
          this.#assertSynchronousResult(cleanupResult, 'effect cleanup')
        }
        return
      }
      this.#cleanup = nextCleanup
    } catch (error) {
      trace?.error(error)
      throw error
    } finally {
      trace?.end()
    }
  }

  /** Rejects PromiseLike callback results while observing their eventual rejection. */
  #assertSynchronousResult(result: unknown, callback: string): void {
    const inspection = inspectThenable(result)
    if ('error' in inspection) {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.synchronousCallbackReturnedThenable(callback), {
          cause: inspection.error
        }),
        ReactiveErrorCode.invalidOption
      )
    }
    if (inspection.then === undefined) return
    observeThenableRejection(result, inspection, (error) =>
      this.runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush, observer: this })
    )
    throw createReactiveError(
      ReactiveErrorCode.invalidOption,
      ReactiveErrorText.synchronousCallbackReturnedThenable(callback)
    )
  }
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#internals.tracker.clearDependencies(this)
    const previousCleanup = this.#cleanup
    this.#cleanup = undefined
    try {
      if (typeof previousCleanup === 'function') {
        const cleanupResult = this.runtime.untracked(previousCleanup)
        this.#assertSynchronousResult(cleanupResult, 'effect cleanup')
      }
    } finally {
      this.#internals.scheduler.dequeue(this)
    }
  }
}
