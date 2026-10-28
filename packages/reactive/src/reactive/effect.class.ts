/**
 * Owns scheduled effect execution and cleanup; tracker and scheduler retain graph and queue
 * authority.
 */
import type {
  IDisposable,
  IDisposer,
  IObservable,
  IObserver,
  IReactiveNodeOptions,
  IRuntime
} from '../runtime/types.ts'
import { internalsOf, type IRuntimeInternals } from '../runtime/internals.ts'
import { claimOwnership } from '../runtime/ownership.ts'
import { createObserverRunTrace, describeObserver } from '../runtime/diagnostics.ts'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { registerDeps, registerDepVersions } from '../runtime/node-internals.ts'
import { ReactiveErrorPhase } from '../runtime/trace-constants.ts'
import { createReactiveError, tagReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'

/**
 * Scheduled observer whose cleanup and dependency commit respect terminal disposal during
 * execution.
 */
export class Effect implements IObserver, IDisposable {
  /** Canonical dependencies are replaced by tracked execution and cleared on disposal. */
  #deps = new Set<IObservable>()
  /** Recorded upstream versions suppress unnecessary executions during scheduler ticks. */
  #depVersions = new Map<IObservable, number>()
  /** Read-only dependency membership exposes diagnostics without graph mutation authority. */
  readonly deps: ReadonlySet<IObservable>
  /** Read-only versions share the tracker's canonical committed snapshot. */
  readonly depVersions: ReadonlyMap<IObservable, number>
  /** Fixed graph owner supplies all execution and cleanup boundaries. */
  readonly runtime: IRuntime
  /** Immutable kernel services captured once from this node's owning Runtime. */
  readonly #internals: IRuntimeInternals
  /** Optional label identifies this observer in trace and flush-loop diagnostics. */
  debugName?: string
  /** Previous successful body owns one cleanup, consumed before invoking user code again. */
  #cleanup: void | IDisposer = undefined
  /** Terminal state prevents reentrant cleanup from rerunning or reconnecting this observer. */
  #disposed = false
  /** Caller body runs in the tracker and may return one synchronous cleanup. */
  #fn: () => void | IDisposer
  /** Dependency disconnection requires a run even when the remaining version snapshot is unchanged. */
  #forceRun = false
  /** Registers ownership and graph views before the first synchronous body execution. */
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
  /** Reports terminal state without changing queue membership or graph edges. */
  get disposed(): boolean {
    return this.#disposed
  }
  /** Marks pending work through the shared scheduler rather than executing during propagation. */
  markDirty(): void {
    this.#internals.scheduler.enqueue(this)
  }
  /** Executes queued work only when forced or when upstream versions prove the result stale. */
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
  /** A removed route forces retracking so the body can choose its replacement dependency. */
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
    /** Untraced executions avoid allocating diagnostic span state. */
    const tracing = runtime.traceEnabled()
    /** One optional span covers cleanup, body execution and terminal reentrancy. */
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
    /** Consume ownership before user cleanup can throw or dispose the effect reentrantly. */
    const previousCleanup = this.#cleanup
    this.#cleanup = undefined
    try {
      if (typeof previousCleanup === 'function') {
        /** Cleanup runs untracked, and its return value must satisfy synchronous callback admission. */
        const cleanupResult = this.runtime.untracked(previousCleanup) // cleanup 执行期间不建立依赖
        this.#assertSynchronousResult(cleanupResult, 'effect cleanup')
      }
      if (this.#disposed) return
      /** Candidate cleanup returned by the current body; terminal effects must consume it locally. */
      const nextCleanup = runtime.tracker.runTracked(this, () => {
        /** Validate the body result before the tracker can commit a successful dependency frame. */
        const result = this.#fn()
        this.#assertSynchronousResult(result, 'effect body')
        return result
      })
      if (this.#disposed) {
        if (typeof nextCleanup === 'function') {
          /** Terminal reentrancy consumes the new cleanup locally rather than retaining it. */
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
    /** One then inspection preserves getter failure identity and avoids a second then read. */
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
  /**
   * Disposes once, disconnects dependencies and consumes cleanup before always dequeuing the
   * observer.
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#internals.tracker.clearDependencies(this)
    /** Taking the cleanup first makes repeated or reentrant disposal idempotent even when it throws. */
    const previousCleanup = this.#cleanup
    this.#cleanup = undefined
    try {
      if (typeof previousCleanup === 'function') {
        /** Terminal cleanup retains the normal untracked and synchronous-result admission policy. */
        const cleanupResult = this.runtime.untracked(previousCleanup)
        this.#assertSynchronousResult(cleanupResult, 'effect cleanup')
      }
    } finally {
      this.#internals.scheduler.dequeue(this)
    }
  }
}
