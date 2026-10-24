import type { IRpcContext } from '@migaia/rpc-host'
import { systemScheduler } from '@migaia/utils/scheduler'
import {
  defineProbe,
  readProbeStages,
  subscribeProbeStages,
  rpcProbeSampleKey,
  RpcProbeStageName,
  RpcProbeStage,
  RpcProbeOutcome,
  type IRpcProbeDescriptor,
  type IRpcProbeEventView
} from '@migaia/rpc-host/probe'
import type { IRuntimePeerProvide } from '@migaia/rpc-host/plugin'
import { encodeRpcDevtoolsRecord, decodeRpcDevtoolsRecord } from '../contract/record-codec.js'
import type { IRpcDevtools, IRpcDevtoolsOptions } from '../collector-types.js'
import type {
  IRpcDevtoolsCounters,
  IRpcDevtoolsPage,
  IRpcDevtoolsQuery
} from '../contract/service.js'
import type { IRpcDevtoolsWireEvent } from '../contract/wire.js'
import { RpcDevtoolsErrorCode } from '../error-code.js'
import { identifyDevtoolsError } from '../errors.js'
import { NameTable } from './intern.js'
import { EventRing, readCarrierSequences } from './ring.js'
import { CollectorStats } from './stats.js'
import { compileQuery, matchesSlot } from './query.js'
import { finishRecord } from './record.js'
import { createCollectorService } from './service.js'
import { enqueueBatch, reportFailure } from './report.js'
import { CollectorWatcher } from './watch.js'
import { CollectorDefaultStages, CollectorLimit, CollectorText } from './text.js'

/** Configuration errors preserve the native TypeError and the original failure as cause. */
function invalid(cause?: unknown): never {
  throw identifyDevtoolsError(
    new TypeError(CollectorText.invalidOption, { cause }),
    RpcDevtoolsErrorCode.invalidOption
  )
}

/** Validate numeric capacity before constructing any storage owner. */
function capacity(
  value: number | undefined,
  fallback: number,
  zero = false,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  /** Undefined selects the construction default; zero is permitted only for the byte budget. */
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < (zero ? 0 : 1) || result > maximum) invalid()
  return result
}

/** Count known capture bytes without copying; opaque logical objects use their supplied size. */
function captureBytes(content: unknown, view: IRpcProbeEventView): number {
  if (ArrayBuffer.isView(content)) return content.byteLength
  if (content instanceof ArrayBuffer) return content.byteLength
  if (typeof content === 'string') {
    /** UTF-8 size is computed without allocating a TextEncoder buffer on ingestion. */
    let bytes = 0
    for (let i = 0; i < content.length; i++) {
      /** A surrogate pair contributes one scalar; isolated surrogates encode as replacement. */
      const point = content.codePointAt(i)!
      if (point > 0xffff) {
        bytes += 4
        i++
      } else bytes += point < 0x80 ? 1 : point < 0x800 ? 2 : 3
    }
    return bytes
  }
  return view.sizeBytes < 0 ? 0 : view.sizeBytes
}

/**
 * Create a bounded collector installable directly as a Core probe. Defaults observe message/peer
 * metadata without content; invalid capacities or probe options throw INVALID_OPTION. Consume
 * reusable views immediately, retaining nested payload/error/detail references rather than clones.
 * query reads history, watch subscribes on first next, and recording owns an independent ring. The
 * caller closes this collector and its separate serving Peer. close is synchronous/idempotent,
 * releases retention and rejects pending watches with CLOSED, without closing any Peer/transport.
 * Pure record codecs remain callable after close.
 */
