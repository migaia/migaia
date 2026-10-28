/**
 * Owns Runtime assembly, public node factories and private graph publication and diagnostic
 * channels.
 */
import { DependencyTracker } from './dependency-tracker.class.ts'
import { markSubscribers } from './subscriber-graph.ts'
import { readRuntimeConfiguration } from './runtime-options.ts'
import { TracedAction } from './traced-action.ts'
import { Scheduler } from './scheduler.class.ts'
import { VersionClock } from './version-clock.class.ts'
import { internalsOf, registerInternals, type IRuntimeInternals } from './internals.ts'
import { assertReactiveOwnedBy } from './ownership.ts'
import { readVersion, setVersion } from './node-internals.ts'
import { consumePendingCopyWarning, noteRuntimeCopy } from './copy-check.ts'
import { createReactiveError, runReactiveCallback, tagReactiveError } from '../errors.ts'
import { observeThenableRejection } from '@migaia/utils/function'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'
import {
  ReactiveNodeKind,
  ReactiveErrorPhase,
  ReactiveTraceReason,
  ReactiveTraceType
} from './trace-constants.ts'
import {
  containDiagnosticRejection,
  describeObservable,
  emitTraceSafely,
  sanitizeErrorContext,
  sanitizeTraceEvent
} from './diagnostics.ts'
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
  type IRuntimeTraceEvent
} from './types.ts'
import { Signal } from '../reactive/signal.class.ts'
import { Computed, type IComputedConfig } from '../reactive/computed.class.ts'
import { Effect } from '../reactive/effect.class.ts'

/**
 * Owns one isolated graph, scheduler and diagnostic channel. Assembly uses admitted capabilities;
 * graph mutation stays behind the internals WeakMap rather than public Runtime properties.
 */
export class Runtime implements IRuntime {
  readonly [RUNTIME_BRAND] = true as const
  /** Captured error reporter retains its admission-time receiver. */
  #onError: (error: unknown, context: IRuntimeErrorContext) => unknown
  /** Trace listener membership is owned until its returned removal token is called. */
  #traceListeners = new Set<(event: IRuntimeTraceEvent) => void>()
  /** Canonical graph services remain private even when an extension holds this Runtime. */
  readonly #services: IRuntimeInternals
  /** Idle admission is independent of flush strategy and keeps the original receiver. */
  readonly #scheduleIdle: (task: () => void) => void
  /** Default idle recovery keeps the same captured adapter port identity. */
  readonly #scheduleMicrotask: (task: () => void) => void

  /** Validates all options before allocating graph state, then registers one capability bundle. */
  constructor(options: IRuntimeOptions = {}) {
    /** Ordered snapshots replace constructor-local option and adapter closures. */
    const configuration = readRuntimeConfiguration(options)
    /** One monotonic clock is shared by all nodes in this isolated graph. */
    const clock = new VersionClock()
    /** Tracking context belongs to this exact Runtime. */
    const tracker = new DependencyTracker(this)
    this.#onError = configuration.onError
    if (configuration.onTrace !== undefined) this.#traceListeners.add(configuration.onTrace)
    this.#scheduleIdle = configuration.scheduleIdle
    this.#scheduleMicrotask = configuration.adapter.scheduleMicrotask
    /** Scheduler callbacks retain the existing asynchronous error phase and timing. */
    const scheduler = new Scheduler(
      (error, phase) => this.reportError(error, { phase: phase ?? ReactiveErrorPhase.asyncFlush }),
      configuration.maxFlushPasses,
      configuration.adapter.scheduleMicrotask
    )
    if (configuration.schedulerStrategy !== undefined) {
      scheduler.setStrategy(configuration.schedulerStrategy)
    }
    this.#services = {
      clock,
      tracker,
      scheduler,
      now: configuration.adapter.now,
      timestamp: configuration.adapter.timestamp,
      traceEnabled: () => this.#traceListeners.size > 0,
      emitTrace: (event) => this.#emitTrace(event),
      notify: (source) => this.#notify(source),
      commitSource: (source, write) => this.#commitSource(source, write),
      deferIdle: (task) => this.#deferIdle(task)
    }
    registerInternals(this, this.#services)
    /** Copy warnings cross the registered error-containment boundary only after assembly. */
    const copyWarning = consumePendingCopyWarning()
    if (copyWarning !== undefined) {
      this.reportError(createReactiveError(ReactiveErrorCode.copyConflict, copyWarning), {
        phase: ReactiveErrorPhase.lifecycleHook
      })
    }
  }

