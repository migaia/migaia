import { tryReadProperty } from '@migaia/utils/error'
import { DependencyTracker } from './dependency-tracker.class.ts'
import { markSubscribers } from './subscriber-graph.ts'
import { Scheduler } from './scheduler.class.ts'
import { VersionClock } from './version-clock.class.ts'
import { defaultRuntimeAdapter } from './default-runtime-adapter.ts'
import { internalsOf, registerInternals } from './internals.ts'
import { assertReactiveOwnedBy } from './ownership.ts'
import { readVersion, setVersion } from './node-internals.ts'
import { consumePendingCopyWarning, noteRuntimeCopy } from './copy-check.ts'
import { createReactiveError, runReactiveCallback, tagReactiveError } from '../errors.ts'
import { observeThenableRejection } from '@migaia/utils/function'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'
import {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from './trace-constants.ts'
import {
  containDiagnosticRejection,
  describeObservable,
  emitTraceSafely,
  readDiagnosticClock,
  sanitizeErrorContext,
  sanitizeTraceEvent
} from './diagnostics.ts'
import { createReceiverCallback } from './receiver.ts'
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
  type IRuntimeTraceEvent
} from './types.ts'
import { Signal } from '../reactive/signal.class.ts'
import { Computed, type IComputedConfig } from '../reactive/computed.class.ts'
import { Effect } from '../reactive/effect.class.ts'

// Each `Runtime` owns an independent version clock, tracking context, flush scheduler, and node factories.
// Nodes share a dependency graph and monotonic clock within one runtime. Different runtimes are isolated.
// Isolation prevents state leaking across SSR requests, tests, and React roots.
// It also supports independent schedulers, worker runtimes, and distinct stores in DevTools.
//
// Runtime factories (`runtime.signal`, `computed`, and `effect`) assign nodes to their creator's graph.
// Shared convenience calls use the same factories through `defaultRuntime`.
export class Runtime implements IRuntime {
  readonly [RUNTIME_BRAND] = true as const
  #onError: (error: unknown, context: IRuntimeErrorContext) => unknown
  #traceListeners = new Set<(event: IRuntimeTraceEvent) => void>()

