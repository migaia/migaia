import type { IRpcContext } from '@migaia/rpc-core'
import { type IRpcProbeEventView } from '@migaia/rpc-core/probe'
import type { IRpcDevtoolsQuery, IRpcDevtoolsWatchBatch } from '../contract/service.js'
import type { IRpcDevtoolsWireEvent } from '../contract/wire.js'
import { RpcDevtoolsErrorCode } from '../error-code.js'
import { identifyDevtoolsError } from '../errors.js'
import { EventRing } from './ring.js'
import { NameTable } from './intern.js'
import { compileQuery, type ICollectorFilter } from './query.js'
import { CollectorLimit, CollectorText } from './text.js'

/** A watcher retains numeric columns and materializes wire events only when a consumer reads. */
export class CollectorWatcher {
  /** The extra pending batch permits a full queue to retire its oldest batch atomically. */
  #ring: EventRing
  /** Each committed entry holds at most 256 events; the queue contains at most 64 entries. */
  #lengths = new Uint16Array(CollectorLimit.batches)
  /** Oldest committed batch is addressed without shifting any retained events. */
  #head = 0
  /** Committed queue length remains bounded independently of the collector's query ring. */
  #count = 0
  /** Scheduled reader events accumulate until their bounded batch commits. */
  #pending = 0
  /** Lost event count is transferred into the next consumer-visible batch. */
  #dropped = 0
  /** Terminal watchers wake a pending consumer and discard all retained references. */
  #closed = false
  /** Explicit iterator return completes its pending next normally; Collector close still rejects. */
  #returning = false
  /** Iterator registration belongs to the collector's existing indexed active watcher array. */
  #active: CollectorWatcher[]
  /** Service exposure applies at the one representation boundary owned by iterate. */
  #exposeContent: boolean
  /** All filtering happens in the scheduled reader, after the raw burst has been retained. */
  #filter: ICollectorFilter
  /** First next samples sequence so a handle created earlier never receives historical rows. */
  #readSequence: () => number
  /** Only iterator reads allocate a waiting Promise; ingestion resolves its existing notifier. */
  #wake: (() => void) | undefined
  /** The collector's original lifetime guard covers handles whose first next follows close. */
  #assertOpen: (() => void) | undefined
  /** A mounted service borrows its existing stream scope to wake this owner on remote cancellation. */
  #signal: IRpcContext['signal'] | undefined

  /** Allocate bounded storage and compile filters once, before any watcher joins ingestion. */
  constructor(
    names: NameTable,
    input: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'> | undefined,
    exposeContent: boolean,
    active: CollectorWatcher[],
    readSequence: () => number,
    onError?: (error: unknown) => void,
    assertOpen?: () => void,
    signal?: IRpcContext['signal']
  ) {
    /** Watch uses the same cold validation domain as query before allocating retained storage. */
    const filter = compileQuery(input)
    this.#ring = new EventRing((CollectorLimit.batches + 1) * CollectorLimit.batch, names, onError)
    this.#exposeContent = exposeContent
    this.#active = active
    this.#assertOpen = assertOpen
    this.#signal = signal
    this.#filter = filter
    this.#readSequence = readSequence
  }

  /** Existing watcher retention participates in cold origin lookup, independently of the main ring. */
  get ring(): EventRing {
    return this.#ring
  }