  /** Snapshots listener membership and keeps diagnostic reads outside active tracking frames. */
  #emitTrace(event: IRuntimeTraceEvent): void {
    /** All listeners see the same immutable event snapshot. */
    const snapshot = sanitizeTraceEvent(event)
    for (const listener of Array.from(this.#traceListeners)) {
      try {
        /** A listener cannot join the graph that emitted its diagnostic event. */
        const result: unknown = this.#services.tracker.untracked(() => listener(snapshot))
        containDiagnosticRejection(result, (error) =>
          this.reportError(error, { phase: ReactiveErrorPhase.traceListener })
        )
      } catch (error) {
        this.reportError(error, { phase: ReactiveErrorPhase.traceListener })
      }
    }
  }

  /** Commits a version before tracing and propagating the source's entry subscriber snapshot. */
  #publish(source: IObservable, version: number): void {
    assertReactiveOwnedBy(source, this, ReactiveNodeKind.observable)
    setVersion(source, version)
    if (this.#traceListeners.size > 0) {
      emitTraceSafely(
        {
          timestamp: this.#services.timestamp,
          emitTrace: this.#services.emitTrace,
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
    this.#services.scheduler.runDeferred(markSubscribers, source)
  }

  /** Notification reserves a new graph version even when it has no subscribers. */
  #notify(source: IObservable): void {
    this.#publish(source, this.#services.clock.next())
  }

  /** Reserves before user code and never republishes an older version after a reentrant write. */
  #commitSource<T>(source: IObservable, write: () => T): T {
    assertReactiveOwnedBy(source, this, ReactiveNodeKind.observable)
    /** A failed write consumes its slot but never publishes partial source state. */
    const version = this.#services.clock.next()
    /** User writes remain synchronous and execute exactly once. */
    const result = write()
    this.#publish(source, Math.max(version, readVersion(source)))
    return result
  }

  /** Reports idle admission failure and tries the distinct admitted microtask port once. */
  #deferIdle(task: () => void): void {
    try {
      this.#scheduleIdle(task)
    } catch (error) {
      this.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })
      if (this.#scheduleIdle !== this.#scheduleMicrotask) {
        try {
          this.#scheduleMicrotask(task)
        } catch (fallbackError) {
          this.reportError(fallbackError, { phase: ReactiveErrorPhase.asyncFlush })
        }
      }
    }
  }

  /** Creates a source that shares this Runtime's graph, clock and admitted diagnostic capabilities. */
  signal<T>(value: T, options?: IReactiveNodeOptions): Signal<T> {
    return new Signal(value, this, options)
  }
  /** Creates a lazy derived node whose dependencies and cache remain owned by this graph. */
  computed<T>(fn: () => T, config?: IComputedConfig<T>): Computed<T> {
    return new Computed(fn, this, config)
  }
  /** Creates the existing graph observer and exposes its own disposal lifecycle. */
  effect(fn: () => void | IDisposer, options?: IReactiveNodeOptions): Effect {
    return new Effect(fn, this, options)
  }
  /** Runs a synchronous public callback and preserves the scheduler's outermost flush/error policy. */
  batch<T>(fn: () => T): T {
    return runReactiveCallback(() => internalsOf(this).scheduler.runBatched(fn))
  }
  /**
   * Temporarily suppresses dependency collection while retaining the public callback error
   * boundary.
   */
  untracked<T>(fn: () => T): T {
    return runReactiveCallback(() => internalsOf(this).tracker.untracked(fn))
  }
  /**
   * Drains pending observers synchronously or reports reentrant deferral through the existing
   * result.
   */
  flush(): IFlushResult {
    return internalsOf(this).scheduler.flush()
  }
  /**
   * Validates an action label, then owns one synchronous trace span only when diagnostics are
   * active.
   */
  runTracedAction<T>(name: string, fn: () => T): T {
    if (typeof name !== 'string' || name.length === 0) {
      throw tagReactiveError(
        new TypeError(ReactiveErrorText.tracedActionNameInvalid),
        ReactiveErrorCode.invalidOption
      )
    }
    /** The admitted internals retain the same clock and trace callback identities for the action. */
    const diagnostics = internalsOf(this)
    if (!diagnostics.traceEnabled()) return runReactiveCallback(fn)
    return new TracedAction(this, diagnostics, name).run(fn)
  }

  /**
   * Reports outside dependency tracking and contains secondary reporter failures on the terminal
   * sink.
   */
  reportError(error: unknown, context: IRuntimeErrorReportContext): void {
    try {
      // Lifecycle failures can be reported from inside dependency commit.
      // Reporter reads are diagnostics, not observer dependencies.
      /** Sanitized context prevents reporter reads from exposing mutable graph objects. */
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
  /** Adds one diagnostic listener and returns a detached token that removes only that membership. */
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
