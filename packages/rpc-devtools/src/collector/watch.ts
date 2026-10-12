import { RpcProbeStageName, type IRpcProbeEventView } from '@migaia/rpc-core/probe'
import type { IRpcDevtoolsQuery, IRpcDevtoolsWatchBatch } from '../contract/service.js'
import type { IRpcDevtoolsWireEvent } from '../contract/wire.js'
import { RpcDevtoolsErrorCode } from '../error-code.js'
import { identifyDevtoolsError } from '../errors.js'
import { EventRing } from './ring.js'
import { NameTable, MessageTable } from './intern.js'
import { enqueueBatch, reportFailure } from './report.js'
import { compileQuery } from './query.js'
import { CollectorLimit, CollectorText } from './text.js'

/** A watcher retains numeric columns and materializes wire events only when a consumer reads. */
export class CollectorWatcher {
  /** The extra pending batch permits a full queue to retire its oldest batch atomically. */
  #ring: EventRing
  /** Name ids are read without interning query inputs or changing collector retention counters. */
  #names: NameTable
  /** Each committed entry holds at most 256 events; the queue contains at most 64 entries. */
  #lengths = new Uint16Array(CollectorLimit.batches)
  /** Oldest committed batch is addressed without shifting any retained events. */
  #head = 0
  /** Committed queue length remains bounded independently of the collector's query ring. */
  #count = 0
  /** Uncommitted events share the construction-time microtask flush callback. */
  #pending = 0
  /** Lost event count is transferred into the next consumer-visible batch. */
  #dropped = 0
  /** A pending flush is queued once until that callback runs. */
  #scheduled = false
  /** Terminal watchers wake a pending consumer and discard all retained references. */
  #closed = false
  /** Iterator registration belongs to the collector's existing indexed active watcher array. */
  #active: CollectorWatcher[]
  /** Service exposure applies at the one representation boundary owned by iterate. */
  #exposeContent: boolean
  /** Cold stage compilation makes the common filter decision one numeric mask check. */
  #stageMask = (1 << RpcProbeStageName.length) - 1
  /** Existing method ids use direct indexed membership after cold compilation. */
  #methodMask: Uint8Array | undefined
  /** Future method names remain supported when their ids do not yet exist at construction. */
  #methods: ReadonlySet<string> | undefined
  /** Trace matching uses the caller's explicit trace only; no correlation identity is invented. */
  #trace: string | undefined
  /** Endpoint identities can arrive after watch starts, so cold membership retains their names. */
  #endpoints: ReadonlySet<string> | undefined
  /** Only iterator reads allocate a waiting Promise; ingestion resolves its existing notifier. */
  #wake: (() => void) | undefined
  /** One preconstructed callback commits partial batches without per-event closures. */
  #flush: () => void
  /** Unexpected batch failures follow the collector's existing write-time reporting route. */
  #onError: ((error: unknown) => void) | undefined
  /** The collector's original lifetime guard covers handles whose first next follows close. */
  #assertOpen: (() => void) | undefined

  /** Allocate bounded storage and compile filters once, before any watcher joins ingestion. */
  constructor(
    names: NameTable,
    messages: MessageTable,
    input: Omit<IRpcDevtoolsQuery, 'afterSeq' | 'limit'> | undefined,
    exposeContent: boolean,
    active: CollectorWatcher[],
    onError?: (error: unknown) => void,
    assertOpen?: () => void
  ) {
    /** Watch uses the same cold validation domain as query before allocating retained storage. */
    const filter = compileQuery(input, names)
    this.#names = names
    this.#ring = new EventRing(
      (CollectorLimit.batches + 1) * CollectorLimit.batch,
      names,
      messages,
      onError
    )
    this.#exposeContent = exposeContent
    this.#active = active
    this.#onError = onError
    this.#assertOpen = assertOpen
    this.#trace = input?.trace
    this.#stageMask = filter.stages
    if (input?.methods !== undefined) {
      this.#methods = new Set(input.methods)
      this.#methodMask = filter.methods
    }
    if (input?.endpointIds !== undefined) this.#endpoints = new Set(input.endpointIds)
    this.#flush = () => {
      this.#scheduled = false
      if (this.#closed) return
      try {
        this.#commit()
      } catch (failure) {
        reportFailure(failure, this.#onError)
      }
    }
  }

  /** Snapshot qualifying views into columns; no event object, closure or Promise is created. */
  push(view: IRpcProbeEventView, seq: number, content: unknown, bytes: number): void {
    if (this.#closed || (this.#stageMask & (1 << view.stage)) === 0) return
    if (this.#trace !== undefined && view.trace !== this.#trace) return
    if (this.#endpoints !== undefined && !this.#endpoints.has(view.endpointId)) return
    if (this.#methods !== undefined) {
      if (view.method === undefined) return
      /** Existing intern ids take the reduced-dimension path; newly observed names use cold Set. */
      const id = this.#names.find(view.method)
      if (id === undefined || id >= this.#methodMask!.length || this.#methodMask![id] === 0) {
        if (!this.#methods.has(view.method)) return
        if (id !== undefined && id < this.#methodMask!.length) this.#methodMask![id] = 1
      }
    }
    this.#ring.write(view, seq, content, bytes)
    this.#pending++
    if (this.#pending === CollectorLimit.batch) this.#commit()
    else if (!this.#scheduled) {
      this.#scheduled = true
      enqueueBatch(this.#flush)
    }
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
    this.#methodMask?.fill(0)
  }

  /** Activate before the first await; conversion, batching objects and Promises belong here. */
  async *iterate(): AsyncGenerator<IRpcDevtoolsWatchBatch> {
    this.#assertOpen?.()
    this.#active.push(this)
    try {
      while (true) {
        if (this.#closed)
          throw identifyDevtoolsError(new Error(CollectorText.closed), RpcDevtoolsErrorCode.closed)
        if (this.#count === 0) {
          await new Promise<void>((resolve) => {
            this.#wake = resolve
          })
          if (this.#closed)
            throw identifyDevtoolsError(
              new Error(CollectorText.closed),
              RpcDevtoolsErrorCode.closed
            )
          if (this.#count === 0) continue
        }
        /** Result array and its event projections are the watch representation boundary (SC9b). */
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
      /** Unregistration runs at the iterator boundary, outside synchronous event ingestion. */
      const index = this.#active.indexOf(this)
      if (index >= 0) this.#active.splice(index, 1)
      this.#closed = true
      this.clear()
    }
  }
}
