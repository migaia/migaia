import {
  defineHost,
  type IHostHandle,
  type IPluginHandleTuple,
  type IPluginHostDisposalResult,
  PluginHostErrorCode
} from '@migaia/plugin-host'
import { createEventChannel, withSnapshotEntries } from '@migaia/event-subscriber'
import { boundedWait, snapshotScheduler } from '@migaia/lifecycle'
import {
  createPipeline,
  type IAsyncMiddlewareStage,
  type IMiddlewarePipeline
} from '@migaia/middleware-pipeline'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { probeThenable, assimilateCapturedThen, ThenableProbeKind } from '@migaia/utils/function'
import type {
  ILogHostOptions,
  ILogPluginConstraint,
  ILogContext,
  ILogEntry,
  ILogFailure,
  IRawEntryInput,
  IShutdownReason,
  ILogHost
} from './typing.ts'
import { LogPluginCore, type ILogDomainCore } from './core.ts'
import { buildLogEntry, snapshotLogEntry, defaultRandomUUID } from './entry.ts'
import {
  LogHostStatus,
  DRAIN_TIMEOUT_MS,
  FeaturePhase,
  LogFailureSource
} from './state-constants.ts'
import { ERROR_SOURCE, LogHostErrorCode } from './error-code.ts'
import { LogHostErrorText } from './error-text.ts'
import { createLogError, createLogTypeError, invalidOption } from './errors.ts'
import { type IFeatureImplementation } from './feature-metadata.ts'
import { LogFeatureScope } from './feature-policy.ts'
import { defaultLogFailureReporter, reportContained } from './reporter.ts'
import { validateForwardPlugin } from './forward.ts'
import { deferred } from '@migaia/utils/promise'
import { logHostOwners } from './host-registry.ts'
/** Captured scheduler facades retain shared identity for plugins borrowing the same source clock. */
const schedulerSnapshots = new WeakMap<object, IScheduler>()

/** Validate a scheduler once per source while preserving same-domain identity across hosts. */
function resolveScheduler(input: IScheduler | undefined): IScheduler {
  if (input === undefined) return systemScheduler
  /** A prior snapshot remains the stable capability owner for this injected scheduler object. */
  const existing = schedulerSnapshots.get(input)
  if (existing) return existing
  try {
    /** Canonical admission owns hostile accessor reads and clock method receivers. */
    const snapshot = snapshotScheduler(input)
    if (snapshot) {
      schedulerSnapshots.set(input, snapshot)
      return snapshot
    }
  } catch (error) {
    throw createLogTypeError(
      LogHostErrorCode.invalidOption,
      LogHostErrorText.schedulerGetterFailed,
      { cause: error instanceof Error && 'cause' in error ? error.cause : error }
    )
  }
  throw createLogTypeError(LogHostErrorCode.invalidOption, LogHostErrorText.invalidScheduler)
}

/** Snapshot every declared public option once before plugin admission can produce side effects. */
function snapshotHostOptions(
  options: ILogHostOptions<readonly ILogPluginConstraint[]>
): ILogHostOptions<readonly ILogPluginConstraint[]> {
  /** Scheduler accessors retain their established distinct admission diagnostic. */
  let scheduler: IScheduler | undefined
  try {
    scheduler = options.scheduler
  } catch (cause) {
    throw createLogTypeError(
      LogHostErrorCode.invalidOption,
      LogHostErrorText.schedulerGetterFailed,
      { cause }
    )
  }
  try {
    /** Caller-owned containers are copied only after each accessor is captured once. */
    const plugins = options.plugins
    /** Host-level feature injection was removed; policies belong to declaring plugins. */
    if (Object.hasOwn(options, 'features')) throw invalidOption()
    /** Context array is shallow-copied and frozen by the owning host. */
    const context = options.context
    return {
      scheduler,
      plugins: plugins === undefined ? [] : [...plugins],
      context: context === undefined ? [] : [...context],
      topic: options.topic,
      maxPending: options.maxPending,
      randomUUID: options.randomUUID,
      report: options.report,
      execution: options.execution
    }
  } catch (cause) {
    throw invalidOption(cause)
  }
}

