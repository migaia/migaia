import { DependencyTracker } from './dependency-tracker.class.js';
import { Scheduler } from './scheduler.class.js';
import { VersionClock } from './version-clock.class.js';
import { defaultRuntimeAdapter } from './default-runtime-adapter.js';
import { internalsOf, registerInternals } from './internals.js';
import { assertReactiveOwnedBy } from './ownership.js';
import { setVersion } from './node-internals.js';
import { consumePendingCopyWarning, noteRuntimeCopy } from './copy-check.js';
import { createReactiveError, tagReactiveError } from '../errors.js';
import { ReactiveErrorCode } from '../error-code.js';
import {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from './trace-constants.js';
import {
  containDiagnosticRejection,
  describeObservable,
  sanitizeErrorContext,
  sanitizeTraceEvent
} from './diagnostics.js';
import {
  RUNTIME_BRAND,
  type IDisposer,
  type IFlushResult,
  type IObservable,
  type IReactiveNodeOptions,
  type IRuntime,
  type IRuntimeErrorContext,
  type IRuntimeErrorReportContext,
  type IRuntimeOptions,
  type IRuntimeTraceEvent,
  type ISchedulerStrategy
} from './types.js';
import { Signal } from '../reactive/signal.class.js';
import { Computed, type IComputedConfig } from '../reactive/computed.class.js';
import { Effect } from '../reactive/effect.class.js';

// 一个 Runtime = 一套独立的版本时钟 + 依赖追踪上下文 + 冲刷调度器 + 节点工厂。
// 同一个 Runtime 内的节点共享一张依赖图、一条单调版本时钟；不同 Runtime 之间完全隔离。
// 这是去全局单例化的核心：解决 SSR 每请求状态串线、单测互相污染、多 React root 互相影响、
// 每个 Runtime 独立 scheduler、Worker Runtime、DevTools 无法区分 Store 等一系列问题。
//
// 节点工厂放在 Runtime 上（runtime.signal/computed/effect），保证「谁创建的节点属于谁的图」。
// 全局 signal()/computed()/effect()（kernel.ts）只是委派给 defaultRuntime 的便捷别名。
export class Runtime implements IRuntime {
  readonly [RUNTIME_BRAND] = true as const;
  #onError: (error: unknown, context: IRuntimeErrorContext) => void;
  #traceListeners = new Set<(event: IRuntimeTraceEvent) => void>();

  constructor(options: IRuntimeOptions = {}) {
    // 入口快照并校验 adapter 字段（AF-25/AF-28）：先 try/catch 读取自有字段（hostile getter 包装为
    // INVALID_OPTION + cause），只把「函数」字段写入 resolved adapter——显式 `undefined` 视为 omitted、
    // 不覆盖默认实现，杜绝「校验放行、spread 覆盖默认、首用裸抛」。
    const adapter = { ...defaultRuntimeAdapter };
    if (options.adapter !== undefined) {
      for (const key of ['scheduleMicrotask', 'now', 'timestamp', 'reportError'] as const) {
        let value: unknown;
        try {
          value = options.adapter[key];
        } catch (error) {
          throw tagReactiveError(
            new TypeError(`[store] runtime adapter "${key}" getter failed`, { cause: error }),
            ReactiveErrorCode.invalidOption
          );
        }
        if (value === undefined) continue; // 显式 undefined = omitted，保留默认
        if (typeof value !== 'function') {
          throw tagReactiveError(
            new TypeError(`[store] runtime adapter "${key}" must be a function`),
            ReactiveErrorCode.invalidOption
          );
        }
        adapter[key] = value as never;
      }
    }
    const clock = new VersionClock();
    const tracker = new DependencyTracker(this);
    this.#onError = options.onError ?? adapter.reportError;
    if (options.onTrace) this.#traceListeners.add(options.onTrace);
    const traceEnabled = (): boolean => this.#traceListeners.size > 0;
    const emitTrace = (event: IRuntimeTraceEvent): void => {
      const snapshot = sanitizeTraceEvent(event);
      for (const listener of Array.from(this.#traceListeners)) {
        try {
          // Dependency-edge traces fire while commit still owns an active
          // tracking frame. Diagnostic reads must never join that graph.
          const result: unknown = tracker.untracked(() => listener(snapshot));
          containDiagnosticRejection(result, (error) =>
            this.reportError(error, { phase: ReactiveErrorPhase.traceListener })
          );
        } catch (error) {
          this.reportError(error, { phase: ReactiveErrorPhase.traceListener });
        }
      }
    };
    const scheduler = new Scheduler(
      (error) => this.reportError(error, { phase: ReactiveErrorPhase.asyncFlush }),
      options.maxFlushPasses,
      adapter.scheduleMicrotask
    );
    // 通知闭包只保存在 WeakMap 内部面。Runtime 实例本身没有 notify 方法，
    // 因而第三方不能拿一个伪造节点绕过受控节点 API。
    const publish = (source: IObservable, version: number): void => {
      assertReactiveOwnedBy(source, this, 'observable');
      setVersion(source, version);
      if (traceEnabled()) {
        emitTrace({
          type: ReactiveTraceType.observableChange,
          timestamp: adapter.timestamp(),
          observable: describeObservable(source),
          reason: ReactiveTraceReason.notify
        });
      }
      scheduler.runDeferred(() => {
        for (const subscriber of Array.from(source.subs)) subscriber.markDirty();
      });
    };
    const notify = (source: IObservable): void => {
      publish(source, clock.next());
    };
    const commitSource = <T>(source: IObservable, write: () => T): T => {
      assertReactiveOwnedBy(source, this, 'observable');
      // Reserve the version before user code runs. A failed write consumes a
      // clock slot but never publishes a partial source update.
      const version = clock.next();
      const result = write();
      publish(source, version);
      return result;
    };
    // 内部面只经 WeakMap 暴露；拿到 Runtime 的第三方无法沿引用链摸到图。
    const deferIdle = options.scheduleIdle ?? adapter.scheduleMicrotask;
    registerInternals(this, {
      clock,
      tracker,
      scheduler,
      now: adapter.now,
      timestamp: adapter.timestamp,
      traceEnabled,
      emitTrace,
      notify,
      commitSource,
      deferIdle
    });
    // 多副本警告发生在 Runtime 建立前（createRuntime 先 noteRuntimeCopy 再 new）——经 `reportError` 的
    // containment 上报：reporter 同步抛/异步拒绝都不会破坏构造、不会产生 unhandled rejection（AF-18）。
    const copyWarning = consumePendingCopyWarning();
    if (copyWarning !== undefined) {
      this.reportError(createReactiveError(ReactiveErrorCode.copyConflict, copyWarning), {
        phase: ReactiveErrorPhase.lifecycleHook
      });
    }
  }

  signal<T>(value: T, options?: IReactiveNodeOptions): Signal<T> {
    return new Signal(value, this, options);
  }
  computed<T>(fn: () => T, config?: IComputedConfig<T>): Computed<T> {
    return new Computed(fn, this, config);
  }
  effect(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IDisposer {
    const e = new Effect(fn, this, options);
    return () => e.dispose();
  }
  batch<T>(fn: () => T): T {
    return internalsOf(this).scheduler.runBatched(fn);
  }
  untracked<T>(fn: () => T): T {
    return internalsOf(this).tracker.untracked(fn);
  }
  flush(): IFlushResult {
    return internalsOf(this).scheduler.flush();
  }
  setSchedulerStrategy(strategy: ISchedulerStrategy): void {
    internalsOf(this).scheduler.setStrategy(strategy);
  }
  currentVersion(): number {
    return internalsOf(this).clock.current();
  }
  runTracedAction<T>(name: string, fn: () => T): T {
    if (typeof name !== 'string' || name.length === 0) {
      throw tagReactiveError(
        new TypeError('[store] traced action name must be a non-empty string'),
        ReactiveErrorCode.invalidOption
      );
    }
    const diagnostics = internalsOf(this);
    if (!diagnostics.traceEnabled()) return fn();
    const startedAt = diagnostics.now();
    diagnostics.emitTrace({
      type: ReactiveTraceType.action,
      timestamp: diagnostics.timestamp(),
      phase: ReactiveTracePhase.start,
      name
    });
    try {
      const result = fn();
      diagnostics.emitTrace({
        type: ReactiveTraceType.action,
        timestamp: diagnostics.timestamp(),
        phase: ReactiveTracePhase.end,
        name,
        durationMs: diagnostics.now() - startedAt
      });
      return result;
    } catch (error) {
      diagnostics.emitTrace({
        type: ReactiveTraceType.action,
        timestamp: diagnostics.timestamp(),
        phase: ReactiveTracePhase.error,
        name,
        durationMs: diagnostics.now() - startedAt,
        error
      });
      throw error;
    }
  }
  reportError(error: unknown, context: IRuntimeErrorReportContext): void {
    try {
      // Lifecycle failures can be reported from inside dependency commit.
      // Reporter reads are diagnostics, not observer dependencies.
      const result: unknown = internalsOf(this).tracker.untracked(() =>
        this.#onError(error, sanitizeErrorContext(context))
      );
      containDiagnosticRejection(result, () => {
        // onError itself is the terminal error channel.
      });
    } catch {
      // 诊断通道不得反向破坏依赖图提交。
    }
  }
  subscribeTrace(listener: (event: IRuntimeTraceEvent) => void): IDisposer {
    this.#traceListeners.add(listener);
    return () => this.#traceListeners.delete(listener);
  }
}

/** 新建一个隔离运行时——SSR 每请求一个、每个测试用例一个、Worker 一个… */
export function createRuntime(options?: IRuntimeOptions): Runtime {
  // 双实例自检（copy-check.ts）：创建 Runtime 是首个正确性边界，登记本副本，使
  // runtimeCopyCount()/assertSingleRuntimeCopy() 能发现「两份模块副本」的部署错误。
  noteRuntimeCopy();
  return new Runtime(options);
}
