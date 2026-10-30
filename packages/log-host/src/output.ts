import { boundedWait } from '@migaia/lifecycle'
import { retry, type IRetryContext, type IRetryFailureContext } from '@migaia/utils/promise'
import { attachErrorIdentity } from '@migaia/utils/error'
import type { IScheduledTask } from '@migaia/utils/scheduler'
import {
  definePlugin,
  type IFeatureRecord,
  type IFeatureOutputs,
  type IPluginConfig,
  type IPluginBeforeReleaseContext
} from '@migaia/plugin-host'
import type {
  ILogEntry,
  ILogFeature,
  ILogFeatureRecord,
  ILogFormat,
  ILogControlExtensions,
  ILogOutputRecord,
  ILogPlugin,
  ILogPluginCore,
  ILogFailure
} from './typing.ts'
import type { ILogDomainCore } from './core.ts'
import type { LogHost } from './host.ts'
import {
  featureScope,
  featureMetadata,
  installedFeatureScope,
  resolveFeatureScope,
  acceptsEntry,
  deliveryFeature,
  type IBatchOptions,
  type IFeatureImplementation
} from './feature-metadata.ts'
import {
  featureControlExtensions,
  composeFeatureExtensions,
  LogPolicyInstallation
} from './feature-policy.ts'
import { formatFeature } from './features/format.ts'
import {
  logCoreOwner,
  FeaturePhase,
  LogDeliveryPolicy,
  LogFailureSource,
  LogFormat,
  LogFeatureRoot
} from './state-constants.ts'
import { LogHostErrorCode, ERROR_SOURCE } from './error-code.ts'
import { LogHostErrorText } from './error-text.ts'
import { invalidOption, createLogError, tagLogError, createLogCleanupError } from './errors.ts'
import { DeliveryAttempt } from './delivery-attempt.ts'

/** Common output policy is independent of whether the transport consumes formatted text. */
type IOutputOptions<
  O extends Record<string, unknown>,
  F extends ILogFeatureRecord = ILogFeatureRecord
> = {
  name: string
  batchable: boolean
  features?: F
  retryable?(error: unknown): boolean
  retryDelay?(error: unknown): number | undefined
  install?(core: ILogPluginCore): O
}
/** Existing text consumers keep their definite record text and selected format context. */
type ITextOutputDefinition<
  O extends Record<string, unknown>,
  F extends ILogFeatureRecord = ILogFeatureRecord
> = IOutputOptions<O, F> & {
  consumesText?: true
  defaultFormat: 'json' | 'plain' | ILogFeature
  deliver(
    records: readonly ILogOutputRecord[],
    context: Readonly<{ signal: AbortSignal; format: ILogFormat }>
  ): void | Promise<void>
}
/** Entry-only transports receive no text or synthetic format descriptor. */
type IEntryOutputDefinition<
  O extends Record<string, unknown>,
  F extends ILogFeatureRecord = ILogFeatureRecord
> = IOutputOptions<O, F> & {
  consumesText: false
  defaultFormat?: never
  deliver(
    records: readonly Pick<ILogOutputRecord, 'entry'>[],
    context: Readonly<{ signal: AbortSignal }>
  ): void | Promise<void>
}
/** One public discriminant preserves inference without adding another SDK export. */
type IOutputDefinition<
  O extends Record<string, unknown>,
  F extends ILogFeatureRecord = ILogFeatureRecord
> = ITextOutputDefinition<O, F> | IEntryOutputDefinition<O, F>
/** Every internal output record retains its logical entry; only text consumers add text. */
type IEntryRecord = Pick<ILogOutputRecord, 'entry'>
/** Admitted factory configuration keeps the text descriptor correlated with the text definition. */
type IOutputConfiguration<O extends Record<string, unknown>> =
  | { consumesText: false; definition: IEntryOutputDefinition<O> }
  | {
      consumesText: true
      definition: ITextOutputDefinition<O>
      fallback: ILogFeature
    }

