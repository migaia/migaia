import {
  defineProbe,
  rpcProbeSampleKey,
  RpcProbeStageName,
  RpcProbeStage,
  type IRpcProbeDescriptor,
  type IRpcProbeEventView
} from '@migaia/rpc-core/probe'
import type { IRuntimePeerProvide } from '@migaia/rpc-core/remote'
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
import { NameTable, MessageTable } from './intern.js'
import { EventRing } from './ring.js'
import { CollectorStats } from './stats.js'
import { compileQuery, matchesSlot } from './query.js'
import { finishRecord } from './record.js'
import { createCollectorService } from './service.js'
import { reportFailure } from './report.js'
import { CollectorWatcher } from './watch.js'
import { CollectorLimit, CollectorText } from './text.js'

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

/** Build the complete host, then attach defineProbe once without copying or retaining a view. */
export function createRpcDevtools(options: IRpcDevtoolsOptions = {}): IRpcDevtools {
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
  /** Long-lived names are separate from recyclable message identities. */
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
  const stages = options.stages ?? RpcProbeStageName
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
  /** Numeric name identities remain alive while rings and statistics retain them. */
  const names = new NameTable(maxInterned, counters)
  /** Reference-counted message ids span main, recording and watch storage. */
  const messages = new MessageTable()
  /** Main retention consumes reusable views immediately into owned columns. */
  const ring = new EventRing(maxEvents, names, messages, onError)
  /** Aggregates remain independent of all ring eviction. */
  const statistics = new CollectorStats(names, maxInterned, onError)
  /** Only active watch generators register with the synchronous writer. */
  const watchers: CollectorWatcher[] = []
  /** Descriptor references come from the Core's cold construction callback. */
  const descriptors = new Map<string, IRpcProbeDescriptor>()
  /** Sequence stays monotonic across emitters with independent local sequence ids. */
  let sequence = 0
  /** Terminal closure never revives retained ownership. */
  let closed = false
  /** Direct in-flight calls after pause are counted separately from Core subscription gating. */
  let paused = false
  /** Reentrant redactors/reporters cannot corrupt the active view consumption. */
  let ingesting = false
  /** The recording handle owns this exact independent ring until stop or close. */
  let recording: EventRing | undefined
  /** Filled before returning or installing the completed frozen host. */
  let devtools: IRpcDevtools
  /** Compiled stage dispatch is checked before content or other event arguments are read. */
  let stageMask = 0
  /** Capture mask is immutable; metadata-only ingestion never reads view.content. */
  let captureMask = 0
  /** Compiled source method membership reuses defineProbe's canonical representation. */
  let methods: ReadonlySet<string> | undefined
  /** Full-sampling sentinel skips all hash work for the default metadata path. */
  let threshold = 0xffffffff

  /** Cold operations reject terminal state with the stable package CLOSED identity. */
  const assertOpen = (): void => {
    if (closed)
      throw identifyDevtoolsError(new Error(CollectorText.closed), RpcDevtoolsErrorCode.closed)
  }
  /** A boundary snapshot prevents public result mutation from changing live loss counters. */
  const counterSnapshot = (): IRpcDevtoolsCounters => ({
    evicted: counters.evicted,
    contentDropped: counters.contentDropped,
    droppedReentrant: counters.droppedReentrant,
    sampledOut: counters.sampledOut,
    ignoredWhilePaused: counters.ignoredWhilePaused,
    ignoredAfterClose: counters.ignoredAfterClose,
    internOverflow: counters.internOverflow
  })
  /** Convert only matching rows at the query boundary, using one scan and cached projections. */
  const query = (input?: IRpcDevtoolsQuery, content = true): IRpcDevtoolsPage => {
    assertOpen()
    /** All string matching compiles once into numeric masks before the scan starts. */
    const filter = compileQuery(input, names)
    /** Results retain cached boundary objects, without creating per-query row wrappers. */
    const events: IRpcDevtoolsWireEvent[] = []
    /** Excluded rows advance the cursor while a filled page preserves the next unread row. */
    let nextSeq = filter.after
    for (let i = 0; i < ring.count; i++) {
      /** Modulo index is independent of public sequence gaps. */
      const slot = (ring.head + i) % ring.capacity
      if (ring.columns.seq[slot]! <= filter.after) continue
      nextSeq = ring.columns.seq[slot]!
      if (matchesSlot(ring, slot, filter)) {
        events.push(ring.event(slot, content) as IRpcDevtoolsWireEvent)
        if (events.length === filter.limit) break
      }
    }
    return { events, nextSeq, counters: counterSnapshot() }
  }
  /** Watch storage and generator Promises belong solely to the explicit watch boundary. */
  const watch = (input?: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'>, content = true) => {
    assertOpen()
    return new CollectorWatcher(
      names,
      messages,
      input,
      content,
      watchers,
      onError,
      assertOpen
    ).iterate()
  }
  /** Describe retains descriptor elements by reference and supplies a fresh host clock sample. */
  const describe = () => {
    assertOpen()
    return {
      version: CollectorText.version,
      now: Date.now(),
      paused,
      descriptors: Array.from(descriptors.values()),
      limits: { maxEvents, maxContentBytes },
      counters: counterSnapshot()
    }
  }
  /** Stop is a record boundary; clearing the main ring never ends this independent window. */
  const stopRecord = (content: boolean) => {
    assertOpen()
    if (!recording)
      throw identifyDevtoolsError(
        new Error(CollectorText.recordNotActive),
        RpcDevtoolsErrorCode.recordNotActive
      )
    /** Release active ownership before exposing the stopped record. */
    const active = recording
    recording = undefined
    return finishRecord(active, content)
  }
  /** A record handle can stop only the exact active ring it created. */
  const record = (input?: Readonly<{ maxEvents?: number }>) => {
    assertOpen()
    if (recording)
      throw identifyDevtoolsError(
        new Error(CollectorText.recordActive),
        RpcDevtoolsErrorCode.recordActive
      )
    if (input !== undefined && (typeof input !== 'object' || input === null)) invalid()
    /** Record capacity is separate from main retention and uses the shared identity pools. */
    const active = new EventRing(
      capacity(input?.maxEvents, maxEvents, false, CollectorLimit.arrayCapacity),
      names,
      messages,
      onError
    )
    recording = active
    return {
      stop: () => {
        assertOpen()
        if (recording !== active)
          throw identifyDevtoolsError(
            new Error(CollectorText.recordNotActive),
            RpcDevtoolsErrorCode.recordNotActive
          )
        return stopRecord(true)
      }
    }
  }
  /** Pause removes Core dispatch subscriptions rather than changing the business pipeline. */
  const pause = (): void => {
    assertOpen()
    paused = true
    devtools.setStages([])
  }
  /** Resume restores the original construction subscription. */
  const resume = (): void => {
    assertOpen()
    paused = false
    devtools.setStages(stages)
  }
  /** Clear resets main retention and statistics; recorded windows and name ids keep ownership. */
  const clear = (): void => {
    assertOpen()
    ring.clear()
    statistics.clear()
    counters.evicted = 0
    counters.contentDropped = 0
    counters.droppedReentrant = 0
    counters.sampledOut = 0
    counters.ignoredWhilePaused = 0
    counters.ignoredAfterClose = 0
    counters.internOverflow = 0
  }
  /** Closure releases storage, updates subscriptions and wakes pending watcher operations. */
  const close = (): void => {
    if (closed) return
    closed = true
    devtools.setStages([])
    ring.clear()
    statistics.clear()
    recording?.clear()
    recording = undefined
    for (let i = 0; i < watchers.length; i++) watchers[i]!.close()
    names.clear()
    descriptors.clear()
  }
  /** All API members are constructed before defineProbe attaches to this exact host identity. */
  const api = {
    emit: (view: IRpcProbeEventView): void => {
      if (closed) {
        counters.ignoredAfterClose++
        return
      }
      if (paused) {
        counters.ignoredWhilePaused++
        return
      }
      if ((stageMask & (1 << view.stage)) === 0) return
      if (ingesting) {
        counters.droppedReentrant++
        return
      }
      ingesting = true
      try {
        if (
          (view.stage === RpcProbeStage.message || view.stage === RpcProbeStage.envelope) &&
          methods !== undefined &&
          (view.method === undefined || !methods.has(view.method))
        )
          return
        if (
          threshold !== 0xffffffff &&
          rpcProbeSampleKey(view.senderId ?? '', view.messageId ?? '') >= threshold
        ) {
          counters.sampledOut++
          return
        }
        /** Existing endpoint identities select the numeric warm path. */
        const endpoint = names.id(view.endpointId)
        /** Numeric method identity is shared by storage and statistics. */
        const method = names.id(view.method)
        /** Content is unread in metadata mode, and remains a reference after redaction. */
        let content: unknown
        /** Byte charge follows the retained payload reference. */
        let bytes = 0
        if ((captureMask & (1 << view.stage)) !== 0 && view.content !== undefined) {
          content = view.content
          if (redact) {
            try {
              content = redact(view.stage as RpcProbeStage, content)
            } catch (cause) {
              content = undefined
              reportFailure(
                identifyDevtoolsError(
                  new Error(CollectorText.redactFailed, { cause }),
                  RpcDevtoolsErrorCode.redactFailed
                ),
                onError
              )
            }
          }
          if (content !== undefined) {
            bytes = captureBytes(content, view)
            /** Replacement credits bytes from the retiring slot before evaluating the budget. */
            const retiredBytes =
              ring.count === ring.capacity ? ring.columns.contentBytes[ring.head]! : 0
            if (bytes > maxContentBytes - ring.bytes + retiredBytes) {
              content = undefined
              bytes = 0
              counters.contentDropped++
            }
          }
        }
        // A redactor or its reporter can synchronously close/pause this same collector.
        if (closed) {
          counters.ignoredAfterClose++
          return
        }
        if (paused) {
          counters.ignoredWhilePaused++
          return
        }
        if (ring.count === ring.capacity) counters.evicted++
        sequence = Math.max(sequence + 1, view.seq)
        /** The writer returns a numeric slot and allocates no event objects. */
        const slot = ring.write(view, sequence, content, bytes, endpoint, method)
        statistics.update(view, ring.columns.endpoint[slot]!, ring.columns.method[slot]!)
        if (closed || paused) return
        recording?.write(view, sequence, content, bytes, endpoint, method)
        for (let i = 0; i < watchers.length; i++) watchers[i]!.push(view, sequence, content, bytes)
      } catch (error) {
        reportFailure(error, onError)
      } finally {
        ingesting = false
      }
    },
    query,
    watch,
    stats: () => {
      assertOpen()
      return statistics.snapshot()
    },
    describe,
    record,
    exportRecord: encodeRpcDevtoolsRecord,
    importRecord: decodeRpcDevtoolsRecord,
    pause,
    resume,
    clear,
    close,
    service: {} as IRuntimePeerProvide
  }
  api.service = createCollectorService(
    {
      describe,
      query,
      watch,
      stats: api.stats,
      record,
      clear,
      pause,
      resume,
      exportRecord: encodeRpcDevtoolsRecord,
      stopRecord
    },
    exposeContent
  )
  try {
    devtools = defineProbe(
      {
        stages,
        capture,
        methods: options.methods,
        sample: options.sample,
        onError,
        describe: (descriptor) => {
          if (!closed) descriptors.set(descriptor.endpointId, descriptor)
        },
        emit: api.emit
      },
      api
    )
  } catch (cause) {
    invalid(cause)
  }
  stageMask = devtools.stageMask
  captureMask = devtools.captureMask
  methods = devtools.methods
  threshold = devtools.sampleThreshold
  return devtools
}