/** Preserve log admission's public identity when native installation wraps only that primary error. */
function installationError(error: unknown): unknown {
  if (
    !(error instanceof Error) ||
    Reflect.get(error, 'code') !== PluginHostErrorCode.pluginInstallFailed
  )
    return error
  /** Cleanup aggregates retain their full native wrapper instead of losing secondary failures. */
  const cause = error.cause
  if (
    cause instanceof TypeError &&
    Reflect.get(cause, 'source') === ERROR_SOURCE &&
    Reflect.get(cause, 'code') === LogHostErrorCode.invalidOption
  )
    return cause
  return error
}

/** Rejected native installs preserve existing log admission errors through the promise boundary. */
function rejectInstallation(error: unknown): never {
  throw installationError(error)
}

/** One entry-feature adapter owns its host generator without allocating per-entry callbacks. */
class EntryFeatureStage {
  /** Issued entry implementation is immutable configuration shared by every traversal. */
  #feature: Extract<IFeatureImplementation, { phase: 'entry' }>
  /** Each host supplies its own identity source even when a descriptor is reused. */
  #randomUUID: () => string
  /** Capture stable installation state before asynchronous execution. */
  constructor(
    feature: Extract<IFeatureImplementation, { phase: 'entry' }>,
    randomUUID: () => string
  ) {
    this.#feature = feature
    this.#randomUUID = randomUUID
  }
  /** Pipeline callbacks capture only this named owner and never nest callback control flow. */
  readonly run: IAsyncMiddlewareStage<ILogEntry> = async (entry, next) => {
    /** Undefined is the public feature drop result. */
    const selected = await this.#feature.stage(entry, this.#randomUUID)
    if (selected !== undefined) await next(selected)
  }
}

