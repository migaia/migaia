import { DependencyTracker } from './dependency-tracker.class';
import { Scheduler } from './scheduler.class';
import { VersionClock } from './version-clock.class';
import { Scope } from './scope.class';
import { internalsOf, registerInternals } from './internals';
import { assertReactiveOwnedBy } from './ownership';
import { setVersion } from './node-internals';
import {
  containDiagnosticRejection,
  describeObservable,
  sanitizeErrorContext,
  sanitizeTraceEvent
} from './diagnostics';
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
} from './types';
import { Signal } from '../reactive/signal.class';
import { Computed, type IComputedConfig } from '../reactive/computed.class';
import { Effect } from '../reactive/effect.class';

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
    const clock = new VersionClock();
    const tracker = new DependencyTracker(this);
    this.#onError =
      options.onError ??
      ((error, context) => {
        console.error(`[store] reactive ${context.phase} error`, error);
      });
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
            this.reportError(error, { phase: 'trace-listener' })
          );
        } catch (error) {
          this.reportError(error, { phase: 'trace-listener' });
        }
      }
    };
    const scheduler = new Scheduler(
      (error) => this.reportError(error, { phase: 'async-flush' }),
      options.maxFlushPasses
    );
    // 通知闭包只保存在 WeakMap 内部面。Runtime 实例本身没有 notify 方法，
    // 因而第三方不能拿一个伪造节点绕过受控节点 API。
    const publish = (source: IObservable, version: number): void => {
      assertReactiveOwnedBy(source, this, 'observable');
      setVersion(source, version);
      if (traceEnabled()) {
        emitTrace({
          type: 'observable-change',
          timestamp: Date.now(),
          observable: describeObservable(source),
          reason: 'notify'
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
    const deferIdle = options.scheduleIdle ?? ((task) => queueMicrotask(task));
    registerInternals(this, {
      clock,
      tracker,
      scheduler,
      traceEnabled,
      emitTrace,
      notify,
      commitSource,
      deferIdle
    });
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
  // 新建一个所有权作用域——Store 用它统一持有/释放内部 Computed/Effect 等资源
  createScope(): Scope {
    return new Scope();
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
      throw new TypeError('[store] traced action name must be a non-empty string');
    }
    const diagnostics = internalsOf(this);
    if (!diagnostics.traceEnabled()) return fn();
    const startedAt = now();
    diagnostics.emitTrace({
      type: 'action',
      timestamp: Date.now(),
      phase: 'start',
      name
    });
    try {
      const result = fn();
      diagnostics.emitTrace({
        type: 'action',
        timestamp: Date.now(),
        phase: 'end',
        name,
        durationMs: now() - startedAt
      });
      return result;
    } catch (error) {
      diagnostics.emitTrace({
        type: 'action',
        timestamp: Date.now(),
        phase: 'error',
        name,
        durationMs: now() - startedAt,
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
  return new Runtime(options);
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}
