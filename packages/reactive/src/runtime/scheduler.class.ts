import type { IFlushable, IFlushResult, ISchedulerStrategy } from './types.js'
import { createReactiveError, tagReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'
import { defaultRuntimeAdapter } from './default-runtime-adapter.js'
import {
  assimilateThenable,
  inspectThenable as inspectCallbackThenable,
  observeThenableRejection
} from './receiver.js'
import { ReactiveErrorPhase } from './trace-constants.js'

type IThenableInspection =
  | { readonly handler: (resolve: unknown, reject: unknown) => void }
  | { readonly error: unknown }
  | undefined

/** Reads a returned scheduler value once, preserving hostile `.then` getter failures as data. */
function inspectThenable(value: unknown): IThenableInspection {
  if ((value === null || typeof value !== 'object') && typeof value !== 'function') {
    return undefined
  }
  try {
    const then = (value as { then?: unknown }).then
    return typeof then === 'function'
      ? { handler: then as (resolve: unknown, reject: unknown) => void }
      : undefined
  } catch (error) {
    return { error }
  }
}

/** 只读 `cause`，hostile getter 抛错时按 `undefined` 处理（诊断通道不反向破坏结果）。 */
const readCauseSafely = (error: Error): unknown => {
  try {
    return error.cause
  } catch {
    return undefined
  }
}

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

// 调度器：待冲刷队列、批处理深度、冲刷状态、可插拔触发策略全部收在这一个类里。
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
  #onAsyncError: (error: unknown) => void

  constructor(
    onAsyncError: (error: unknown) => void = (error) =>
      defaultRuntimeAdapter.reportError(error, { phase: ReactiveErrorPhase.asyncFlush }),
    maxFlushPasses = 100,
    scheduleMicrotask: (task: () => void) => void = defaultRuntimeAdapter.scheduleMicrotask
  ) {
    if (!Number.isSafeInteger(maxFlushPasses) || maxFlushPasses < 1) {
      throw tagReactiveError(
        new RangeError(ReactiveErrorText.maxFlushPassesInvalid),
        ReactiveErrorCode.invalidOption
      )
    }
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

  /** 把一项加入待冲刷队列；不在批处理里就立刻申请一次冲刷 */
  enqueue(item: IFlushable): void {
    this.#queued.add(item)
    if (this.batchDepth === 0) this.requestFlush()
  }

  /** 从队列移除（比如 effect dispose 时，避免已销毁的实例还留在队列里） */
  dequeue(item: IFlushable): void {
    this.#queued.delete(item)
  }

  /** 申请一次冲刷——signal 写入/notifySource 也会各自调用它； 重复调用是安全的，scheduled/flushing 两个标记天然去重，不会重复触发 */
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
      const inspected = inspectThenable(result)
      if (inspected === undefined) {
        if (this.#strategy === strategy) this.#safeStrategy = strategy
        return
      }
      this.#recoverFromStrategyFailure(strategy, generation)
      if ('error' in inspected) {
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
      const settled = assimilateThenable(inspected.handler, result)
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
   * 冲刷全部待执行项（合并为一轮）。
   *
   * 冲刷期间重入返回 `deferred`。最外层 while 最终仍会排空新加入的队列，但内层 `flush()` 无法兑现「返回时本次待办已经执行」；返回判别值让调用方看见这个
   * 差异，同时不把合法的 action/devtools 重入升级成 observer 错误。
   */
  flush(): IFlushResult {
    if (this.#flushing) return 'deferred'
    this.#flushing = true
    try {
      const executions = new Map<IFlushable, number>()
      const errors: unknown[] = []
      while (this.#queued.size) {
        const batch = [...this.#queued]
        this.#queued.clear()
        for (let index = 0; index < batch.length; index++) {
          const item = batch[index]
          const executionCount = (executions.get(item) ?? 0) + 1
          executions.set(item, executionCount)
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
   * 显式批处理：进入时计深度，最外层退出才真正冲刷一次。 错误优先级：若 fn（业务动作）抛错 A，且随后 flush 又抛错 B，优先抛出业务错误 A（B 附在 cause 上），
   * 避免原始业务错误被 finally 里的 flush 错误覆盖掉。
   */
  runBatched<T>(fn: () => T): T {
    this.batchDepth++
    let fnError: unknown
    let hasFnError = false
    let result: T
    try {
      result = fn()
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
          const previousCause = readCauseSafely(fnError)
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
  runDeferred<T>(fn: () => T): T {
    this.batchDepth++
    try {
      return fn()
    } finally {
      if (--this.batchDepth === 0 && this.#queued.size > 0) this.requestFlush()
    }
  }
}