/** Validate collector configuration and allocate its owned storage without installing callbacks. */
function collectorState(options: IRpcDevtoolsOptions) {
  if (typeof options !== 'object' || options === null) invalid()
  /** One capacity is shared by all main-ring columns. */
  const maxEvents = capacity(
    options.maxEvents,
    CollectorLimit.events,
    false,
    CollectorLimit.arrayCapacity
  )
  /** Byte accounting never causes normalization or cloning on metadata ingestion. */
  const maxContentBytes = capacity(options.maxContentBytes, CollectorLimit.contentBytes, true)
  /** The cold intern table retains its bounded public overflow vocabulary. */
  const maxInterned = capacity(
    options.maxInterned,
    CollectorLimit.interned,
    false,
    CollectorLimit.pairCapacity
  )
  if (options.exposeContent !== undefined && typeof options.exposeContent !== 'boolean') invalid()
  if (options.redact !== undefined && typeof options.redact !== 'function') invalid()
  if (options.onError !== undefined && typeof options.onError !== 'function') invalid()
  /** Stage subscription is compiled at construction and restored by resume(). */
  const stages = options.stages ?? CollectorDefaultStages
  /** Each captured stage is explicitly opted in, including protected content. */
  const capture = options.capture
  /** Remote content exposure is a separate public boundary decision. */
  const exposeContent = options.exposeContent === true
  /** Collector redaction owns direct and real-emitter ingestion exactly once. */
  const redact = options.redact
  /** Reporter identity stays fixed even if the caller mutates construction options. */
  const onError = options.onError
  /** One loss state is shared by the collector's retention and lifecycle decisions. */
  const counters = {
    evicted: 0,
    contentDropped: 0,
    droppedReentrant: 0,
    sampledOut: 0,
    ignoredWhilePaused: 0,
    ignoredAfterClose: 0,
    internOverflow: 0
  }
  /** Reader projections share one bounded name table; raw ingestion never calls it. */
  const names = new NameTable(maxInterned, counters)
  /** Main retention consumes reusable views immediately into owned columns. */
  const ring = new EventRing(maxEvents, names, onError)
  /** Aggregates remain independent of all ring eviction. */
  const statistics = new CollectorStats(names, onError)
  /** Only active watch generators enable the shared raw burst writer. */
  const watchers: CollectorWatcher[] = []
  /** One raw burst store preserves watcher ingestion independently of the main-ring capacity. */
  const watchPending = undefined as EventRing | undefined
  /** Pending overwrite counts raw rows whose filters are no longer recoverable. */
  let watchDropped = 0
  /** A single flag coalesces every active watcher notification within one synchronous burst. */
  let watchScheduled = false
  /** Descriptor references come from the Core's cold construction callback. */
  const descriptors = new Map<string, IRpcProbeDescriptor>()
  /** Actual serving endpoint identities exclude self traffic without guessing service method names. */
  const serviceEndpoints = new Set<string>()
  /** Pause restores the user's current cold selection, including stages added after construction. */
  let pausedStages = stages
  /** Direct host ingestion follows stage changes through the public cold subscription. */
  const releaseStages = undefined as (() => void) | undefined
  /** Sequence stays monotonic across emitters with independent local sequence ids. */
  let sequence = 0
  /** Terminal closure never revives retained ownership. */
  let closed = false
  /** Direct in-flight calls after pause are counted separately from Core subscription gating. */
  let paused = false
  /** Reentrant redactors/reporters cannot corrupt the active view consumption. */
  let ingesting = false
  /** The recording handle owns this exact independent ring until stop or close. */
  const recording = undefined as EventRing | undefined
  /** Filled before returning or installing the completed frozen host. */
  const devtools = undefined as unknown as IRpcDevtools
  /** Compiled stage dispatch is checked before content or other event arguments are read. */
  let stageMask = 0
  /** Capture mask is immutable; metadata-only ingestion never reads view.content. */
  let captureMask = 0
  /** Compiled source method membership reuses defineProbe's canonical representation. */
  const methods = undefined as ReadonlySet<string> | undefined
  /** Full-sampling sentinel skips all hash work for the default metadata path. */
  let threshold = 0xffffffff

  return {
    maxEvents,
    maxContentBytes,
    maxInterned,
    stages,
    capture,
    exposeContent,
    redact,
    onError,
    counters,
    names,
    ring,
    statistics,
    watchers,
    watchPending: watchPending as EventRing | undefined,
    watchDropped,
    watchScheduled,
    descriptors,
    serviceEndpoints,
    pausedStages,
    releaseStages: releaseStages as (() => void) | undefined,
    sequence,
    closed,
    paused,
    ingesting,
    recording: recording as EventRing | undefined,
    devtools,
    stageMask,
    captureMask,
    methods: methods as ReadonlySet<string> | undefined,
    threshold
  }
}

