import { boundedWait } from '@migaia/lifecycle'
import { retry, type IRetryContext, type IRetryFailureContext } from '@migaia/utils/promise'
import { attachErrorIdentity } from '@migaia/utils/error'
import type { IScheduledTask } from '@migaia/utils/scheduler'
import type { IPluginBeforeReleaseContext } from '@migaia/plugin-host'
import type {
  ILogEntry,
  ILogFeature,
  ILogOutputRecord,
  ILogPlugin,
  ILogPluginCore,
  ILogFailure
} from './typing.ts'
import type { ILogDomainCore } from './core.ts'
import type { LogHost } from './host.ts'
import {
  featureScope,
  featureImplementation,
  resolveFeatureScope,
  acceptsEntry,
  deliveryFeature,
  type IBatchOptions
} from './feature-registry.ts'
import { formatFeature } from './features/format.ts'
import {
  logCoreOwner,
  FeaturePhase,
  FeatureKind,
  LogFailureSource,
  LogFormat
} from './state-constants.ts'
import { LogHostErrorCode, ERROR_SOURCE } from './error-code.ts'
import { LogHostErrorText } from './error-text.ts'
import { invalidOption, createLogError, tagLogError, createLogCleanupError } from './errors.ts'
import { DeliveryAttempt } from './delivery-attempt.ts'

/** Common output policy is independent of whether the transport consumes formatted text. */
type IOutputOptions<O extends Record<string, unknown>> = {
  name: string
  batchable: boolean
  features?: readonly ILogFeature[]
  retryable?(error: unknown): boolean
  retryDelay?(error: unknown): number | undefined
  install?(core: ILogPluginCore): O
}
/** Existing text consumers keep their definite record text and selected format context. */
type ITextOutputDefinition<O extends Record<string, unknown>> = IOutputOptions<O> & {
  consumesText?: true
  defaultFormat: 'json' | 'plain' | Extract<ILogFeature, { phase: 'format' }>
  deliver(
    records: readonly ILogOutputRecord[],
    context: Readonly<{ signal: AbortSignal; format: Extract<ILogFeature, { phase: 'format' }> }>
  ): void | Promise<void>
}
/** Entry-only transports receive no text or synthetic format descriptor. */
type IEntryOutputDefinition<O extends Record<string, unknown>> = IOutputOptions<O> & {
  consumesText: false
  defaultFormat?: never
  deliver(
    records: readonly Pick<ILogOutputRecord, 'entry'>[],
    context: Readonly<{ signal: AbortSignal }>
  ): void | Promise<void>
}
/** One public discriminant preserves inference without adding another SDK export. */
type IOutputDefinition<O extends Record<string, unknown>> =
  | ITextOutputDefinition<O>
  | IEntryOutputDefinition<O>
/** Every internal output record retains its logical entry; only text consumers add text. */
type IEntryRecord = Pick<ILogOutputRecord, 'entry'>
/** Admitted factory configuration keeps the text descriptor correlated with the text definition. */
type IOutputConfiguration<O extends Record<string, unknown>> =
  | { consumesText: false; definition: IEntryOutputDefinition<O> }
  | {
      consumesText: true
      definition: ITextOutputDefinition<O>
      fallback: Extract<ILogFeature, { phase: 'format' }>
    }