  /** Scheduled delivery filters raw rows; the collector never invokes this on its emit stack. */
  push(
    view: IRpcProbeEventView,
    seq: number,
    content: unknown,
    bytes: number,
    carrierSequences: ReadonlyMap<number, number>
  ): void {
    if (this.#closed || seq <= this.#filter.after) return
    if ((this.#filter.stages & (1 << view.stage)) === 0) return
    if ((this.#filter.outcomes & (1 << view.outcome)) === 0) return
    if (this.#filter.trace !== undefined && view.trace !== this.#filter.trace) return
    if (this.#filter.endpoints !== undefined && !this.#filter.endpoints.has(view.endpointId)) return
    if (
      this.#filter.methods !== undefined &&
      (view.method === undefined || !this.#filter.methods.has(view.method))
    )
      return
    /** Raw queue ownership and resolved numeric joins survive shared-burst retirement. */
    const slot = this.#ring.write(view, seq, content, bytes)
    this.#ring.resolveCarrier(slot, carrierSequences)
    this.#pending++
    if (this.#pending === CollectorLimit.batch) this.#commit()
  }

  /**
   * Raw burst loss counts overwritten input rows, including rows whose filter can no longer be
   * known.
   */
  finishBurst(dropped: number): void {
    if (this.#closed) return
    this.#dropped += dropped
    this.#commit()
  }

  /** Commit one bounded batch; a slow consumer loses exactly the oldest committed batch. */
  #commit(): void {
    if (this.#pending === 0) return
    if (this.#count === CollectorLimit.batches) {
      /** The oldest batch's length also determines the message/content references released. */
      const lost = this.#lengths[this.#head]!
      for (let i = 0; i < lost; i++) this.#ring.drop()
      this.#dropped += lost
      this.#head = (this.#head + 1) % CollectorLimit.batches
      this.#count--
    }
    this.#lengths[(this.#head + this.#count) % CollectorLimit.batches] = this.#pending
    this.#count++
    this.#pending = 0
    /** Resolve the boundary-owned waiter at most once, without constructing a new Promise. */
    const wake = this.#wake
    this.#wake = undefined
    if (wake !== undefined) wake()
  }

  /** Closing is idempotent and wakes an actual pending next call with the collector CLOSED code. */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.clear()
    /** The waiting iterator observes closed before deciding whether another batch is available. */
    const wake = this.#wake
    this.#wake = undefined
    if (wake !== undefined) wake()
  }

  /** Release this watcher's ownership before the collector resets its shared intern identities. */
  clear(): void {
    this.#ring.clear()
    this.#head = 0
    this.#count = 0
    this.#pending = 0
    this.#dropped = 0
  }

  /** Wake this watch's existing pending next before queuing the native generator return. */
  iterate(): AsyncGenerator<IRpcDevtoolsWatchBatch> {
    /** The native generator continues to own next/throw/return sequencing and finalization. */
    const iterator = this.#iterate()
    /** Its inherited built-in return requires the exact branded generator as receiver. */
    const returnIterator = iterator.return
    Object.defineProperty(iterator, 'return', {
      configurable: true,
      writable: true,
      value: (value?: unknown) => {
        if (!this.#closed) {
          this.#returning = true
          this.close()
        }
        return Reflect.apply(returnIterator, iterator, [value]) as ReturnType<typeof returnIterator>
      }
    })
    return iterator
  }

  /** Activate before the first await; conversion, batching objects and Promises belong here. */
  async *#iterate(): AsyncGenerator<IRpcDevtoolsWatchBatch> {
    this.#assertOpen?.()
    this.#filter.after = this.#readSequence()
    this.#active.push(this)
    /** Stream cancellation wakes the existing pending read; it creates no second lifetime owner. */
    const onAbort = (): void => this.close()
    this.#signal?.addEventListener('abort', onAbort, { once: true })
    if (this.#signal?.aborted) this.close()
    try {
      while (true) {
        if (this.#closed) {
          if (this.#returning || this.#signal?.aborted) return
          throw identifyDevtoolsError(new Error(CollectorText.closed), RpcDevtoolsErrorCode.closed)
        }
        if (this.#count === 0) {
          await new Promise<void>((resolve) => {
            this.#wake = resolve
          })
          if (this.#closed) {
            if (this.#returning || this.#signal?.aborted) return
            throw identifyDevtoolsError(
              new Error(CollectorText.closed),
              RpcDevtoolsErrorCode.closed
            )
          }
          if (this.#count === 0) continue
        }
        /** Result array and its event projections are the watch representation boundary. */
        const events: IRpcDevtoolsWireEvent[] = []
        /** Removing one queue entry transfers its retained event ownership to the result array. */
        const length = this.#lengths[this.#head]!
        for (let i = 0; i < length; i++) {
          events.push(
            this.#ring.event(this.#ring.head, this.#exposeContent) as IRpcDevtoolsWireEvent
          )
          this.#ring.drop()
        }
        this.#head = (this.#head + 1) % CollectorLimit.batches
        this.#count--
        /** Report queue loss once, on the next batch delivered to this consumer. */
        const dropped = this.#dropped
        this.#dropped = 0
        yield { events, dropped }
      }
    } finally {
      this.#signal?.removeEventListener('abort', onAbort)
      /** Unregistration runs at the iterator boundary, outside synchronous event ingestion. */
      const index = this.#active.indexOf(this)
      if (index >= 0) this.#active.splice(index, 1)
      this.#closed = true
      this.clear()
    }
  }
}
