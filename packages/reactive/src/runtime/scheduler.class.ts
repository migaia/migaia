import type { IFlushable, IFlushResult, ISchedulerStrategy } from './types.js';
import { createReactiveError, tagReactiveError } from '../errors.js';
import { ReactiveErrorCode } from '../error-code.js';
import { defaultRuntimeAdapter } from './default-runtime-adapter.js';
import { ReactiveErrorPhase } from './trace-constants.js';

/** 只读 `cause`，hostile getter 抛错时按 `undefined` 处理（诊断通道不反向破坏结果）。 */
const readCauseSafely = (error: Error): unknown => {
  try {
    return error.cause;
  } catch {
    return undefined;
  }
};

/** 用 `defineProperty` 安全附加 `cause`；失败（frozen / non-extensible）返回 false。 */
const attachCauseSafely = (error: Error, cause: unknown): boolean => {
  try {
    Object.defineProperty(error, 'cause', {
      value: cause,
      enumerable: true,
      configurable: true,
      writable: true
    });
    return true;
  } catch {
    return false;
  }
};

// 调度器：待冲刷队列、批处理深度、冲刷状态、可插拔触发策略全部收在这一个类里。
export class Scheduler {
  /**
   * 自触发环保护：effect 写了自己也读的 signal 会导致无限重入。
   *
   * 默认 100，但**可配置**——它是「一次冲刷里允许几轮」的策略参数，不是物理常数。 写死之后，合法的深链场景（一条长派生链每轮只推进一级）与真正的环无法区分， 而调用方连调都调不了。
   */
  #maxFlushPasses: number;

  batchDepth = 0;
  #flushing = false;
  #scheduled = false;
  #queued = new Set<IFlushable>();
  #strategy: ISchedulerStrategy;
  #onAsyncError: (error: unknown) => void;

  constructor(
    onAsyncError: (error: unknown) => void = (error) =>
      defaultRuntimeAdapter.reportError(error, { phase: ReactiveErrorPhase.asyncFlush }),
    maxFlushPasses = 100,
    scheduleMicrotask: (task: () => void) => void = defaultRuntimeAdapter.scheduleMicrotask
  ) {
    if (!Number.isSafeInteger(maxFlushPasses) || maxFlushPasses < 1) {
      throw tagReactiveError(
        new RangeError('[store] maxFlushPasses must be a positive integer'),
        ReactiveErrorCode.invalidOption
      );
    }
    this.#onAsyncError = onAsyncError;
    this.#maxFlushPasses = maxFlushPasses;
    // 默认冲刷走注入的微任务调度入口，不直接 queueMicrotask。
    this.#strategy = (flush) => scheduleMicrotask(flush);
  }

  /** 替换触发策略：默认微任务合并，可换 rAF/idle/优先级队列/自定义分片 */
  setStrategy(strategy: ISchedulerStrategy): void {
    this.#strategy = strategy;
  }

  /** 把一项加入待冲刷队列；不在批处理里就立刻申请一次冲刷 */
  enqueue(item: IFlushable): void {
    this.#queued.add(item);
    if (this.batchDepth === 0) this.requestFlush();
  }

  /** 从队列移除（比如 effect dispose 时，避免已销毁的实例还留在队列里） */
  dequeue(item: IFlushable): void {
    this.#queued.delete(item);
  }

