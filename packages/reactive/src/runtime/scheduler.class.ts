import type { IFlushable, IFlushResult, ISchedulerStrategy } from './types.js'
import { createReactiveError, tagReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'
import { defaultRuntimeAdapter } from './default-runtime-adapter.js'
import {
  assimilateCapturedThen,
  inspectThenable as inspectCallbackThenable,
  observeThenableRejection,
  probeThenable,
  ThenableProbeKind
} from '@migaia/utils/function'
import { tryReadProperty } from '@migaia/utils/error'
import { ReactiveErrorPhase, type IReactiveErrorPhase } from './trace-constants.js'

/** 用 `defineProperty` 安全附加 `cause`；失败（frozen / non-extensible）返回 false。 */
const attachCauseSafely = (error: Error, cause: unknown): boolean => {
  try {
    Object.defineProperty(error, 'cause', {
      value: cause,
      enumerable: true,
      configurable: true,
      writable: true
    })
    return true
  } catch {
    return false
  }
}

// Owns the pending flush queue, batch depth, flush state, and replaceable trigger strategy.
export class Scheduler {
  /**
   * 自触发环保护：effect 写了自己也读的 signal 会导致无限重入。
   *
   * 默认 100，但**可配置**——它是「同一 observer 在一次冲刷里允许执行几次」的预算，不是队列批次数。合法的深链每个 observer 只执行一次，不会被误判为环。
   */
  #maxFlushPasses: number

  batchDepth = 0
  #flushing = false
  #scheduled = false
  /** Monotonic identity for the currently admitted scheduling request. */
  #scheduleGeneration = 0
  #queued = new Set<IFlushable>()
  /** Strategy currently selected by the caller; it may not yet satisfy the runtime contract. */
  #strategy: ISchedulerStrategy
  /** Last strategy that returned a non-thenable, or the injected default strategy. */
  #safeStrategy: ISchedulerStrategy
  /** Reports scheduler failures, optionally identifying the cause-read phase. */
  #onAsyncError: (error: unknown, phase?: IReactiveErrorPhase) => void

  /** Consumes the flush bound already admitted by the public Runtime constructor. */
  constructor(
    onAsyncError: (error: unknown, phase?: IReactiveErrorPhase) => void = (error, phase) =>
      defaultRuntimeAdapter.reportError(error, { phase: phase ?? ReactiveErrorPhase.asyncFlush }),
    maxFlushPasses = 100,
    scheduleMicrotask: (task: () => void) => void = defaultRuntimeAdapter.scheduleMicrotask
  ) {
    this.#onAsyncError = onAsyncError
    this.#maxFlushPasses = maxFlushPasses
    // 默认冲刷走注入的微任务调度入口，不直接 queueMicrotask。
    const defaultStrategy: ISchedulerStrategy = (flush) => scheduleMicrotask(flush)
    this.#strategy = defaultStrategy
    this.#safeStrategy = defaultStrategy
  }

  /**
   * Replaces trigger strategy; rejects non-callable runtime values before changing current
   * strategy.
   */
  setStrategy(strategy: ISchedulerStrategy): void {
    if (typeof strategy !== 'function') {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.schedulerStrategyInvalid),
        ReactiveErrorCode.invalidOption
      )
    }
    this.#strategy = strategy
  }

  /** Enqueues an item and requests a flush immediately when no batch is active. */
  enqueue(item: IFlushable): void {
    this.#queued.add(item)
    if (this.batchDepth === 0) this.requestFlush()
  }

  /** Removes an item from the queue, for example when an effect is disposed. */
  dequeue(item: IFlushable): void {
    this.#queued.delete(item)
  }

  /**
   * Requests a flush. Signal writes and source notifications also use this path. Scheduling and
   * flushing flags deduplicate repeated requests.
   */
  requestFlush(): void {
    if (this.#scheduled || this.#flushing) return
    this.#scheduled = true
    const generation = ++this.#scheduleGeneration
    const strategy = this.#strategy
    let insideStrategyCall = true
    let synchronousFlushError: unknown
    const flush = (): void => {
      if (generation !== this.#scheduleGeneration) return
      // A strategy callback is valid for one scheduling request only. Retiring its generation
      // before flushing also makes a duplicate invocation from the same strategy a no-op.
      this.#scheduleGeneration++
      this.#scheduled = false
      try {
        this.flush()
      } catch (error) {
        if (insideStrategyCall) {
          synchronousFlushError = error
          throw error
        }
        try {
          this.#onAsyncError(error)
        } catch {
          // Error reporting is terminal; it must not create a second scheduler failure.
        }
      }
    }
    try {
      const result = (strategy as (flush: () => void) => unknown)(flush)
      insideStrategyCall = false
      /** Shared probe retains the original getter failure and captured then method. */
      const inspected = probeThenable(result)
      if (inspected.kind === ThenableProbeKind.notThenable) {
        if (this.#strategy === strategy) this.#safeStrategy = strategy
        return
      }
      this.#recoverFromStrategyFailure(strategy, generation)
      if (inspected.kind === ThenableProbeKind.failed) {
        this.#reportStrategyFailure(
          strategy,
          generation,
          tagReactiveError(
            new TypeError(ReactiveErrorText.schedulerStrategyReturnedThenable, {
              cause: inspected.error
            }),
            ReactiveErrorCode.invalidOption
          )
        )
        return
      }
      const settled = assimilateCapturedThen(inspected.thenFn, result)
      void settled.then(
        () => {
          this.#reportStrategyFailure(
            strategy,
            generation,
            tagReactiveError(
              new TypeError(ReactiveErrorText.schedulerStrategyReturnedThenable),
              ReactiveErrorCode.invalidOption
            )
          )
        },
        (error: unknown) => {
          this.#reportStrategyFailure(
            strategy,
            generation,
            tagReactiveError(
              new TypeError(ReactiveErrorText.schedulerStrategyReturnedThenable, { cause: error }),
              ReactiveErrorCode.invalidOption
            )
          )
        }
      )
    } catch (error) {
      if (synchronousFlushError === error) throw error
      this.#recoverFromStrategyFailure(strategy, generation)
      throw error
    } finally {
      insideStrategyCall = false
    }
  }

  /**
   * Restores a safe scheduler and reports one strategy failure without escaping the reactive
   * boundary.
   */
  #recoverFromStrategyFailure(strategy: ISchedulerStrategy, generation: number): void {
    if (this.#strategy === strategy) this.#strategy = this.#safeStrategy
    if (this.#scheduleGeneration !== generation) return
    this.#scheduleGeneration++
    this.#scheduled = false
  }

  /** Reports an invalid strategy result without disturbing a newer scheduling request. */
  #reportStrategyFailure(strategy: ISchedulerStrategy, generation: number, error: Error): void {
    this.#recoverFromStrategyFailure(strategy, generation)
    try {
      this.#onAsyncError(error)
    } catch {
      // Error reporting is terminal; it must not wedge future scheduling.
    }
  }

  /**
   * Flushes all pending items as one scheduling transaction.
   *
   * A reentrant call during flushing returns `deferred`. The outer loop drains newly enqueued work,
   * but the inner call cannot promise completion before returning. The result exposes this
   * distinction without treating valid action or DevTools reentrancy as an observer failure.
   */
  flush(): IFlushResult {
    if (this.#flushing) return 'deferred'
    this.#flushing = true
    try {
      /** Single-pass flushes need no ledger; repeat work seeds first-pass counts lazily. */
      let executions: Map<IFlushable, number> | undefined
      /** The first queue snapshot already owns the exact first execution membership. */
      let firstBatch: IFlushable[] | undefined
      const errors: unknown[] = []
      while (this.#queued.size) {
        const batch = [...this.#queued]
        this.#queued.clear()
        if (firstBatch === undefined) firstBatch = batch
        else if (executions === undefined) {
          executions = new Map()
          for (const item of firstBatch) executions.set(item, 1)
        }
        for (let index = 0; index < batch.length; index++) {
          const item = batch[index]
          /** Runtime admission guarantees a positive budget, so first-pass count one is safe. */
          const executionCount = executions === undefined ? 1 : (executions.get(item) ?? 0) + 1
          executions?.set(item, executionCount)
          if (executionCount > this.#maxFlushPasses) {
            // Keep the unprocessed batch suffix alongside reentrant work in the diagnostic ledger.
            const dropped = [...batch.slice(index), ...this.#queued]
            this.#queued.clear()
            const names = dropped.map((queued) => queued.debugName ?? '<anonymous>').slice(0, 8)
            const loopError = createReactiveError(
              ReactiveErrorCode.flushLoop,
              ReactiveErrorText.flushLoopDetected(this.#maxFlushPasses, dropped.length, names)
            )
            if (errors.length === 0) throw loopError
            throw tagReactiveError(
              new AggregateError(
                [...errors, loopError],
                ReactiveErrorText.observersBeforeFlushLoop
              ),
              ReactiveErrorCode.observerFailed
            )
          }
          try {
            item.tick() // tick 内做版本脏校验，未变则跳过
          } catch (error) {
            // One bad observer must not discard unrelated work from this batch.
            errors.push(error)
          }
        }
      }
      if (errors.length === 1) throw errors[0]
      if (errors.length > 1) {
        throw tagReactiveError(
          new AggregateError(errors, ReactiveErrorText.multipleObserversFailed),
          ReactiveErrorCode.observerFailed
        )
      }
      return 'completed'
    } finally {
      this.#flushing = false
    }
  }

  /**
   * Runs an explicit batch. Entry increments batch depth; only the outermost exit flushes.
   *
   * If the business action throws and the final flush also fails, the business error takes
   * priority. When that error accepts a `cause`, the flush error is attached without replacing it.
   * Otherwise an aggregate retains both original failures, so final cleanup cannot hide the
   * business failure.
   */
  runBatched<T>(fn: () => T): T {
    return this.#runBatched(fn, undefined, false)
  }

  /** Runs one bound internal operation without allocating a callback closure for its argument. */
  runBatchedWith<TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg): TResult {
    return this.#runBatched(fn, arg, true)
  }

  /** Shares error priority and final flushing while retaining the public callback's zero arguments. */
  #runBatched<TArg, T>(fn: (arg: TArg) => T, arg: TArg, withArgument: boolean): T {
    this.batchDepth++
    let fnError: unknown
    let hasFnError = false
    let result: T
    try {
      result = withArgument ? fn(arg) : (fn as () => T)()
      const inspection = inspectCallbackThenable(result)
      if ('error' in inspection) {
        throw tagReactiveError(
          new TypeError(ReactiveErrorText.synchronousCallbackReturnedThenable('batch callback'), {
            cause: inspection.error
          }),
          ReactiveErrorCode.invalidOption
        )
      }
      if (inspection.then !== undefined) {
        observeThenableRejection(result, inspection, (error) => {
          try {
            this.#onAsyncError(error)
          } catch {
            // The terminal diagnostic sink cannot create another failure.
          }
        })
        throw tagReactiveError(
          new TypeError(ReactiveErrorText.synchronousCallbackReturnedThenable('batch callback')),
          ReactiveErrorCode.invalidOption
        )
      }
    } catch (error) {
      fnError = error
      hasFnError = true
    }
    if (--this.batchDepth === 0 && !this.#flushing) {
      try {
        this.flush()
      } catch (flushError) {
        if (!hasFnError) throw flushError // 只有 flush 出错 → 抛 flush 错误
        // Error 对象保持身份/类型；flush 错误挂到 cause。非 Error throw 值无法安全附加元数据。
        if (fnError instanceof Error) {
          const read = tryReadProperty(fnError, 'cause')
          if (read.threw) {
            /** Preserve the business, flush, and getter failures before invoking a reporter. */
            const failures: unknown[] = [fnError, flushError, read.error]
            try {
              this.#onAsyncError(read.error, ReactiveErrorPhase.causeRead)
            } catch (reporterError) {
              failures.push(reporterError)
            }
            throw tagReactiveError(
              new AggregateError(failures, ReactiveErrorText.actionAndFlushFailed),
              ReactiveErrorCode.actionFlushFailed
            )
          }
          const previousCause = read.value
          const mergedCause =
            previousCause === undefined
              ? flushError
              : tagReactiveError(
                  new AggregateError(
                    [previousCause, flushError],
                    ReactiveErrorText.actionCauseAndFlushFailed
                  ),
                  ReactiveErrorCode.actionFlushFailed
                )
          // Attach, don't replace — but a frozen / non-extensible business Error cannot be safely
          // mutated. Fall through to the AggregateError wrapper so both errors stay `===` reachable.
          if (attachCauseSafely(fnError, mergedCause)) throw fnError
        }
        throw tagReactiveError(
          new AggregateError([fnError, flushError], ReactiveErrorText.actionAndFlushFailed),
          ReactiveErrorCode.actionFlushFailed
        )
      }
    }
    // 在 observer tick 内结束的 batch 由当前最外层 flush 的 while 接管。
    // 这里不调用重入 flush；它不是一次被忽略的显式请求，而是同一调度事务的收尾。
    if (hasFnError) throw fnError
    return result!
  }

  /**
   * Delay scheduling until a notification fan-out has marked every subscriber. Unlike a user batch,
   * this preserves the configured async/sync strategy.
   */
  runDeferred<TArg, TResult>(fn: (arg: TArg) => TResult, arg: TArg): TResult {
    this.batchDepth++
    try {
      return fn(arg)
    } finally {
      if (--this.batchDepth === 0 && this.#queued.size > 0) this.requestFlush()
    }
  }
}