/** Own all collector retention, sequencing and lifecycle state behind one installed probe identity. */
class RpcDevtoolsCollector {
  /** Storage, subscriptions and reader masks belong to this collector instance. */
  #state: ReturnType<typeof collectorState>

  /** Install the collector's public callbacks only after all owned storage is available. */
  constructor(options: IRpcDevtoolsOptions) {
    this.#state = collectorState(options)
    /** All API members are constructed before defineProbe attaches to this exact host identity. */
    const api = {
      emit: this.#emit,
      query: this.#query,
      watch: this.#watch,
      stats: () => {
        this.#assertOpen()
        return this.#state.statistics.snapshot(this.#state.serviceEndpoints)
      },
      describe: this.#describe,
      record: this.#record,
      exportRecord: encodeRpcDevtoolsRecord,
      importRecord: decodeRpcDevtoolsRecord,
      pause: this.#pause,
      resume: this.#resume,
      clear: this.#clear,
      close: this.#close,
      service: {} as IRuntimePeerProvide
    }
    api.service = createCollectorService(
      {
        describe: this.#describe,
        query: this.#query,
        watch: this.#watch,
        stats: api.stats,
        record: this.#record,
        clear: this.#clear,
        pause: this.#pause,
        resume: this.#resume,
        exportRecord: encodeRpcDevtoolsRecord,
        stopRecord: this.#stopRecord,
        excludeEndpoint: (endpointId: string) => {
          this.#state.serviceEndpoints.add(endpointId)
        }
      },
      this.#state.exposeContent
    )
    try {
      this.#state.devtools = defineProbe(
        {
          stages: this.#state.stages,
          capture: this.#state.capture,
          methods: options.methods,
          sample: options.sample,
          onError: this.#state.onError,
          describe: (descriptor) => {
            if (!this.#state.closed) this.#state.descriptors.set(descriptor.endpointId, descriptor)
          },
          emit: api.emit
        },
        api
      )
    } catch (cause) {
      invalid(cause)
    }
    this.#state.stageMask = readProbeStages(this.#state.devtools)
    this.#state.releaseStages = subscribeProbeStages(this.#state.devtools, () => {
      this.#state.stageMask = readProbeStages(this.#state.devtools)
    })
    this.#state.captureMask = this.#state.devtools.captureMask
    this.#state.methods = this.#state.devtools.methods
    this.#state.threshold = this.#state.devtools.sampleThreshold
  }

  /** Return the exact Core-branded host object installed during construction. */
  get value(): IRpcDevtools {
    return this.#state.devtools
  }

  /** Cold operations reject terminal state with the stable package CLOSED identity. */
  #assertOpen = (): void => {
    if (this.#state.closed)
      throw identifyDevtoolsError(new Error(CollectorText.closed), RpcDevtoolsErrorCode.closed)
  }

  /** A boundary snapshot prevents public result mutation from changing live loss counters. */
  #counterSnapshot = (): IRpcDevtoolsCounters => ({
    evicted: this.#state.counters.evicted,
    contentDropped: this.#state.counters.contentDropped,
    droppedReentrant: this.#state.counters.droppedReentrant,
    sampledOut: this.#state.counters.sampledOut,
    ignoredWhilePaused: this.#state.counters.ignoredWhilePaused,
    ignoredAfterClose: this.#state.counters.ignoredAfterClose,
    internOverflow: this.#state.counters.internOverflow
  })

  /** Cold origin lookup includes every current retention owner and an explicitly stopping record. */
  #carrierSequences = (active?: EventRing): ReadonlyMap<number, number> => {
    /** This array exists only at a reader boundary, never for an ingested event. */
    const owners = [this.#state.ring]
    if (this.#state.recording !== undefined) owners.push(this.#state.recording)
    if (active !== undefined && active !== this.#state.recording) owners.push(active)
    if (this.#state.watchPending !== undefined) owners.push(this.#state.watchPending)
    for (const watcher of this.#state.watchers) owners.push(watcher.ring)
    return readCarrierSequences(owners)
  }

  /** One prebuilt notification callback does watcher filtering and queue work off the emit stack. */
  #notifyWatchers = (): void => {
    this.#state.watchScheduled = false
    if (this.#state.closed || this.#state.watchPending === undefined) return
    /** Resolve links before any raw origin in this synchronous burst retires. */
    const links = this.#carrierSequences()
    /** Raw overwrite loss is reported once to each watcher at this delivery boundary. */
    const dropped = this.#state.watchDropped
    this.#state.watchDropped = 0
    while (this.#state.watchPending.count !== 0) {
      /** Raw rows are reconstructed once, then shared by the cold watcher fan-out. */
      const slot = this.#state.watchPending.head
      /** The source view was consumed already; this object belongs to scheduled delivery. */
      const view = this.#state.watchPending.view(slot)
      if (!this.#state.serviceEndpoints.has(view.endpointId)) {
        for (const watcher of this.#state.watchers)
          watcher.push(
            view,
            this.#state.watchPending.columns.seq[slot]!,
            this.#state.watchPending.columns.content[slot],
            this.#state.watchPending.columns.contentBytes[slot]!,
            links
          )
      }
      this.#state.watchPending.drop()
    }
    for (const watcher of this.#state.watchers) watcher.finishBurst(dropped)
  }

  /** Convert only matching rows at the query boundary, using one scan and cached projections. */
  #query = (input?: IRpcDevtoolsQuery, content = true): IRpcDevtoolsPage => {
    this.#assertOpen()
    /** Masks and string memberships compile once before scanning raw columns. */
    const filter = compileQuery(input)
    /** Results retain cached boundary objects, without creating per-query row wrappers. */
    const events: IRpcDevtoolsWireEvent[] = []
    /** Correlation is derived once from retained raw owners for this snapshot. */
    const links = this.#carrierSequences()
    /** Excluded rows advance the cursor while a filled page preserves the next unread row. */
    let nextSeq = filter.after
    for (let i = 0; i < this.#state.ring.count; i++) {
      /** Modulo index is independent of public sequence gaps. */
      const slot = (this.#state.ring.head + i) % this.#state.ring.capacity
      if (this.#state.ring.columns.seq[slot]! <= filter.after) continue
      nextSeq = this.#state.ring.columns.seq[slot]!
      if (
        !this.#state.serviceEndpoints.has(this.#state.ring.columns.endpoint[slot]!) &&
        matchesSlot(this.#state.ring, slot, filter)
      ) {
        events.push(this.#state.ring.event(slot, content, false, links) as IRpcDevtoolsWireEvent)
        if (events.length === filter.limit) break
      }
    }
    return { events, nextSeq, counters: this.#counterSnapshot() }
  }

  /** Watch storage and generator Promises belong solely to the explicit watch boundary. */
  #watch = (
    input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>,
    content = true,
    signal?: IRpcContext['signal']
  ) => {
    this.#assertOpen()
    if (this.#state.watchPending === undefined)
      this.#state.watchPending = new EventRing(
        CollectorLimit.batches * CollectorLimit.batch,
        this.#state.names,
        this.#state.onError
      )
    return new CollectorWatcher(
      this.#state.names,
      input,
      content,
      this.#state.watchers,
      () => this.#state.sequence,
      this.#state.onError,
      this.#assertOpen,
      signal
    ).iterate()
  }

  /** Describe retains descriptor elements by reference and supplies a fresh host clock sample. */
  #describe = () => {
    this.#assertOpen()
    return {
      version: CollectorText.version,
      now: systemScheduler.now(),
      paused: this.#state.paused,
      descriptors: Array.from(this.#state.descriptors.values()),
      limits: { maxEvents: this.#state.maxEvents, maxContentBytes: this.#state.maxContentBytes },
      counters: this.#counterSnapshot()
    }
  }

  /** Stop is a record boundary; clearing the main ring never ends this independent window. */
  #stopRecord = (content: boolean) => {
    this.#assertOpen()
    if (!this.#state.recording)
      throw identifyDevtoolsError(
        new Error(CollectorText.recordNotActive),
        RpcDevtoolsErrorCode.recordNotActive
      )
    /** Release active ownership before exposing the stopped record. */
    const active = this.#state.recording
    this.#state.recording = undefined
    return finishRecord(active, content, this.#carrierSequences(active))
  }

  /** A record handle can stop only the exact active ring it created. */
  #record = (input?: Readonly<{ maxEvents?: number }>) => {
    this.#assertOpen()
    if (this.#state.recording)
      throw identifyDevtoolsError(
        new Error(CollectorText.recordActive),
        RpcDevtoolsErrorCode.recordActive
      )
    if (input !== undefined && (typeof input !== 'object' || input === null)) invalid()
    /** Record capacity is separate from main retention and stores the same raw field references. */
    const active = new EventRing(
      capacity(input?.maxEvents, this.#state.maxEvents, false, CollectorLimit.arrayCapacity),
      this.#state.names,
      this.#state.onError
    )
    this.#state.recording = active
    return {
      stop: () => {
        this.#assertOpen()
        if (this.#state.recording !== active)
          throw identifyDevtoolsError(
            new Error(CollectorText.recordNotActive),
            RpcDevtoolsErrorCode.recordNotActive
          )
        return this.#stopRecord(true)
      }
    }
  }

  /** Pause removes Core dispatch subscriptions rather than changing the business pipeline. */
  #pause = (): void => {
    this.#assertOpen()
    if (this.#state.paused) return
    /** Stage names are reconstructed only at this cold lifecycle boundary. */
    const current = readProbeStages(this.#state.devtools)
    this.#state.pausedStages = []
    for (let i = 0; i < RpcProbeStageName.length; i++)
      if ((current & (1 << i)) !== 0)
        (this.#state.pausedStages as string[]).push(RpcProbeStageName[i]!)
    this.#state.paused = true
    this.#state.devtools.setStages([])
  }

  /** Resume restores the selection captured by the first pause, without reviving closed storage. */
  #resume = (): void => {
    this.#assertOpen()
    if (!this.#state.paused) return
    this.#state.paused = false
    this.#state.devtools.setStages(this.#state.pausedStages)
  }

  /** Clear resets main retention and statistics; recorded and watch windows keep their ownership. */
  #clear = (): void => {
    this.#assertOpen()
    this.#state.ring.clear()
    this.#state.statistics.clear()
    this.#state.counters.evicted = 0
    this.#state.counters.contentDropped = 0
    this.#state.counters.droppedReentrant = 0
    this.#state.counters.sampledOut = 0
    this.#state.counters.ignoredWhilePaused = 0
    this.#state.counters.ignoredAfterClose = 0
    this.#state.counters.internOverflow = 0
  }

  /** Closure releases storage, updates subscriptions and wakes pending watcher operations. */
  #close = (): void => {
    if (this.#state.closed) return
    this.#state.closed = true
    this.#state.devtools.setStages([])
    ;(0, this.#state.releaseStages)?.()
    this.#state.ring.clear()
    this.#state.statistics.clear()
    this.#state.recording?.clear()
    this.#state.watchPending?.clear()
    this.#state.recording = undefined
    for (let i = 0; i < this.#state.watchers.length; i++) this.#state.watchers[i]!.close()
    this.#state.names.clear()
    this.#state.descriptors.clear()
  }

  /** Consume a reusable probe view into the collector's current retention owners. */
  #emit = (view: IRpcProbeEventView): void => {
    if (this.#state.closed) {
      this.#state.counters.ignoredAfterClose++
      return
    }
    if (this.#state.paused) {
      this.#state.counters.ignoredWhilePaused++
      return
    }
    if ((this.#state.stageMask & (1 << view.stage)) === 0) return
    if (this.#state.serviceEndpoints.has(view.endpointId)) return
    if (this.#state.ingesting) {
      this.#state.counters.droppedReentrant++
      return
    }
    this.#state.ingesting = true
    try {
      if (
        (view.stage === RpcProbeStage.message || view.stage === RpcProbeStage.envelope) &&
        this.#state.methods !== undefined &&
        view.method !== undefined &&
        !this.#state.methods.has(view.method)
      )
        return
      if (
        this.#state.threshold !== 0xffffffff &&
        rpcProbeSampleKey(view.senderId ?? '', view.messageId ?? '') >= this.#state.threshold
      ) {
        this.#state.counters.sampledOut++
        return
      }
      /** Content is unread in metadata mode, and remains a reference after redaction. */
      let content: unknown
      /** Byte charge follows the retained payload reference. */
      let bytes = 0
      if ((this.#state.captureMask & (1 << view.stage)) !== 0 && view.content !== undefined) {
        content = view.content
        if (this.#state.redact) {
          try {
            content = (0, this.#state.redact)(view.stage as RpcProbeStage, content)
          } catch (cause) {
            content = undefined
            reportFailure(
              identifyDevtoolsError(
                new Error(CollectorText.redactFailed, { cause }),
                RpcDevtoolsErrorCode.redactFailed
              ),
              this.#state.onError
            )
          }
        }
        if (content !== undefined) {
          bytes = captureBytes(content, view)
          /** Replacement credits bytes from the retiring slot before evaluating the budget. */
          const retiredBytes =
            this.#state.ring.count === this.#state.ring.capacity
              ? this.#state.ring.columns.contentBytes[this.#state.ring.head]!
              : 0
          if (bytes > this.#state.maxContentBytes - this.#state.ring.bytes + retiredBytes) {
            content = undefined
            bytes = 0
            this.#state.counters.contentDropped++
          }
        }
      }
      // A redactor or its reporter can synchronously close/pause this same collector.
      if (this.#state.closed) {
        this.#state.counters.ignoredAfterClose++
        return
      }
      if (this.#state.paused) {
        this.#state.counters.ignoredWhilePaused++
        return
      }
      if (this.#state.ring.count === this.#state.ring.capacity) this.#state.counters.evicted++
      this.#state.sequence = Math.max(this.#state.sequence + 1, view.seq)
      /** The writer returns a numeric slot and allocates no event objects. */
      this.#state.ring.write(view, this.#state.sequence, content, bytes)
      if (
        view.stage === RpcProbeStage.message &&
        view.durationMs >= 0 &&
        view.method !== undefined &&
        (view.outcome === RpcProbeOutcome.settled ||
          view.outcome === RpcProbeOutcome.failed ||
          view.outcome === RpcProbeOutcome.rejected)
      )
        this.#state.statistics.update(view)
      if (this.#state.closed || this.#state.paused) return
      this.#state.recording?.write(view, this.#state.sequence, content, bytes)
      if (this.#state.watchers.length !== 0) {
        if (this.#state.watchPending!.count === this.#state.watchPending!.capacity)
          this.#state.watchDropped++
        this.#state.watchPending!.write(view, this.#state.sequence, content, bytes)
        if (!this.#state.watchScheduled) {
          this.#state.watchScheduled = true
          enqueueBatch(this.#notifyWatchers)
        }
      }
    } catch (error) {
      reportFailure(error, this.#state.onError)
    } finally {
      this.#state.ingesting = false
    }
  }
}

/** Create one collector owner and return its exact Core-installed probe identity. */
export function createRpcDevtools(options: IRpcDevtoolsOptions = {}): IRpcDevtools {
  return new RpcDevtoolsCollector(options).value
}
