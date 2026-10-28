/** Own lifecycle observation subscriptions and bounded watches; EventSubscriber owns fan-out. */
import type { IAbortSignal } from '@migaia/utils/promise'
import { createEventHub } from '@migaia/event-subscriber'
import { TrayInstanceEvent } from '../constants.ts'
import type { ITrayInstanceEventRecord, ITrayInstanceEventRecord as IRecord } from '../typing.ts'

/** Public watch contract retains exactly the latest 100 unread lifecycle records. */
const eventWatchCapacity = 100

/** Lifecycle publisher stays private; facade users borrow only observation operations. */
export function createTrayEvents(report: (error: unknown) => void) {
  return new TrayEvents(report)
}

/** One lifecycle observation owner contains listeners and all live watch iterators. */
class TrayEvents {
  /** EventSubscriber retains listener snapshot, rejection and unsubscribe semantics. */
  readonly #hub: ReturnType<typeof createEventHub<Record<string, IRecord>>>
  /** Each watch supplies its own idempotent termination receipt. */
  readonly #watches = new Set<() => void>()
  /** Closed observation channels settle pending reads without another lifecycle event. */
  #closed = false
  /** Original report observer contains synchronous publisher failures. */
  readonly #report: (error: unknown) => void

  /** Capture one original event hub and its error-reporting boundary. */
  constructor(report: (error: unknown) => void) {
    this.#report = report
    this.#hub = createEventHub<Record<string, IRecord>>({
      report: ({ error }) => report(error),
      terminalReport: report
    })
  }
  /** Freeze before first listener so all listeners and watches observe the same record. */
  publish = (event: IRecord): void => {
    if (this.#closed) return
    try {
      this.#hub.publish(event.event, Object.freeze(event))
    } catch (error) {
      this.#report(error)
    }
  }
  /** Preserve the original contained listener subscription and exact release receipt. */
  on = (event: TrayInstanceEvent, listener: (event: IRecord) => void): (() => void) =>
    this.#hub.subscribe(event, (value) => listener(value.value))
  /** Each call owns its bounded unread observations and independent pending reads. */
  watch = (options?: { signal?: IAbortSignal }): AsyncIterableIterator<ITrayInstanceEventRecord> =>
    new TrayEventWatch(this.#hub, this.#watches, this.#closed, options?.signal)
  /** Terminate every current watch before releasing the original hub. */
  close = (): void => {
    if (this.#closed) return
    for (const finish of this.#watches) finish()
    this.#closed = true
    this.#hub.clear()
  }
}

/** One watch owns iterator-local state, never native lifecycle or durable event history. */
class TrayEventWatch implements AsyncIterableIterator<IRecord> {
  /** Fixed ring retains the latest 100 unread observations without copying or shifting records. */
  readonly #queue: (IRecord | undefined)[] = []
  /** Oldest unread ring slot is advanced only after read or oldest-record eviction. */
  #head = 0
  /** Number of retained observations never exceeds eventWatchCapacity from the public contract. */
  #size = 0
  /** Concurrent next callers are correlated without shifting a growing pending array. */
  readonly #pending = new Map<number, (value: IteratorResult<IRecord>) => void>()
  /** Monotonic issuance identifies each pending read until it settles. */
  #issued = 0
  /** Next pending reply preserves the original FIFO iterator semantics. */
  #received = 0
  /** Releases belong only to this watch's original EventSubscriber subscriptions. */
  readonly #releases: (() => void)[] = []
  /** Original signal owns only this watch's cancellation observation. */
  readonly #signal: IAbortSignal | undefined
  /** Parent inventory retains only still-live watch termination receipts. */
  readonly #watches: Set<() => void>
  /** A finished iterator never accepts more observations or pending reads. */
  #finished: boolean

  /** Subscribe to the fixed lifecycle event domain, or start already finished after close/abort. */
  constructor(
    hub: ReturnType<typeof createEventHub<Record<string, IRecord>>>,
    watches: Set<() => void>,
    closed: boolean,
    signal?: IAbortSignal
  ) {
    this.#watches = watches
    this.#signal = signal
    this.#finished = closed
    if (!closed && !signal?.aborted) {
      // TrayInstanceEvent declares exactly six lifecycle names; subscription setup has that fixed bound.
      for (const name of Object.values(TrayInstanceEvent))
        this.#releases.push(hub.subscribe(name, (context) => this.#accept(context.value)))
      watches.add(this.#finish)
      signal?.addEventListener('abort', this.#finish, { once: true })
    } else this.#finished = true
  }
  /** Deliver one observation to the first waiter, or retain it within the fixed 100-record budget. */
  #accept(value: IRecord): void {
    /** The next issued waiter always receives its record before any bounded history is retained. */
    const read = this.#pending.get(this.#received)
    if (read) {
      this.#pending.delete(this.#received++)
      read({ done: false, value })
    } else {
      if (this.#size === eventWatchCapacity) {
        this.#queue[this.#head] = value
        this.#head = (this.#head + 1) % eventWatchCapacity
      } else {
        this.#queue[(this.#head + this.#size) % eventWatchCapacity] = value
        this.#size += 1
      }
    }
  }
  /** Release this watch once and settle every pending read as complete. */
  #finish = (): void => {
    if (this.#finished) return
    this.#finished = true
    for (const release of this.#releases) release()
    this.#signal?.removeEventListener('abort', this.#finish)
    this.#watches.delete(this.#finish)
    this.#queue.length = 0
    this.#head = 0
    this.#size = 0
    for (const resolve of this.#pending.values()) resolve({ done: true, value: undefined })
    this.#pending.clear()
  };
  /** Iterator identity remains stable for the lifetime of this watch. */
  [Symbol.asyncIterator](): AsyncIterableIterator<IRecord> {
    return this
  }
  /** Return the oldest unread observation or await one original lifecycle event. */
  next(): Promise<IteratorResult<IRecord>> {
    if (this.#finished) return Promise.resolve({ done: true, value: undefined })
    /** Read and clear one original ring slot so consumed records are not retained by the watch. */
    const value = this.#queue[this.#head]
    if (this.#size !== 0) {
      this.#queue[this.#head] = undefined
      this.#head = (this.#head + 1) % eventWatchCapacity
      this.#size -= 1
    }
    return value
      ? Promise.resolve({ done: false, value })
      : new Promise((resolve) => this.#pending.set(this.#issued++, resolve))
  }
  /** Caller return releases only this watch and completes every queued read. */
  return(): Promise<IteratorResult<IRecord>> {
    this.#finish()
    return Promise.resolve({ done: true, value: undefined })
  }
  /** Caller throw releases the watch while preserving the supplied rejection identity. */
  throw(error: unknown): Promise<IteratorResult<IRecord>> {
    this.#finish()
    return Promise.reject(error)
  }
}