  /** 申请一次冲刷——signal 写入/notifySource 也会各自调用它； 重复调用是安全的，scheduled/flushing 两个标记天然去重，不会重复触发 */
  requestFlush(): void {
    if (this.#scheduled || this.#flushing) return;
    this.#scheduled = true;
    let insideStrategyCall = true;
    try {
      this.#strategy(() => {
        this.#scheduled = false;
        try {
          this.flush();
        } catch (error) {
          if (insideStrategyCall) throw error;
          this.#onAsyncError(error);
        }
      });
    } catch (error) {
      // A broken custom strategy must not permanently wedge future scheduling.
      this.#scheduled = false;
      throw error;
    } finally {
      insideStrategyCall = false;
    }
  }

  /**
   * 冲刷全部待执行项（合并为一轮）。
   *
   * 冲刷期间重入返回 `deferred`。最外层 while 最终仍会排空新加入的队列，但内层 `flush()` 无法兑现「返回时本次待办已经执行」；返回判别值让调用方看见这个
   * 差异，同时不把合法的 action/devtools 重入升级成 observer 错误。
   */
  flush(): IFlushResult {
    if (this.#flushing) return 'deferred';
    this.#flushing = true;
    try {
      let passes = 0;
      const errors: unknown[] = [];
      while (this.#queued.size) {
        if (++passes > this.#maxFlushPasses) {
          // 这不是渲染次数触发的抖动，是反应式图本身有环——effect 的写操作又落回了它自己的依赖。
          // 挡不住图内部的自触发发散，调度器必须单独兜底，避免整个 tab 卡死在同步死循环里。
          //
          // 队列必须清空，否则下一次冲刷会立刻再撞上同一个环、再抛一次，
          // Runtime 从此不可用。但**清掉什么必须说出来**：丢弃待办而只报
          // 「超限」，等于让调用方去猜哪些 effect 没跑。
          const dropped = [...this.#queued];
          this.#queued.clear();
          const names = dropped.map((item) => item.debugName ?? '<anonymous>').slice(0, 8);
          const loopError = createReactiveError(
            ReactiveErrorCode.flushLoop,
            '[store] possible infinite effect loop: exceeded ' +
              this.#maxFlushPasses +
              ' flush passes; dropped ' +
              dropped.length +
              ' pending item(s): ' +
              names.join(', ') +
              (dropped.length > names.length ? ', …' : '')
          );
          if (errors.length === 0) throw loopError;
          throw tagReactiveError(
            new AggregateError(
              [...errors, loopError],
              '[store] observers failed before the flush-loop guard fired'
            ),
            ReactiveErrorCode.observerFailed
          );
        }
        const batch = [...this.#queued];
        this.#queued.clear();
        for (const item of batch) {
          try {
            item.tick(); // tick 内做版本脏校验，未变则跳过
          } catch (error) {
            // One bad observer must not discard unrelated work from this batch.
            errors.push(error);
          }
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) {
        throw tagReactiveError(
          new AggregateError(errors, '[store] multiple observers failed during flush'),
          ReactiveErrorCode.observerFailed
        );
      }
      return 'completed';
    } finally {
      this.#flushing = false;
    }
  }

  /**
   * 显式批处理：进入时计深度，最外层退出才真正冲刷一次。 错误优先级：若 fn（业务动作）抛错 A，且随后 flush 又抛错 B，优先抛出业务错误 A（B 附在 cause 上），
   * 避免原始业务错误被 finally 里的 flush 错误覆盖掉。
   */
  runBatched<T>(fn: () => T): T {
    this.batchDepth++;
    let fnError: unknown;
    let hasFnError = false;
    let result: T;
    try {
      result = fn();
    } catch (error) {
      fnError = error;
      hasFnError = true;
    }
    if (--this.batchDepth === 0 && !this.#flushing) {
      try {
        this.flush();
      } catch (flushError) {
        if (!hasFnError) throw flushError; // 只有 flush 出错 → 抛 flush 错误
        // Error 对象保持身份/类型；flush 错误挂到 cause。非 Error throw 值无法安全附加元数据。
        if (fnError instanceof Error) {
          const previousCause = readCauseSafely(fnError);
          const mergedCause =
            previousCause === undefined
              ? flushError
              : tagReactiveError(
                  new AggregateError(
                    [previousCause, flushError],
                    '[store] action cause and subsequent flush both failed'
                  ),
                  ReactiveErrorCode.actionFlushFailed
                );
          // Attach, don't replace — but a frozen / non-extensible business Error cannot be safely
          // mutated. Fall through to the AggregateError wrapper so both errors stay `===` reachable.
          if (attachCauseSafely(fnError, mergedCause)) throw fnError;
        }
        throw tagReactiveError(
          new AggregateError(
            [fnError, flushError],
            '[store] action failed; a subsequent flush also failed'
          ),
          ReactiveErrorCode.actionFlushFailed
        );
      }
    }
    // 在 observer tick 内结束的 batch 由当前最外层 flush 的 while 接管。
    // 这里不调用重入 flush；它不是一次被忽略的显式请求，而是同一调度事务的收尾。
    if (hasFnError) throw fnError;
    return result!;
  }

  /**
   * Delay scheduling until a notification fan-out has marked every subscriber. Unlike a user batch,
   * this preserves the configured async/sync strategy.
   */
  runDeferred<T>(fn: () => T): T {
    this.batchDepth++;
    try {
      return fn();
    } finally {
      if (--this.batchDepth === 0 && this.#queued.size > 0) this.requestFlush();
    }
  }
}
