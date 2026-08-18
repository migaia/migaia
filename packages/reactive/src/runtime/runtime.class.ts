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
import { ReactiveErrorText } from '../error-text.js';
import {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from './trace-constants.js';
import {
  containDiagnosticRejection,
  describeObservable,
  emitTraceSafely,
  readDiagnosticClock,
  sanitizeErrorContext,
  sanitizeTraceEvent
} from './diagnostics.js';
import { createReceiverCallback } from './receiver.js';
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
  type IReactiveRuntimeAdapter,
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
  #onError: (error: unknown, context: IRuntimeErrorContext) => unknown;
  #traceListeners = new Set<(event: IRuntimeTraceEvent) => void>();

  constructor(options: IRuntimeOptions = {}) {
    /** Reads one option exactly once and converts getter failures into a package error. */
    const readOption = <K extends keyof IRuntimeOptions>(key: K): IRuntimeOptions[K] => {
      try {
        return options[key];
      } catch (error) {
        throw tagReactiveError(
          new TypeError(ReactiveErrorText.runtimeOptionGetterFailed(String(key)), {
            cause: error
          }),
          ReactiveErrorCode.invalidOption
        );
      }
    };

    /** Reads one adapter method once, retaining the source object as its receiver. */
    const snapshotAdapterMethod = <K extends keyof IReactiveRuntimeAdapter>(
      source: Partial<IReactiveRuntimeAdapter> | undefined,
      key: K
    ): { readonly fn: IReactiveRuntimeAdapter[K]; readonly receiver: unknown } => {
      if (source === undefined) {
        return { fn: defaultRuntimeAdapter[key], receiver: defaultRuntimeAdapter };
      }
      let value: unknown;
      try {
        value = source[key];
      } catch (error) {
        throw tagReactiveError(
          new TypeError(ReactiveErrorText.runtimeAdapterGetterFailed(String(key)), {
            cause: error
          }),
          ReactiveErrorCode.invalidOption
        );
      }
      if (value === undefined) {
        return { fn: defaultRuntimeAdapter[key], receiver: defaultRuntimeAdapter };
      }
      if (typeof value !== 'function') {
        throw tagReactiveError(
          new TypeError(ReactiveErrorText.runtimeAdapterMustBeFunction(String(key))),
          ReactiveErrorCode.invalidOption
        );
      }
      return { fn: value as IReactiveRuntimeAdapter[K], receiver: source };
    };

    /** Reads and validates the flush-loop bound before any Runtime graph state is allocated. */
    const maxFlushPassesOption = readOption('maxFlushPasses');
    if (
      maxFlushPassesOption !== undefined &&
      (!Number.isSafeInteger(maxFlushPassesOption) || maxFlushPassesOption < 1)
    ) {
      throw tagReactiveError(
        new RangeError(ReactiveErrorText.maxFlushPassesInvalid),
        ReactiveErrorCode.invalidOption
      );
    }

    // All injected functions are admitted before graph state is allocated. Each method is read once,
    // explicit undefined falls back to the default, and the wrapper keeps the original receiver.
    const adapterSource = readOption('adapter');
    const scheduleMicrotask = snapshotAdapterMethod(adapterSource, 'scheduleMicrotask');
    const now = snapshotAdapterMethod(adapterSource, 'now');
    const timestamp = snapshotAdapterMethod(adapterSource, 'timestamp');
    const reportError = snapshotAdapterMethod(adapterSource, 'reportError');
    const adapter: IReactiveRuntimeAdapter = {
      scheduleMicrotask: createReceiverCallback(scheduleMicrotask.fn, scheduleMicrotask.receiver),
      now: createReceiverCallback(now.fn, now.receiver),
      timestamp: createReceiverCallback(timestamp.fn, timestamp.receiver),
      reportError: createReceiverCallback(reportError.fn, reportError.receiver)
    };
    const onErrorOption = readOption('onError');
    if (onErrorOption !== undefined && typeof onErrorOption !== 'function') {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('onError')),
        ReactiveErrorCode.invalidOption
      );
    }
    const onTraceOption = readOption('onTrace');
    if (onTraceOption !== undefined && typeof onTraceOption !== 'function') {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('onTrace')),
        ReactiveErrorCode.invalidOption
      );
    }
    const scheduleIdleOption = readOption('scheduleIdle');
    if (scheduleIdleOption !== undefined && typeof scheduleIdleOption !== 'function') {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('scheduleIdle')),
        ReactiveErrorCode.invalidOption
      );
    }
    const clock = new VersionClock();
    const tracker = new DependencyTracker(this);
    this.#onError =
      onErrorOption === undefined
        ? adapter.reportError
        : createReceiverCallback(onErrorOption, options);
    if (onTraceOption !== undefined) {
      this.#traceListeners.add(createReceiverCallback(onTraceOption, options));
    }
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
      maxFlushPassesOption,
      adapter.scheduleMicrotask
    );
    // 通知闭包只保存在 WeakMap 内部面。Runtime 实例本身没有 notify 方法，
    // 因而第三方不能拿一个伪造节点绕过受控节点 API。
    const publish = (source: IObservable, version: number): void => {
      assertReactiveOwnedBy(source, this, 'observable');
      setVersion(source, version);
      if (traceEnabled()) {
        emitTraceSafely(
          {
            timestamp: adapter.timestamp,
            emitTrace,
            reportError: (error) =>
              this.reportError(error, {
                phase: ReactiveErrorPhase.traceListener,
                observable: source
              })
          },
          (timestamp) => ({
            type: ReactiveTraceType.observableChange,
            timestamp,
            observable: describeObservable(source),
            reason: ReactiveTraceReason.notify
          })
        );
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
    const deferIdle =
      scheduleIdleOption === undefined
        ? adapter.scheduleMicrotask
        : createReceiverCallback(scheduleIdleOption, options);
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
        new TypeError(ReactiveErrorText.tracedActionNameInvalid),
        ReactiveErrorCode.invalidOption
      );
    }
    const diagnostics = internalsOf(this);
    if (!diagnostics.traceEnabled()) return fn();
    const reportTraceFailure = (error: unknown): void => {
      this.reportError(error, { phase: ReactiveErrorPhase.traceListener });
    };
    const startedAt = readDiagnosticClock(diagnostics.now, 0, reportTraceFailure);
    emitTraceSafely(
      {
        timestamp: diagnostics.timestamp,
        emitTrace: diagnostics.emitTrace,
        reportError: reportTraceFailure
      },
      (timestamp) => ({
        type: ReactiveTraceType.action,
        timestamp,
        phase: ReactiveTracePhase.start,
        name
      })
    );
    try {
      const result = fn();
      emitTraceSafely(
        {
          timestamp: diagnostics.timestamp,
          emitTrace: diagnostics.emitTrace,
          reportError: reportTraceFailure
        },
        (timestamp) => ({
          type: ReactiveTraceType.action,
          timestamp,
          phase: ReactiveTracePhase.end,
          name,
          durationMs:
            readDiagnosticClock(diagnostics.now, startedAt, reportTraceFailure) - startedAt
        })
      );
      return result;
    } catch (error) {
      emitTraceSafely(
        {
          timestamp: diagnostics.timestamp,
          emitTrace: diagnostics.emitTrace,
          reportError: reportTraceFailure
        },
        (timestamp) => ({
          type: ReactiveTraceType.action,
          timestamp,
          phase: ReactiveTracePhase.error,
          name,
          durationMs:
            readDiagnosticClock(diagnostics.now, startedAt, reportTraceFailure) - startedAt,
          error
        })
      );
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