/** A scope's installed formatter is unique after alias overrides. */
function explicitFormat(features: Iterable<IFeatureImplementation>): ILogFormat | undefined {
  for (const feature of features) if (feature.phase === FeaturePhase.format) return feature
  return undefined
}
/** Literal defaults become native roots and are installed by the declaring output plugin. */
function normalizeFormat(
  value: ITextOutputDefinition<Record<string, unknown>>['defaultFormat']
): ILogFeature {
  if (value === LogFormat.json || value === LogFormat.plain) return formatFeature({ format: value })
  featureScope({ fallback: value })
  if (featureMetadata(value)?.phase !== FeaturePhase.format) throw invalidOption()
  return value
}

/** One started batch owns its retry/timeout state until every canonical attempt has settled. */
class DeliveryJob<R extends IEntryRecord> {
  /** Stable output installation owns formatting, reporting and its borrowed registration signal. */
  #output: OutputInstallation<R>
  /** A job retains only its own already-formatted batch. */
  #records: readonly R[]
  /** Optional queue receives completion without a per-batch long-lived callback closure. */
  #queue: BatchFeature<R> | undefined
  /** One public completion value participates in both host and batch drain barriers. */
  #promise: Promise<void> = Promise.resolve()
  /** Retry-after overrides are scoped to the immediately following attempt. */
  #retryDelay: number | undefined
  /** Each sequential attempt supplies its own canonical cancellation signal. */
  #attemptSignal: AbortSignal
  /** The current attempt owns exact delivery outcome and scheduler admission failures. */
  #currentAttempt: DeliveryAttempt<R> | undefined
  /** Cleanup originals survive retries in their first observed order. */
  #cleanupErrors: unknown[] = []
  /** Reused native failures occupy one position while distinct cleanup failures are never dropped. */
  #cleanupSeen = new Set<unknown>()
  /** Only the latest original utils cleanup value is needed for the final cause chain. */
  #lastCleanupFailure: unknown
  /** Capture a batch before starting it so the queue can register ownership first. */
  constructor(output: OutputInstallation<R>, records: readonly R[], queue?: BatchFeature<R>) {
    this.#output = output
    this.#records = records
    this.#queue = queue
    this.#attemptSignal = output.core.lifecycle.signal as AbortSignal
  }
  /** Every waiter sees the same already-started job completion. */
  get promise(): Promise<void> {
    return this.#promise
  }
  /** Start only after queue ownership exists, then attach the exact job to host pending work. */
  start(): void {
    this.#promise = this.#run()
    this.#output.host.track(
      this.#queue ? LogFailureSource.defer : LogFailureSource.sink,
      this.#promise
    )
  }
  /** Retry invokes this owner directly; each attempt then delegates its optional timeout to utils. */
  readonly #attempt = (context: IRetryContext): Promise<void> => {
    this.#attemptSignal = context.signal as AbortSignal
    return this.#executeAttempt()
  }
  /** Transport-provided retryability is consulted only after a failed attempt. */
  readonly #retryable = (error: unknown): boolean => {
    if (this.#currentAttempt?.fulfilled) return false
    return this.#output.definition.retryable?.(this.#currentAttempt?.primary(error)) ?? true
  }
  /** The beforeRetry hook captures the transport hint before utils computes the next delay. */
  readonly #beforeRetry = (error: unknown): void => {
    this.#retryDelay = this.#output.definition.retryDelay?.(this.#currentAttempt?.primary(error))
  }
  /** Retry-after replaces ordinary backoff, preserving transport-specific server advice. */
  readonly #delay = (_error: unknown, context: IRetryFailureContext): number => {
    if (this.#retryDelay !== undefined) return this.#retryDelay
    /** Normalized retry configuration was admitted before the output was installed. */
    const feature = this.#output.retryPolicy!
    return typeof feature.options.backoff === 'function'
      ? feature.options.backoff(context.attempt)
      : feature.options.backoff
  }
  /** Late rejections remain observable after a timeout, without rejecting the producer's flush. */
  readonly #lateReport = (error: unknown): void => this.#output.report(error)
  /** The final failure is reported once; retries consume intermediate failures privately. */
  async #run(): Promise<void> {
    try {
      /** Retry capability is a single canonical utils operation, never a second local retry loop. */
      const feature = this.#output.retryPolicy
      if (feature)
        await retry(this.#attempt, {
          maxAttempts: feature.options.attempts,
          shouldRetry: this.#retryable,
          beforeRetry: this.#beforeRetry,
          delay: this.#delay,
          scheduler: this.#output.core.scheduler,
          signal: this.#output.core.lifecycle.signal,
          report: this.#lateReport
        })
      else await this.#executeAttempt()
      if (this.#cleanupErrors.length)
        this.#output.report(
          this.#finalFailure(undefined),
          this.#queue ? LogFailureSource.defer : LogFailureSource.sink
        )
    } catch (error) {
      this.#output.report(
        this.#finalFailure(error),
        this.#queue ? LogFailureSource.defer : LogFailureSource.sink
      )
    } finally {
      this.#queue?.complete(this)
      this.#records = []
    }
  }
  /** A fresh attempt owns outcome classification without carrying prior-attempt state. */
  async #executeAttempt(): Promise<void> {
    const timeout = this.#output.timeoutMs
    this.#currentAttempt = new DeliveryAttempt(this.#output, this.#records)
    try {
      await this.#currentAttempt.run(this.#attemptSignal, timeout)
    } catch (error) {
      for (const cleanup of this.#currentAttempt.cleanupErrors)
        if (!this.#cleanupSeen.has(cleanup)) {
          this.#cleanupSeen.add(cleanup)
          this.#cleanupErrors.push(cleanup)
        }
      if (this.#currentAttempt.cleanupErrors.length)
        this.#lastCleanupFailure = this.#currentAttempt.cleanupFailure
      throw error
    }
  }
  /** Compose historical cleanup once without retaining every consumed intermediate primary. */
  #finalFailure(error: unknown): unknown {
    if (!this.#cleanupErrors.length || !this.#currentAttempt) return error
    /** A single-attempt result already has the exact canonical aggregate and needs no new layer. */
    const current = this.#currentAttempt.cleanupErrors
    if (
      error !== undefined &&
      current.length === this.#cleanupErrors.length &&
      current.every((cleanup, index) => cleanup === this.#cleanupErrors[index])
    )
      return error
    /** The final deliver primary precedes unique cleanup originals from all attempts. */
    const errors = this.#currentAttempt.fulfilled
      ? this.#cleanupErrors
      : [this.#currentAttempt.primary(error), ...this.#cleanupErrors]
    return createLogError(LogHostErrorCode.deliveryFailed, LogHostErrorText.deliveryFailed, {
      cause: new AggregateError(errors, LogHostErrorText.deliveryFailed, {
        cause: this.#lastCleanupFailure
      })
    })
  }
}

/** Per-output batch state is class-owned; queue slots contain data rather than deferred closures. */
class BatchFeature<R extends IEntryRecord> {
  /** Borrowed output owner starts attempts and reports through the same host policy. */
  #output: OutputInstallation<R>
  /** Limits were validated by the feature factory before this installation existed. */
  #options: Required<IBatchOptions>
  /** Items waiting for their size/timer boundary remain one plain record buffer. */
  #buffer: R[] = []
  /** Queued batches remain data arrays until a concurrency slot opens. */
  #queue: Array<R[] | undefined> = []
  /** Cursor removal keeps overflow and FIFO pumping linear rather than shifting arrays. */
  #cursor = 0
  /** Started jobs own their attempts until final settlement. */
  #jobs = new Set<DeliveryJob<R>>()
  /** One first-item timer triggers the current buffer without creating per-item closures. */
  #timer: IScheduledTask | undefined
  /** Cancellation is attempted once even if a hostile scheduler fires before returning its task. */
  #timerCancelAttempted = false
  /** A synchronous scheduler callback must still release its subsequently returned task. */
  #timerFired = false
  /** Disposing closes producer admission before draining already-owned data. */
  #accepting = true
  /** Late task callbacks become inert after final cleanup. */
  #active = true
  /** Concurrent drain requests share one completion value. */
  #flushing: Promise<void> | undefined
  /** Capture one output and its normalized batch policy. */
  constructor(output: OutputInstallation<R>, options: Required<IBatchOptions>) {
    this.#output = output
    this.#options = options
  }
  /** A shared class-field timer callback forwards to the owning batch state. */
  readonly #onTimer = (): void => this.#timerFlush()
  /** Buffer one record and arm only the first-item timer. */
  push(record: R): void {
    if (!this.#accepting || !this.#active) return
    this.#buffer.push(record)
    if (this.#buffer.length >= this.#options.maxSize) {
      this.#flushBuffer()
      return
    }
    if (this.#timer) return
    this.#timerCancelAttempted = false
    this.#timerFired = false
    try {
      this.#timer = this.#output.core.scheduler.schedule(this.#onTimer, this.#options.maxWaitMs)
      if (this.#timerFired) this.#cancelTimer()
    } catch (error) {
      this.#output.report(error, LogFailureSource.defer)
    }
  }
  /** Complete an active batch and immediately admit the next queued FIFO batch. */
  complete(job: DeliveryJob<R>): void {
    this.#jobs.delete(job)
    if (this.#active) this.#pump()
  }
  /** A timer owns only its current buffer; callback admission cannot outlive final cleanup. */
  #timerFlush(): void {
    this.#timerFired = true
    if (!this.#active) return
    try {
      this.#flushBuffer()
    } catch (error) {
      this.#output.report(error, LogFailureSource.defer)
    }
  }
  /** Cancel each returned scheduler handle once, reporting cleanup without hiding the primary path. */
  #cancelTimer(cleanupErrors?: unknown[]): void {
    /** Clear ownership before calling user-controlled cancellation code. */
    const timer = this.#timer
    this.#timer = undefined
    if (!timer || this.#timerCancelAttempted) return
    this.#timerCancelAttempted = true
    try {
      timer.cancel()
    } catch (error) {
      if (cleanupErrors)
        cleanupErrors.push(
          error instanceof Error
            ? tagLogError(error, LogHostErrorCode.pluginUninstallCleanupFailed)
            : createLogError(
                LogHostErrorCode.pluginUninstallCleanupFailed,
                LogHostErrorText.pluginUninstallCleanupFailed,
                { cause: error }
              )
        )
      else this.#output.report(error, LogFailureSource.defer)
    }
  }
  /** Detach the current buffer and enqueue it using the established oldest-queued overflow policy. */
  #flushBuffer(): void {
    this.#cancelTimer()
    if (this.#buffer.length === 0) return
    /** The batch owns this array after the active buffer is replaced. */
    const batch = this.#buffer
    this.#buffer = []
    if (this.#queue.length - this.#cursor + this.#jobs.size >= this.#options.maxPendingBatches) {
      /**
       * Already executing batches cannot be recalled; incoming data loses when no queued slot
       * exists.
       */
      const dropped = this.#cursor < this.#queue.length ? this.#queue[this.#cursor] : batch
      if (dropped !== batch) this.#queue[this.#cursor++] = undefined
      // At least one capacity window was consumed before copying a bounded queued tail.
      if (this.#cursor >= this.#options.maxPendingBatches) {
        this.#queue = this.#queue.slice(this.#cursor)
        this.#cursor = 0
      }
      this.#output.report(
        droppedEntries(
          LogHostErrorCode.batchOverflow,
          LogHostErrorText.batchOverflow,
          dropped?.length ?? 0
        ),
        LogFailureSource.defer
      )
      if (dropped === batch) return
    }
    this.#queue.push(batch)
    this.#pump()
  }
  /** Start each batch at most once and avoid allocating per-batch callbacks into a host-owned table. */
  #pump(): void {
    while (
      this.#cursor < this.#queue.length &&
      this.#jobs.size < this.#options.maxConcurrentBatches
    ) {
      /** Consume queued data before the job can synchronously reenter producer code. */
      const records = this.#queue[this.#cursor]!
      this.#queue[this.#cursor++] = undefined
      /** A named job owns retry, timeout and queue completion, with no closure factory. */
      const job = new DeliveryJob(this.#output, records, this)
      this.#jobs.add(job)
      job.start()
    }
    if (this.#cursor === this.#queue.length) {
      this.#queue = []
      this.#cursor = 0
    }
  }
  /** Drain with the established bounded wait while preserving one shared in-progress Promise. */
  flush(): Promise<void> {
    if (this.#flushing) return this.#flushing
    this.#flushing = this.#drain().finally(() => {
      this.#flushing = undefined
    })
    return this.#flushing
  }
  /** Full and partial batches share their output's normalized concurrency and pending capacity. */
  async #drain(): Promise<void> {
    if (!this.#active) return
    /** One drain deadline covers every batch already admitted by this controller. */
    const deadline = this.#output.core.scheduler.now() + this.#options.drainTimeoutMs
    do {
      this.#flushBuffer()
      this.#pump()
      /** A single snapshot includes exactly the currently started batches. */
      const pending = Array.from(this.#jobs, jobPromise)
      if (
        !(await boundedWait(Promise.all(pending), deadline, {
          scheduler: this.#output.core.scheduler,
          reportCleanup: this.#output.report
        }))
      )
        return
    } while (
      (this.#buffer.length || this.#queue.length - this.#cursor || this.#jobs.size) &&
      this.#output.core.scheduler.now() < deadline
    )
  }
  /** Final drain closes admission and explicitly reports data never handed to an output attempt. */
  async dispose(): Promise<void> {
    if (!this.#active) return
    this.#accepting = false
    /**
     * Drain and drop failures stay ordered, retaining the original failure rather than replacing
     * it.
     */
    const errors: unknown[] = []
    this.#cancelTimer(errors)
    try {
      await this.flush()
    } catch (error) {
      errors.push(error)
    }
    /** In-flight records already belong to delivery; only buffered/queued records count as dropped. */
    let dropped = this.#buffer.length
    for (let cursor = this.#cursor; cursor < this.#queue.length; cursor++)
      dropped += this.#queue[cursor]?.length ?? 0
    this.#active = false
    this.#cancelTimer()
    this.#buffer = []
    this.#queue = []
    this.#jobs.clear()
    if (dropped)
      errors.push(
        droppedEntries(
          LogHostErrorCode.pluginUninstallCleanupFailed,
          LogHostErrorText.batchDisposeDropped,
          dropped
        )
      )
    if (errors.length) throw createLogCleanupError(errors)
  }
}

/** Select job completion without allocating a closure per pending snapshot element. */
function jobPromise<R extends IEntryRecord>(job: DeliveryJob<R>): Promise<void> {
  return job.promise
}
/** Overflow diagnostics preserve the established dropped-entry detail channel. */
function droppedEntries(
  code:
    | typeof LogHostErrorCode.batchOverflow
    | typeof LogHostErrorCode.pluginUninstallCleanupFailed,
  text: string,
  dropped: number
): Error {
  /** Attach metadata to the native error without rebuilding its type or cause chain. */
  const error = attachErrorIdentity(new Error(text), { source: ERROR_SOURCE, code })
  Object.defineProperty(error, 'detail', { value: Object.freeze({ dropped }), enumerable: true })
  return error
}

/** Each installation owns gate policy, batching and canonical registration lifetime. */
abstract class OutputInstallation<R extends IEntryRecord> {
  /** Admitted work joins the actual host without reopening public defer admission. */
  readonly host: LogHost
  /** Real registration core owns scheduling and failure observations. */
  readonly core: ILogPluginCore
  /** Retry and lifetime policy are independent of text consumption. */
  readonly definition: IOutputOptions<Record<string, unknown>>
  /** Host/local defaults retain prescribed order after record-key overrides. */
  features: readonly IFeatureImplementation[] = []
  /** Local installed policy belongs to this native output registration. */
  readonly local: ReadonlyMap<string, IFeatureImplementation>
  /** The selected batch implementation prevents gate-only changes from resetting buffers. */
  #batchPolicy: IFeatureImplementation | undefined
  /** Gate placement is compiled once; entries execute only the selected gate implementations. */
  #gates: readonly Extract<IFeatureImplementation, { phase: 'gate' }>[] = []
  /** Delivery jobs read the selected retry policy directly without scanning feature metadata. */
  #retry: Extract<IFeatureImplementation, { policy: typeof LogDeliveryPolicy.retry }> | undefined
  /** Per-attempt timeout is resolved when the output configuration changes. */
  #timeoutMs: number | undefined
  /** Optional buffering has exactly the record type produced by this installation. */
  #batch: BatchFeature<R> | undefined
  /** Cleanup stops new sink admission while already-started jobs keep their owners. */
  #active = true
  /** Capture shared registration and delivery policy without erasing record types. */
  constructor(
    core: ILogPluginCore,
    definition: IOutputOptions<Record<string, unknown>>,
    local: ReadonlyMap<string, IFeatureImplementation>
  ) {
    this.core = core
    this.definition = definition
    this.host = (core as ILogPluginCore & ILogDomainCore)[logCoreOwner]
    this.local = local
  }
  /** Compile host overrides only after native publication, retaining unchanged batch state. */
  configure(defaults: ReadonlyMap<string, IFeatureImplementation>): void {
    this.features = resolveFeatureScope(defaults, this.local)
    /** Phase classification stays on the cold configuration path. */
    const gates: Array<Extract<IFeatureImplementation, { phase: 'gate' }>> = []
    for (const implementation of this.features)
      if (implementation.phase === FeaturePhase.gate) gates.push(implementation)
    this.#gates = gates
    this.#retry = deliveryFeature(this.features, LogDeliveryPolicy.retry)
    this.#timeoutMs = deliveryFeature(this.features, LogDeliveryPolicy.timeout)?.ms
    /** Batch behavior changes only when its actual installed policy changes. */
    const batch = this.definition.batchable
      ? deliveryFeature(this.features, LogDeliveryPolicy.batch)
      : undefined
    if (batch === this.#batchPolicy) return
    if (this.#batch) this.host.track(LogFailureSource.defer, this.#batch.dispose())
    this.#batchPolicy = batch
    this.#batch = batch ? new BatchFeature(this, batch.options) : undefined
  }
  /** Read the already selected retry instance in constant time for each job. */
  get retryPolicy():
    | Extract<IFeatureImplementation, { policy: typeof LogDeliveryPolicy.retry }>
    | undefined {
    return this.#retry
  }
  /** Read the already selected timeout in constant time for each delivery attempt. */
  get timeoutMs(): number | undefined {
    return this.#timeoutMs
  }
  /** Text and entry-only records are produced by their actual owning transport boundary. */
  abstract record(entry: ILogEntry): R
  /** The concrete transport receives only the context promised by its public branch. */
  abstract deliver(records: readonly R[], signal: AbortSignal): void | Promise<void>
  /** Delivery failures retain the installation's original failure channel, including late jobs. */
  readonly report = (error: unknown, source: ILogFailure['source'] = LogFailureSource.sink): void =>
    this.core.reportFailure({ source, error })
  /** Gates run before record creation; entry-only consumers never render text. */
  push(entry: ILogEntry): void {
    if (!this.#active || !acceptsEntry(this.#gates, entry)) return
    const record = this.record(entry)
    if (this.#batch) this.#batch.push(record)
    else new DeliveryJob(this, [record]).start()
  }
  /** The public flush hook drains only this output's optional batch buffer. */
  flush(): Promise<void> {
    return this.#batch?.flush() ?? Promise.resolve()
  }
  /** Close sink admission before draining already-owned buffered records. */
  async dispose(): Promise<void> {
    if (!this.#active) return
    this.#active = false
    await this.#batch?.dispose()
  }
}

/** Text output owns actual format resolution and uses the selected installed formatter. */
class TextOutputInstallation extends OutputInstallation<ILogOutputRecord> {
  /** The text branch requires both record text and a selected format. */
  #definition: ITextOutputDefinition<Record<string, unknown>>
  /** This is the installed formatter selected by local, host or default priority. */
  #format: ILogFormat
  /** Resolve formatting only for an output that consumes its result. */
  constructor(
    core: ILogPluginCore,
    definition: ITextOutputDefinition<Record<string, unknown>>,
    local: ReadonlyMap<string, IFeatureImplementation>,
    fallback: ILogFormat
  ) {
    super(core, definition, local)
    this.#definition = definition
    this.#fallback = fallback
    this.#format = explicitFormat(local.values()) ?? fallback
  }
  /** Fallback comes from this plugin's own native-installed default feature. */
  readonly #fallback: ILogFormat
  /** Select an installed formatter during configuration, never through a per-entry lookup. */
  override configure(defaults: ReadonlyMap<string, IFeatureImplementation>): void {
    super.configure(defaults)
    this.#format = explicitFormat(this.features) ?? this.#fallback
  }
  /** Render once with the cached installed formatter before buffering. */
  record(entry: ILogEntry): ILogOutputRecord {
    return { entry, text: this.#format.format(entry) }
  }
  /** Text consumers receive their original definite record and format context types. */
  deliver(records: readonly ILogOutputRecord[], signal: AbortSignal): void | Promise<void> {
    return this.#definition.deliver(records, { signal, format: this.#format })
  }
}

/** Entry-only output has no text or format state and cannot invoke the host's formatter. */
class EntryOutputInstallation extends OutputInstallation<IEntryRecord> {
  /** The entry-only branch promises no text fields to the transport callback. */
  #definition: IEntryOutputDefinition<Record<string, unknown>>
  /** Gate/batch policy is shared while record and context construction remain entry-only. */
  constructor(
    core: ILogPluginCore,
    definition: IEntryOutputDefinition<Record<string, unknown>>,
    local: ReadonlyMap<string, IFeatureImplementation>
  ) {
    super(core, definition, local)
    this.#definition = definition
  }
  /** Preserve the logical entry without manufacturing a text placeholder. */
  record(entry: ILogEntry): IEntryRecord {
    return { entry }
  }
  /** The public context contains the actual cancellation signal and no format placeholder. */
  deliver(records: readonly IEntryRecord[], signal: AbortSignal): void | Promise<void> {
    return this.#definition.deliver(records, { signal })
  }
}

/** A reusable authoring owner delegates feature construction and lifecycle to definePlugin. */
class OutputPlugin<
  N extends string,
  F extends ILogFeatureRecord,
  O extends Record<string, unknown>
> {
  /** Native roots include explicit local policies and this output’s fallback formatter. */
  readonly features: IFeatureRecord
  /** Stable callbacks and shallow option snapshots belong to this definition. */
  readonly #configuration: IOutputConfiguration<O>
  /** Caller aliases alone determine public control names and local overrides. */
  readonly local: F
  /** Native lifetime signals select the installed transport without owning registration identity. */
  readonly #outputs = new WeakMap<object, OutputInstallation<IEntryRecord>>()
  /**
   * A longer-than-caller alias keeps the native fallback root disjoint without reserving public
   * names.
   */
  readonly #fallbackAlias: string
  /** Exact literal plugin name contributes to inferred control extension names. */
  readonly #name: N

  /** Validate options and native roots before any transport owns resources. */
  constructor(definition: IOutputDefinition<O, F> & { name: N }) {
    if (
      !definition ||
      typeof definition.name !== 'string' ||
      !definition.name ||
      typeof definition.batchable !== 'boolean' ||
      typeof definition.deliver !== 'function' ||
      (definition.consumesText !== undefined && typeof definition.consumesText !== 'boolean')
    )
      throw invalidOption()
    this.#name = definition.name
    featureScope(definition.features, true)
    this.local = Object.freeze({ ...definition.features }) as F
    /** Any suffix on the longest declared alias is longer than every caller-owned key. */
    let longestAlias = ''
    for (const alias of Object.keys(this.local))
      if (alias.length > longestAlias.length) longestAlias = alias
    this.#fallbackAlias = `${longestAlias}${LogFeatureRoot.fallbackFormat}`
    /** The copied definition cannot be changed by later mutation of caller containers. */
    const snapshot = { ...definition, features: this.local }
    if (snapshot.consumesText === false) {
      if (snapshot.defaultFormat !== undefined) throw invalidOption()
      for (const feature of Object.values(this.local))
        if (featureMetadata(feature)?.phase === FeaturePhase.format) throw invalidOption()
      this.#configuration = { consumesText: false, definition: snapshot }
      this.features = Object.freeze({ ...this.local })
    } else {
      /** The native fallback root is independent of the explicit local single-format constraint. */
      const fallback = normalizeFormat(snapshot.defaultFormat)
      this.#configuration = { consumesText: true, definition: snapshot, fallback }
      this.features = Object.freeze({ ...this.local, [this.#fallbackAlias]: fallback })
    }
  }
  /** All policy and control values come from core.features built by plugin-host. */
  install(
    core: ILogPluginCore & { readonly features: Readonly<Record<string, unknown>> }
  ): O & ILogControlExtensions<N, F> {
    /** Alias projection selects actual native-installed local implementations. */
    const local = installedFeatureScope(this.local, core.features)
    /** Discriminated configuration keeps entry-only transports free of formatter work. */
    const configuration = this.#configuration
    /** The selected fallback was installed alongside all other native roots. */
    const output = configuration.consumesText
      ? new TextOutputInstallation(
          core,
          configuration.definition,
          local,
          (core.features[this.#fallbackAlias] as { implementation: ILogFormat }).implementation
        )
      : new EntryOutputInstallation(core, configuration.definition, local)
    /** The scope prepares this output against current and earlier same-batch declarations. */
    const policy = new LogPolicyInstallation(core, {
      name: this.#name,
      output: true,
      features: local,
      configure: (defaults) => output.configure(defaults)
    })
    /** This signal is issued and revoked by the native registration. */
    const signal = core.lifecycle.signal
    this.#outputs.set(signal, output)
    core.onDispose(() => this.#release(signal, output))
    core.onFlush(() => output.flush())
    core.useSink((entry) => output.push(entry))
    /** Commit only after application installation succeeds; native rollback owns the receipt. */
    const extensions = configuration.definition.install?.(core) ?? ({} as O)
    /** Preserve the native owner's thenable/container/descriptor rejection semantics. */
    const combined = composeFeatureExtensions(
      this.#name,
      extensions,
      featureControlExtensions(this.#name, this.local, core.features as IFeatureOutputs<F>)
    )
    policy.commit()
    return combined
  }
  /** Drain output work before native release revokes its borrowed resources. */
  beforeRelease(context: IPluginBeforeReleaseContext): void | Promise<void> {
    return this.#outputs.get(context.signal)?.dispose()
  }
  /** Forget derived dispatch state and reuse the output's idempotent disposer. */
  async #release(signal: object, output: OutputInstallation<IEntryRecord>): Promise<void> {
    this.#outputs.delete(signal)
    await output.dispose()
  }
}

/** Assemble an output with native feature roots and ordinary guarded plugin extensions. */
export function defineOutputPlugin<
  const N extends string,
  const F extends ILogFeatureRecord = Record<never, never>,
  O extends Record<string, unknown> = Record<never, never>
>(
  definition: IOutputDefinition<O, F> & { name: N }
): ILogPlugin<O & ILogControlExtensions<N, F>, IPluginConfig, F> {
  /** Definition callbacks forward to one named owner; plugin-host owns actual installation. */
  const owner = new OutputPlugin(definition)
  return definePlugin<
    ILogPluginCore,
    O & ILogControlExtensions<N, F>,
    ILogEntry,
    IPluginConfig,
    Record<never, never>,
    N,
    ILogFeatureRecord
  >({
    name: definition.name,
    features: owner.features as ILogFeatureRecord,
    install: (core) => owner.install(core),
    beforeRelease: (context) => owner.beforeRelease(context)
  }) as ILogPlugin<O & ILogControlExtensions<N, F>, IPluginConfig, F>
}