/** Owns logging state while peer packages retain plugin lifecycle and middleware semantics. */
export class LogHost {
  /** Frozen context containers are visible to every current installation. */
  readonly ctx: ILogContext
  /** Captured scheduler identity also identifies a process-plugin clock domain. */
  readonly scheduler: IScheduler
  /** Canonical plugin owner admits, rolls back and releases every installation. */
  readonly #handle: IHostHandle<ILogDomainCore, ILogEntry, readonly []>
  /**
   * Log-owned scope mirrors rpc-host preparation; native plugin-host still owns installation and
   * rollback.
   */
  readonly featureScope = new LogFeatureScope(this)
  /** Installed entry adapters precede user pipeline stages without hot metadata lookup. */
  #entryStages: readonly IAsyncMiddlewareStage<ILogEntry>[] = []
  /**
   * Entry adapters followed by usePipeline stages, rebuilt only when either list changes. Replaced,
   * never mutated, so an in-flight run keeps the array it started with.
   */
  #runStages: readonly IAsyncMiddlewareStage<ILogEntry>[] = []
  /** One asynchronous middleware runner is reused without retaining per-run state. */
  readonly #pipeline: IMiddlewarePipeline<'async', ILogEntry> = createPipeline<ILogEntry>({
    mode: 'async'
  })
  /** Registration tokens give usePipeline independently revocable, insertion-ordered stages. */
  readonly #stages = new Map<object, IAsyncMiddlewareStage<ILogEntry>>()
  /** The event channel retains canonical listener ordering and snapshot invocation. */
  readonly #sinks = createEventChannel<ILogEntry, void | Promise<void>>()
  /** Failure observers use the same channel owner without a second event dispatcher. */
  readonly #failures = createEventChannel<ILogFailure>()
  /** Flushers participate in the host's current shared drain budget. */
  readonly #flushers = createEventChannel<void, void | Promise<void>>()
  /** Shutdown handlers may enqueue final logs before normal admission closes. */
  readonly #shutdownHandlers = createEventChannel<IShutdownReason, void | Promise<void>>()
  /** Pending work is tracked independently of entry queue occupancy. */
  readonly #pending = new Set<Promise<void>>()
  /** A terminal reporter cannot recursively reenter the failure channel on its own failure. */
  readonly #report: (error: unknown) => void
  /** UUID enrichment reads the installing host's captured generator. */
  readonly #randomUUID: () => string
  /** Capacity counts entries that have not begun processing, rather than active output attempts. */
  readonly #maxPending: number
  /** The queue stores entries themselves; cursor movement avoids shift's quadratic copying. */
  #queue: Array<ILogEntry | undefined> = []
  /** Every admitted entry before this cursor has started processing or was dropped by overflow. */
  #cursor = 0
  /** One drain Promise covers the current scheduled/asynchronous entry traversal. */
  #draining: Promise<void> | undefined
  /** Public lifecycle state is independent of plugin-host's internal phases. */
  #status: LogHostStatus = LogHostStatus.active
  /** Handlers retain ordinary logging admission until their final-work phase finishes. */
  #accepting = true
  /** Concurrent flush callers share their exact current barrier Promise. */
  #flushPromise: Promise<void> | undefined
  /** Every terminal call shares one published Promise, including reentrant handler calls. */
  #shutdownPromise: Promise<IPluginHostDisposalResult> | undefined

  /** Capture and validate public options before installing any resource-owning plugin. */
  constructor(options: ILogHostOptions<readonly ILogPluginConstraint[]>) {
    /** Read caller-controlled accessors together so partial construction cannot admit plugins. */
    const snapshot = snapshotHostOptions(options)
    this.#maxPending = snapshot.maxPending ?? 10000
    if (!Number.isSafeInteger(this.#maxPending) || this.#maxPending < 1) throw invalidOption()
    this.scheduler = resolveScheduler(snapshot.scheduler)
    this.#randomUUID = snapshot.randomUUID ?? defaultRandomUUID
    this.#report = snapshot.report ?? defaultLogFailureReporter
    if (typeof this.#randomUUID !== 'function' || typeof this.#report !== 'function')
      throw invalidOption()
    /** Runtime environment flags are a construction snapshot without a runtime-manager API. */
    const process = (
      globalThis as unknown as {
        process?: { stdout?: { isTTY?: boolean }; env?: Record<string, string | undefined> }
      }
    ).process
    this.ctx = Object.freeze({
      id: this.#randomUUID(),
      options: Object.freeze({ ...snapshot }),
      path: Object.freeze([...(snapshot.context ?? [])]),
      topic: snapshot.topic ?? '',
      createdAt: new Date(),
      env: Object.freeze({
        isTTY: Boolean(process?.stdout?.isTTY),
        isCI: Boolean(process?.env?.CI)
      })
    })
    this.#handle = defineHost<ILogDomainCore, ILogEntry>({
      host: {
        scheduler: this.scheduler,
        execution: snapshot.execution,
        pipeline: { mode: 'async' }
      },
      domainCore: () => LogPluginCore.create(this)
    })
    /** Initial extension descriptors retain canonical plugin-host revocation and callable identity. */
    /** Native handles of the constructor's plugins, in declaration order. */
    let handles
    try {
      handles = this.#handle.useSync(...(snapshot.plugins ?? []))
    } catch (error) {
      throw installationError(error)
    }
    /** The public plain surface can freeze while all mutable state stays on this owner. */
    const surface = {
      ctx: this.ctx,
      config: this.#handle.config,
      log: (tag: string, message: string, ...args: unknown[]) => this.log(tag, message, ...args),
      dispatchRaw: (input: IRawEntryInput) => this.dispatchRaw(input),
      usePipeline: (stage: IAsyncMiddlewareStage<ILogEntry>) => this.usePipeline(stage),
      onFailure: (fn: (failure: ILogFailure) => void) => this.onFailure(fn),
      onShutdown: (fn: (reason: IShutdownReason) => void | Promise<void>) => this.onShutdown(fn),
      flush: () => this.flush(),
      shutdown: (reason: IShutdownReason) => this.shutdown(reason),
      use: <const P extends readonly ILogPluginConstraint[]>(...plugins: P) => this.use(...plugins),
      unUse: this.#handle.unUse
    }
    Object.defineProperty(surface, 'status', {
      get: () => this.status,
      enumerable: true,
      configurable: false
    })
    for (const handle of handles)
      for (const key of Reflect.ownKeys(handle.extensions)) {
        /** Exact peer descriptors carry guarded callable extensions. */
        const descriptor = Object.getOwnPropertyDescriptor(handle.extensions, key)
        if (descriptor && 'value' in descriptor)
          Object.defineProperty(surface, key, {
            value: descriptor.value,
            enumerable: true,
            writable: false,
            configurable: false
          })
      }
    this.facade = Object.freeze(surface) as ILogHost<readonly ILogPluginConstraint[]>
    logHostOwners.set(this.facade, this)
  }

  /** Frozen facade identity is registered only after successful synchronous installation. */
  readonly facade: ILogHost<readonly ILogPluginConstraint[]>
  /** Compile native-installed entry behavior only when plugin policy publication changes. */
  setEntryFeatures(features: ReadonlyMap<string, IFeatureImplementation>): void {
    /** Entry order follows canonical carrier and feature declaration order. */
    const stages: IAsyncMiddlewareStage<ILogEntry>[] = []
    for (const implementation of features.values())
      if (implementation.phase === FeaturePhase.entry)
        stages.push(new EntryFeatureStage(implementation, this.#randomUUID).run)
    this.#entryStages = stages
    this.#rebuildRunStages()
  }
  /** Recompile the per-entry stage list after entry adapters or pipeline registrations change. */
  #rebuildRunStages(): void {
    this.#runStages = [...this.#entryStages, ...this.#stages.values()]
  }
  /** Current lifecycle phase remains observable from the frozen facade. */
  get status(): LogHostStatus {
    return this.#status
  }
  /** General tags remain valid without installing a level policy. */
  log(tag: string, message: string, ...args: unknown[]): void {
    this.dispatchRaw({ tag, message, args })
  }
  /** Build synchronously, drop the oldest unstarted entry at capacity, and schedule one drain. */
  dispatchRaw(input: IRawEntryInput): void {
    if (!this.#accepting || this.#status === LogHostStatus.closed) return
    try {
      /** Time, caller arrays and metadata are captured before the producer returns. */
      const entry = buildLogEntry(input, this.ctx)
      if (this.#queue.length - this.#cursor >= this.#maxPending) {
        this.#queue[this.#cursor++] = undefined
        // Reclaim one consumed capacity window so synchronous bursts cannot retain unbounded slots.
        if (this.#cursor >= this.#maxPending) {
          this.#queue = this.#queue.slice(this.#cursor)
          this.#cursor = 0
        }
        this.reportFailure({
          source: LogFailureSource.defer,
          error: createLogError(LogHostErrorCode.queueOverflow, LogHostErrorText.queueOverflow)
        })
      }
      this.#queue.push(entry)
      if (!this.#draining) this.#draining = Promise.resolve().then(() => this.#drainQueue())
    } catch (error) {
      this.reportFailure({ source: LogFailureSource.pipeline, error })
    }
  }
  /** Register one independently revocable asynchronous stage. */
  usePipeline(stage: IAsyncMiddlewareStage<ILogEntry>): () => void {
    /** Tokens prevent one repeated function registration from revoking another. */
    const token = {}
    this.#stages.set(token, stage)
    this.#rebuildRunStages()
    return () => {
      this.#stages.delete(token)
      this.#rebuildRunStages()
    }
  }
  /** Register raw entry consumption; output SDK delivery owns its own formatting and policies. */
  useSink(sink: (entry: ILogEntry) => void | Promise<void>): () => void {
    /** Each callback receives its own shallow snapshot; nested payloads remain reference-preserving. */
    const off = this.#sinks.subscribe((event) => sink(snapshotLogEntry(event.value)))
    return () => off()
  }
  /** Failure observers receive the original diagnostic value without becoming an exception path. */
  onFailure(fn: (failure: ILogFailure) => void): () => void {
    /** The event channel owns registration identity and idempotent removal. */
    const off = this.#failures.subscribe((event) => fn(event.value))
    return () => off()
  }
  /** Report to observers or directly to the terminal reporter when no observer is registered. */
  reportFailure(failure: ILogFailure): void {
    try {
      if (this.#failures.size === 0) {
        reportContained(this.#report, failure.error)
        return
      }
      withSnapshotEntries(this.#failures, failure, (entries) => {
        for (const invocation of entries) {
          try {
            this.#observeReporterResult(invocation.invoke())
          } catch (error) {
            this.#reportObserverFailure(error)
          }
        }
      })
    } catch (error) {
      reportContained(this.#report, error)
    }
  }
  /** Observe hostile callback results through the canonical captured-then protocol. */
  #observeReporterResult(result: unknown): void {
    /** The reporter receives a thrown then getter as the listener failure itself. */
    const probe = probeThenable(result)
    if (probe.kind === ThenableProbeKind.failed) this.#reportObserverFailure(probe.error)
    else if (probe.kind === ThenableProbeKind.thenable)
      void assimilateCapturedThen(probe.thenFn, result).catch((error) =>
        this.#reportObserverFailure(error)
      )
  }
  /** Observer failures never reenter their own channel and retain the original value on cause. */
  #reportObserverFailure(error: unknown): void {
    reportContained(
      this.#report,
      createLogError(LogHostErrorCode.hookFailed, LogHostErrorText.failureHookThrew, {
        cause: error
      })
    )
  }
  /** Plugin work starts after producer return and remains visible to flush. */
  defer(task: () => void | Promise<void>): void {
    if (this.#accepting && this.#status !== LogHostStatus.closed)
      this.track(LogFailureSource.defer, Promise.resolve().then(task))
  }
  /** Track one task through both settlement branches without exposing its rejection to producers. */
  track(source: ILogFailure['source'], task: Promise<void>): void {
    /** This observation Promise is the exact entry retained by the pending set. */
    const observed = task.then(
      () => {
        this.#pending.delete(observed)
      },
      (error) => {
        this.reportFailure({ source, error })
        this.#pending.delete(observed)
      }
    )
    this.#pending.add(observed)
  }
  /** Flush callbacks are independent registration resources owned by their plugins. */
  onFlush(fn: () => void | Promise<void>): () => void {
    const off = this.#flushers.subscribe(() => fn())
    return () => off()
  }
  /** Final-work handlers retain stable ordering and normal entry admission. */
  onShutdown(fn: (reason: IShutdownReason) => void | Promise<void>): () => void {
    const off = this.#shutdownHandlers.subscribe((event) => fn(event.value))
    return () => off()
  }
  /** Configuration mutation retains the peer's exact typed input-order handle tuple. */
  use<const P extends readonly ILogPluginConstraint[]>(
    ...plugins: P
  ): Promise<IPluginHandleTuple<P>> {
    try {
      for (const plugin of plugins) validateForwardPlugin(this, plugin)
    } catch (error) {
      return Promise.reject(error)
    }
    return (this.#handle.use as ILogHost['use'])(...plugins).catch(rejectInstallation) as Promise<
      IPluginHandleTuple<P>
    >
  }
  /** Publish a shared, nonrejecting drain barrier; failures are evidence through onFailure. */
  flush(deadline?: number): Promise<void> {
    if (this.#status === LogHostStatus.closed) return Promise.resolve()
    if (this.#flushPromise) return this.#flushPromise
    this.#flushPromise = this.#flush(deadline).finally(() => {
      this.#flushPromise = undefined
    })
    return this.#flushPromise
  }
  /** Publish terminal completion before handlers execute, preserving reentrant Promise identity. */
  shutdown(reason: IShutdownReason): Promise<IPluginHostDisposalResult> {
    if (this.#shutdownPromise) return this.#shutdownPromise
    this.#status = LogHostStatus.shuttingDown
    /** Publish the native receipt before handlers execute, retaining synchronous admission timing. */
    const completion = deferred<IPluginHostDisposalResult>()
    this.#shutdownPromise = completion.promise
    void this.#shutdown(reason).then(completion.resolve)
    return this.#shutdownPromise
  }
  /** Walk entry snapshots serially; output promises are tracked independently to enable batching. */
  async #drainQueue(): Promise<void> {
    try {
      while (this.#cursor < this.#queue.length) {
        /** Consumed slots are released promptly rather than retaining entries until the final drain. */
        const entry = this.#queue[this.#cursor]!
        this.#queue[this.#cursor++] = undefined
        try {
          await this.#pipeline.run(this.#runStages, entry, (selected) =>
            this.#deliverEntry(selected, entry)
          )
        } catch (error) {
          this.reportFailure({ source: LogFailureSource.pipeline, error })
        }
        // At least one capacity window was consumed before copying at most one window of tail.
        if (this.#cursor >= this.#maxPending) {
          this.#queue = this.#queue.slice(this.#cursor)
          this.#cursor = 0
        }
      }
    } finally {
      this.#queue = []
      this.#cursor = 0
      this.#draining = undefined
    }
  }
  /** Invalid replacements retain the original valid entry while exposing the lost transformation. */
  #deliverEntry(selected: ILogEntry, original: ILogEntry): void {
    /** Sink snapshots require a genuine Date rather than a JSON timestamp replacement. */
    const valid = selected && selected.time instanceof Date
    if (!valid)
      this.reportFailure({
        source: LogFailureSource.pipeline,
        error: createLogTypeError(
          LogHostErrorCode.pipelineEntryInvalid,
          LogHostErrorText.pipelineEntryInvalid
        )
      })
    withSnapshotEntries(this.#sinks, valid ? selected : original, (entries) => {
      for (const invocation of entries) {
        try {
          this.#observeSink(invocation.invoke())
        } catch (error) {
          this.reportFailure({ source: LogFailureSource.sink, error })
        }
      }
    })
  }
  /** Sink thenables keep the captured method and original receiver instead of double-probing. */
  #observeSink(result: unknown): void {
    /** A failed then getter is a sink failure and cannot escape the asynchronous drain. */
    const probe = probeThenable(result)
    if (probe.kind === ThenableProbeKind.failed)
      this.reportFailure({ source: LogFailureSource.sink, error: probe.error })
    else if (probe.kind === ThenableProbeKind.thenable)
      this.track(LogFailureSource.sink, assimilateCapturedThen<void>(probe.thenFn, result))
  }
  /** Drain both entry traversal and already-started plugin tasks inside one absolute budget. */
  async #drain(deadline: number): Promise<void> {
    while (this.#draining || this.#pending.size) {
      if (this.scheduler.now() >= deadline) return
      /** One snapshot is O(n) and includes the active queue traversal independently of its tail. */
      const tasks = [...this.#pending]
      if (this.#draining) tasks.push(this.#draining)
      if (
        !(await boundedWait(Promise.all(tasks), deadline, {
          scheduler: this.scheduler,
          reportCleanup: (error) => this.reportFailure({ source: LogFailureSource.flush, error })
        }))
      ) {
        return
      }
    }
  }
  /** A flush cycle catches clock, callback and wait failures before settling its public barrier. */
  async #flush(deadline?: number): Promise<void> {
    /** Shutdown keeps its observable phase throughout any nested flush. */
    const previous = this.#status
    if (previous === LogHostStatus.active) this.#status = LogHostStatus.flushing
    try {
      /** A shutdown supplies its existing absolute deadline rather than receiving another budget. */
      const deadlineAt = deadline ?? this.scheduler.now() + DRAIN_TIMEOUT_MS
      await this.#drain(deadlineAt)
      /** A flusher that misses or is skipped by the deadline is not part of host pending work. */
      let flushersTimedOut = false
      await withSnapshotEntries(this.#flushers, undefined, async (entries) => {
        for (const invocation of entries) {
          if (this.scheduler.now() >= deadlineAt) {
            flushersTimedOut = true
            break
          }
          try {
            if (
              !(await boundedWait(Promise.resolve(invocation.invoke()), deadlineAt, {
                scheduler: this.scheduler
              }))
            ) {
              flushersTimedOut = true
              break
            }
          } catch (error) {
            this.reportFailure({ source: LogFailureSource.flush, error })
          }
        }
      })
      await this.#drain(deadlineAt)
      if (flushersTimedOut || this.#draining || this.#pending.size)
        this.reportFailure({
          source: LogFailureSource.flush,
          error: createLogError(LogHostErrorCode.lifecycleDeadline, LogHostErrorText.flushDeadline)
        })
    } catch (error) {
      this.reportFailure({ source: LogFailureSource.flush, error })
    } finally {
      if (this.#status === LogHostStatus.flushing) this.#status = LogHostStatus.active
    }
  }
  /** Final handlers, admission closure, draining and canonical plugin cleanup always settle. */
  async #shutdown(reason: IShutdownReason): Promise<IPluginHostDisposalResult> {
    /** Disposal failures remain structured and never replace previously reported runtime failures. */
    const errors: unknown[] = []
    try {
      /** A failed clock must still allow canonical resource disposal below. */
      let deadline: number
      try {
        deadline = this.scheduler.now() + DRAIN_TIMEOUT_MS
      } catch (cause) {
        throw createLogError(LogHostErrorCode.invalidOption, LogHostErrorText.shutdownClockFailed, {
          cause
        })
      }
      await withSnapshotEntries(this.#shutdownHandlers, reason, async (entries) => {
        for (const invocation of entries) {
          try {
            if (
              !(await boundedWait(Promise.resolve(invocation.invoke()), deadline, {
                scheduler: this.scheduler
              }))
            )
              this.reportFailure({
                source: LogFailureSource.shutdown,
                error: createLogError(
                  LogHostErrorCode.lifecycleDeadline,
                  LogHostErrorText.shutdownHandlerDeadline
                )
              })
          } catch (error) {
            this.reportFailure({ source: LogFailureSource.shutdown, error })
          }
        }
      })
      this.#accepting = false
      await this.flush(deadline)
    } catch (error) {
      this.reportFailure({ source: LogFailureSource.shutdown, error })
      errors.push(error)
    }
    this.#accepting = false
    /** Default result remains terminal even if a custom disposal boundary rejects. */
    let result: IPluginHostDisposalResult = {
      logicalTerminal: true,
      cleanupComplete: false,
      cleanupErrors: Object.freeze([])
    }
    try {
      result = await this.#handle.dispose()
    } catch (error) {
      this.reportFailure({ source: LogFailureSource.shutdown, error })
      errors.push(error)
    }
    this.#status = LogHostStatus.closed
    if (errors.length)
      return { ...result, cleanupErrors: Object.freeze([...errors, ...result.cleanupErrors]) }
    return result
  }
}

/** Create one frozen host; synchronous configuration/installation failures remain creation errors. */
export function createLogHost<const P extends readonly ILogPluginConstraint[] = readonly []>(
  options: ILogHostOptions<P> = {}
): ILogHost<P> {
  return new LogHost(options).facade as ILogHost<P>
}