/** A scope's admitted format is unique, so no declaration-order selection policy is needed. */
function explicitFormat(
  features: Iterable<ILogFeature>
): Extract<ILogFeature, { phase: 'format' }> | undefined {
  for (const feature of features)
    if (featureImplementation(feature).phase === FeaturePhase.format)
      return feature as Extract<ILogFeature, { phase: 'format' }>
  return undefined
}
/** Normalize literal defaults through the canonical host formatter and preserve descriptor identity. */
function normalizeFormat(
  value: ITextOutputDefinition<Record<string, unknown>>['defaultFormat']
): Extract<ILogFeature, { phase: 'format' }> {
  if (value === LogFormat.json || value === LogFormat.plain) return formatFeature({ format: value })
  if (featureImplementation(value).phase !== FeaturePhase.format) throw invalidOption()
  return value as Extract<ILogFeature, { phase: 'format' }>
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
    const feature = deliveryFeature(this.#output.features, FeatureKind.retry)!
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
      const feature = deliveryFeature(this.#output.features, FeatureKind.retry)
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
    const timeout = deliveryFeature(this.#output.features, FeatureKind.timeout)
    this.#currentAttempt = new DeliveryAttempt(this.#output, this.#records)
    try {
      await this.#currentAttempt.run(this.#attemptSignal, timeout?.ms)
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
  /** Host/local defaults retain prescribed order after kind overrides. */
  readonly features: readonly ILogFeature[]
  /** Optional buffering has exactly the record type produced by this installation. */
  #batch: BatchFeature<R> | undefined
  /** Cleanup stops new sink admission while already-started jobs keep their owners. */
  #active = true
  /** Capture shared registration and delivery policy without erasing record types. */
  constructor(
    core: ILogPluginCore,
    definition: IOutputOptions<Record<string, unknown>>,
    local: ReadonlyMap<string, ILogFeature>
  ) {
    this.core = core
    this.definition = definition
    this.host = (core as ILogPluginCore & ILogDomainCore)[logCoreOwner]
    this.features = resolveFeatureScope(this.host.features, local)
    const batch = definition.batchable
      ? deliveryFeature(this.features, FeatureKind.batch)
      : undefined
    if (batch) this.#batch = new BatchFeature(this, batch.options)
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
    if (!this.#active || !acceptsEntry(this.features, entry)) return
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

/** Text output owns actual format resolution and preserves the selected descriptor identity. */
class TextOutputInstallation extends OutputInstallation<ILogOutputRecord> {
  /** The text branch requires both record text and a selected format. */
  #definition: ITextOutputDefinition<Record<string, unknown>>
  /** This is the exact descriptor selected by local, host or default priority. */
  #format: Extract<ILogFeature, { phase: 'format' }>
  /** Resolve formatting only for an output that consumes its result. */
  constructor(
    core: ILogPluginCore,
    definition: ITextOutputDefinition<Record<string, unknown>>,
    local: ReadonlyMap<string, ILogFeature>,
    fallback: Extract<ILogFeature, { phase: 'format' }>
  ) {
    super(core, definition, local)
    this.#definition = definition
    this.#format =
      explicitFormat(local.values()) ?? explicitFormat(this.host.features.values()) ?? fallback
  }
  /** Run the admitted formatter exactly once before buffering the resulting record. */
  record(entry: ILogEntry): ILogOutputRecord {
    const format = featureImplementation(this.#format) as Extract<
      ReturnType<typeof featureImplementation>,
      { phase: 'format' }
    >
    return { entry, text: format.format(entry) }
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
    local: ReadonlyMap<string, ILogFeature>
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

/** A reusable plugin definition creates fresh per-installation delivery and batch state. */
class OutputPlugin<O extends Record<string, unknown>> implements ILogPlugin<O> {
  /** Canonical plugin-host registration key is declared by the transport factory. */
  readonly name: string
  /** Stable callbacks and shallow option snapshots belong to this output definition. */
  #configuration: IOutputConfiguration<O>
  /** Local scope admission is shared with host scope admission, including unique format phase. */
  #local: ReadonlyMap<string, ILogFeature>
  /** Canonical lifetime signals select the correct installation when one plugin is reused by hosts. */
  #outputs = new WeakMap<object, Pick<OutputInstallation<IEntryRecord>, 'dispose'>>()
  /** Validate output options before a resource-owning installation begins. */
  constructor(definition: IOutputDefinition<O>) {
    if (
      !definition ||
      typeof definition.name !== 'string' ||
      !definition.name ||
      typeof definition.batchable !== 'boolean' ||
      typeof definition.deliver !== 'function' ||
      (definition.consumesText !== undefined &&
        definition.consumesText !== true &&
        definition.consumesText !== false)
    )
      throw invalidOption()
    this.name = definition.name
    const snapshot = { ...definition, features: [...(definition.features ?? [])] }
    this.#local = featureScope(snapshot.features, true)
    if (snapshot.consumesText === false) {
      if (snapshot.defaultFormat !== undefined || explicitFormat(this.#local.values()))
        throw invalidOption()
      this.#configuration = { consumesText: false, definition: snapshot }
    } else {
      this.#configuration = {
        consumesText: true,
        definition: snapshot,
        fallback: normalizeFormat(snapshot.defaultFormat)
      }
    }
  }
  /**
   * Acquire cleanup before transport installation so an install failure revokes all owned output
   * state.
   */
  install(core: ILogPluginCore): O {
    /**
     * One named installation owns policies and state; callback literals only forward to its
     * methods.
     */
    const configuration = this.#configuration
    const output = configuration.consumesText
      ? new TextOutputInstallation(
          core,
          configuration.definition,
          this.#local,
          configuration.fallback
        )
      : new EntryOutputInstallation(core, configuration.definition, this.#local)
    /** The real registration signal remains live through the peer's pre-release hook. */
    const signal = core.lifecycle.signal
    this.#outputs.set(signal, output)
    core.onDispose(() => this.#release(signal, output))
    core.onFlush(() => output.flush())
    core.useSink((entry) => output.push(entry))
    return configuration.definition.install?.(core) ?? ({} as O)
  }
  /**
   * Peer admission requires an own-data hook; one class field drains the selected live
   * registration.
   */
  readonly beforeRelease = (context: IPluginBeforeReleaseContext): void | Promise<void> =>
    this.#outputs.get(context.signal)?.dispose()
  /** Physical release removes installation lookup state and reuses the same idempotent cleanup. */
  async #release(
    signal: object,
    output: Pick<OutputInstallation<IEntryRecord>, 'dispose'>
  ): Promise<void> {
    this.#outputs.delete(signal)
    await output.dispose()
  }
}

/**
 * Define a transport while retaining its extension type and using the host's single policy
 * pipeline.
 */
export function defineOutputPlugin<O extends Record<string, unknown> = Record<string, never>>(
  definition: IOutputDefinition<O>
): ILogPlugin<O> {
  return new OutputPlugin(definition)
}