  constructor(options: IRuntimeOptions = {}) {
    /** Reads one option exactly once and converts getter failures into a package error. */
    const readOption = <K extends keyof IRuntimeOptions>(key: K): IRuntimeOptions[K] => {
      /** The read primitive leaves the option failure policy with this runtime. */
      const read = tryReadProperty(options, key)
      if (read.threw) {
        throw tagReactiveError(
          new TypeError(ReactiveErrorText.runtimeOptionGetterFailed(String(key)), {
            cause: read.error
          }),
          ReactiveErrorCode.invalidOption
        )
      }
      return read.value
    }

    /** Reads one adapter method once, retaining the source object as its receiver. */
    const snapshotAdapterMethod = <K extends keyof IReactiveRuntimeAdapter>(
      source: Partial<IReactiveRuntimeAdapter> | undefined,
      key: K
    ): { readonly fn: IReactiveRuntimeAdapter[K]; readonly receiver: unknown } => {
      if (source === undefined) {
        return { fn: defaultRuntimeAdapter[key], receiver: defaultRuntimeAdapter }
      }
      /** Preserve the source object as the method receiver after this single read. */
      const read = tryReadProperty(source, key)
      if (read.threw) {
        throw tagReactiveError(
          new TypeError(ReactiveErrorText.runtimeAdapterGetterFailed(String(key)), {
            cause: read.error
          }),
          ReactiveErrorCode.invalidOption
        )
      }
      const value = read.value
      if (value === undefined) {
        return { fn: defaultRuntimeAdapter[key], receiver: defaultRuntimeAdapter }
      }
      if (typeof value !== 'function') {
        throw tagReactiveError(
          new TypeError(ReactiveErrorText.runtimeAdapterMustBeFunction(String(key))),
          ReactiveErrorCode.invalidOption
        )
      }
      return { fn: value as IReactiveRuntimeAdapter[K], receiver: source }
    }

    /** Reads and validates the flush-loop bound before any Runtime graph state is allocated. */
    const maxFlushPassesOption = readOption('maxFlushPasses')
    if (
      maxFlushPassesOption !== undefined &&
      (!Number.isSafeInteger(maxFlushPassesOption) || maxFlushPassesOption < 1)
    ) {
      throw tagReactiveError(
        new RangeError(ReactiveErrorText.maxFlushPassesInvalid),
        ReactiveErrorCode.invalidOption
      )
    }

    // All injected functions are admitted before graph state is allocated. Each method is read once,
    // explicit undefined falls back to the default, and the wrapper keeps the original receiver.
    const adapterSource = readOption('adapter')
    const scheduleMicrotask = snapshotAdapterMethod(adapterSource, 'scheduleMicrotask')
    const now = snapshotAdapterMethod(adapterSource, 'now')
    const timestamp = snapshotAdapterMethod(adapterSource, 'timestamp')
    const reportError = snapshotAdapterMethod(adapterSource, 'reportError')
    const adapter: IReactiveRuntimeAdapter = {
      scheduleMicrotask: createReceiverCallback(scheduleMicrotask.fn, scheduleMicrotask.receiver),
      now: createReceiverCallback(now.fn, now.receiver),
      timestamp: createReceiverCallback(timestamp.fn, timestamp.receiver),
      reportError: createReceiverCallback(reportError.fn, reportError.receiver)
    }
    const onErrorOption = readOption('onError')
    if (onErrorOption !== undefined && typeof onErrorOption !== 'function') {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('onError')),
        ReactiveErrorCode.invalidOption
      )
    }
    const onTraceOption = readOption('onTrace')
    if (onTraceOption !== undefined && typeof onTraceOption !== 'function') {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('onTrace')),
        ReactiveErrorCode.invalidOption
      )
    }
    const scheduleIdleOption = readOption('scheduleIdle')
    if (scheduleIdleOption !== undefined && typeof scheduleIdleOption !== 'function') {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.runtimeOptionMustBeFunction('scheduleIdle')),
        ReactiveErrorCode.invalidOption
      )
    }
    /** Constructor-selected flush timing is admitted before allocating any graph state. */
    const schedulerStrategyOption = readOption('schedulerStrategy')
    if (schedulerStrategyOption !== undefined && typeof schedulerStrategyOption !== 'function') {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.schedulerStrategyInvalid),
        ReactiveErrorCode.invalidOption
      )
    }
    const clock = new VersionClock()
    const tracker = new DependencyTracker(this)
    this.#onError =
      onErrorOption === undefined
        ? adapter.reportError
        : createReceiverCallback(onErrorOption, options)
    if (onTraceOption !== undefined) {
      this.#traceListeners.add(createReceiverCallback(onTraceOption, options))
    }
    const traceEnabled = (): boolean => this.#traceListeners.size > 0
    const emitTrace = (event: IRuntimeTraceEvent): void => {
      const snapshot = sanitizeTraceEvent(event)
      for (const listener of Array.from(this.#traceListeners)) {
        try {
          // Dependency-edge traces fire while commit still owns an active
          // tracking frame. Diagnostic reads must never join that graph.
          const result: unknown = tracker.untracked(() => listener(snapshot))
          containDiagnosticRejection(result, (error) =>
            this.reportError(error, { phase: ReactiveErrorPhase.traceListener })
          )
        } catch (error) {
          this.reportError(error, { phase: ReactiveErrorPhase.traceListener })
        }
      }
    }
    const scheduler = new Scheduler(
      (error, phase) => this.reportError(error, { phase: phase ?? ReactiveErrorPhase.asyncFlush }),
      maxFlushPassesOption,
      adapter.scheduleMicrotask
    )
    if (schedulerStrategyOption !== undefined) scheduler.setStrategy(schedulerStrategyOption)
    // 通知闭包只保存在 WeakMap 内部面。Runtime 实例本身没有 notify 方法，
    // 因而第三方不能拿一个伪造节点绕过受控节点 API。
    const publish = (source: IObservable, version: number): void => {
      assertReactiveOwnedBy(source, this, 'observable')
      setVersion(source, version)
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
        )
      }
      scheduler.runDeferred(markSubscribers, source)
    }
    const notify = (source: IObservable): void => {
      publish(source, clock.next())
    }
    const commitSource = <T>(source: IObservable, write: () => T): T => {
      assertReactiveOwnedBy(source, this, 'observable')
      // Reserve the version before user code runs. A failed write consumes a
      // clock slot but never publishes a partial source update.
      const version = clock.next()
      const result = write()
      publish(source, Math.max(version, readVersion(source)))
      return result
    }
    // 内部面只经 WeakMap 暴露；拿到 Runtime 的第三方无法沿引用链摸到图。
    /** Captures the admitted idle callback and its original receiver once for this Runtime. */
    const scheduleIdle =
      scheduleIdleOption === undefined
        ? adapter.scheduleMicrotask
        : createReceiverCallback(scheduleIdleOption, options)
    /** Admits idle cleanup through the configured hook and recovers through the safe microtask port. */
    const deferIdle = (task: () => void): void => {
      try {
        scheduleIdle(task)
      } catch (error) {
        this.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })
        if (scheduleIdle !== adapter.scheduleMicrotask) {
          try {
            adapter.scheduleMicrotask(task)
          } catch (fallbackError) {
            this.reportError(fallbackError, { phase: ReactiveErrorPhase.asyncFlush })
          }
        }
      }
    }
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
    })
    // 多副本警告发生在 Runtime 建立前（createRuntime 先 noteRuntimeCopy 再 new）——经 `reportError` 的
    // containment 上报：reporter 同步抛/异步拒绝都不会破坏构造、不会产生 unhandled rejection。
    const copyWarning = consumePendingCopyWarning()
    if (copyWarning !== undefined) {
      this.reportError(createReactiveError(ReactiveErrorCode.copyConflict, copyWarning), {
        phase: ReactiveErrorPhase.lifecycleHook
      })
    }
  }

  signal<T>(value: T, options?: IReactiveNodeOptions): Signal<T> {
    return new Signal(value, this, options)
  }
  computed<T>(fn: () => T, config?: IComputedConfig<T>): Computed<T> {
    return new Computed(fn, this, config)
  }
  /** Creates the existing graph observer and exposes its own disposal lifecycle. */
  effect(fn: () => void | IDisposer, options?: IReactiveNodeOptions): Effect {
    return new Effect(fn, this, options)
  }
  batch<T>(fn: () => T): T {
    return runReactiveCallback(() => internalsOf(this).scheduler.runBatched(fn))
  }
  untracked<T>(fn: () => T): T {
    return runReactiveCallback(() => internalsOf(this).tracker.untracked(fn))
  }
  flush(): IFlushResult {
    return internalsOf(this).scheduler.flush()
  }
  runTracedAction<T>(name: string, fn: () => T): T {
    if (typeof name !== 'string' || name.length === 0) {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.tracedActionNameInvalid),
        ReactiveErrorCode.invalidOption
      )
    }
    const diagnostics = internalsOf(this)
    if (!diagnostics.traceEnabled()) return runReactiveCallback(fn)
    const reportTraceFailure = (error: unknown): void => {
      this.reportError(error, { phase: ReactiveErrorPhase.traceListener })
    }
    const startedAt = readDiagnosticClock(diagnostics.now, 0, reportTraceFailure)
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
    )
    try {
      const result = runReactiveCallback(fn)
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
      )
      return result
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
      )
      throw error
    }
  }
  reportError(error: unknown, context: IRuntimeErrorReportContext): void {
    try {
      // Lifecycle failures can be reported from inside dependency commit.
      // Reporter reads are diagnostics, not observer dependencies.
      const result: unknown = internalsOf(this).tracker.untracked(() =>
        this.#onError(error, sanitizeErrorContext(context))
      )
      containDiagnosticRejection(result, (failure) => {
        throw failure // utils owns the shared terminal host queue for reporter failures.
      })
    } catch (error) {
      observeThenableRejection(undefined, { error }, (failure) => {
        throw failure
      })
    }
  }
  subscribeTrace(listener: (event: IRuntimeTraceEvent) => void): IDisposer {
    this.#traceListeners.add(listener)
    return () => this.#traceListeners.delete(listener)
  }
}

/**
 * Creates an isolated runtime with its own dependency graph, version clock and scheduler; use one
 * per SSR request, test case or worker. Nodes of different runtimes cannot depend on each other (a
 * cross read throws `CROSS_RUNTIME`). Effects flush in a microtask by default; a flush that exceeds
 * `maxFlushPasses` (default 100) stops with `FLUSH_LOOP`. Invalid options throw a `TypeError` or
 * `RangeError` with code `INVALID_OPTION`.
 */
export function createRuntime(options?: IRuntimeOptions): IRuntime {
  // 双实例自检（copy-check.ts）：创建 Runtime 是首个正确性边界，登记本副本，使
  // runtimeCopyCount()/assertSingleRuntimeCopy() 能发现「两份模块副本」的部署错误。
  noteRuntimeCopy()
  return new Runtime(options)
}
