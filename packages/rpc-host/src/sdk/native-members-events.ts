/**
 * Owns local native-member subscribers and bounded FIFO event watches. Native owners publish safe
 * lifecycle facts through explicit ports; overflow, callback failures and subscriber cleanup remain
 * separate from native control and business execution.
 */
import { createRpcError } from '../host/error-owner.ts'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { RpcCoreErrorCode, RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { createRemoteLayerError } from '../host/remote-error-owner.ts'
import { RuntimeApiErrorText } from '@migaia/rpc-contract/errors'
import { RpcMemberEventName, RpcMemberQueryLimit } from './native-members-constants.ts'
import { IpcReporterContext } from './reporter-context.ts'
import type { IRpcMemberUnavailable } from './native-members-overview.ts'
/** Lifecycle facts contain only the original identity, time and explicitly safe native fields. */
export type IRpcMemberEvent = Readonly<{
  /** Original ready/exit/degraded/restart/terminal/liquidated lifecycle fact. */
  type: RpcMemberEventName
  /** Safe registered connection name. */
  name: string
  /** Accepted remote instance identity, or explicit unavailable state. */
  instanceId: string | IRpcMemberUnavailable
  /** Original unit generation if observable; it is distinct from accepted provider generation. */
  generation: number | IRpcMemberUnavailable
  /** Original monotonic observation time, or explicit unavailable state. */
  timestamp: number | IRpcMemberUnavailable
  /** Clock label describing the timestamp domain. */
  clock: string
  /** Safe lifecycle reason when the original event supplies one. */
  reason?: string
  /** Native exit code when observed; absence remains explicit. */
  code?: number | IRpcMemberUnavailable
  /** Native exit signal when observed; absence remains explicit. */
  signal?: string | IRpcMemberUnavailable
  /** Safe source/code diagnostic projection; no raw native handle or credentials. */
  error?: Readonly<{ source?: string; code?: string }>
  /** Observed restart count for a restart event. */
  count?: number
  /** Original unit degradation reasons when supplied. */
  degraded?: readonly string[]
}>
/** Subscriptions and watch share one publisher; none is a terminal handler or control owner. */
export type IRpcMemberEventPublisher = Readonly<{
  on(event: RpcMemberEventName, listener: (event: IRpcMemberEvent) => unknown): () => void
  watch(): AsyncIterableIterator<IRpcMemberEvent>
  publish(event: IRpcMemberEvent, report: (error: unknown) => void): void
  close(): void
}>
/** A watch's queued reads settle independently while lifecycle publication never waits for them. */
type IWatchRead = {
  resolve(result: IteratorResult<IRpcMemberEvent>): void
  reject(error: unknown): void
}
/** Exact listener receipts optionally own the bounded-watch overflow check. */
type IRpcMemberEventListener = Readonly<{
  event?: RpcMemberEventName
  invoke(value: IRpcMemberEvent): unknown
  checkOverflow?: (report: (error: unknown) => void) => void
}>

/** Reporter failure cannot replace command completion or leave a callback rejection unobserved. */
function reportEventFailure(report: (error: unknown) => void, error: unknown): void {
  try {
    report(error)
  } catch (failure) {
    hostRethrowReporter(failure, IpcReporterContext)
  }
}

/** Own one bounded local event iterator without owning native facts, connections or execution. */
class RpcMemberEventWatch implements AsyncIterableIterator<IRpcMemberEvent> {
  /** The original publisher alone owns listener membership and its terminal boundary. */
  #publisher: RpcMemberEventPublisher
  /** Unread events are bounded by the existing100-record overflow contract. */
  #queue: IRpcMemberEvent[] = []
  /** Insertion order retains FIFO pending reads without repeated growing-array shifts. */
  #reads = new Set<IWatchRead>()
  /** One terminal transition removes both exact listener and publisher-close receipts. */
  #finished: boolean
  /** A rejected undefined remains distinct from graceful terminal completion. */
  #failed = false
  /** Terminal failure remains visible to every subsequent original next call. */
  #failure: unknown
  /** This exact receipt alone can receive events and run its original overflow policy. */
  #receipt: IRpcMemberEventListener

  /** Capture publisher lifetime before registering this iterator's exact listener receipt. */
  constructor(publisher: RpcMemberEventPublisher) {
    this.#publisher = publisher
    this.#finished = publisher.closed
    this.#receipt = {
      invoke: (event) => this.#receive(event),
      checkOverflow: (report) => this.#checkOverflow(report)
    }
    if (!this.#finished) publisher.addWatch(this.#receipt, this.#close)
  }

  /** The iterator retains its own native async-iteration receiver. */
  [Symbol.asyncIterator](): AsyncIterableIterator<IRpcMemberEvent> {
    return this
  }

  /** Settle one original FIFO read, otherwise retain only an unread bounded local event. */
  #receive(event: IRpcMemberEvent): void {
    if (this.#finished) return
    /** Set insertion order is the same FIFO order as the original pending read array. */
    const read = this.#reads.values().next().value
    if (read) {
      this.#reads.delete(read)
      read.resolve({ done: false, value: event })
    } else this.#queue.push(event)
  }

  /** The actual event reporter observes the same overflow failure after publication. */
  #checkOverflow(report: (error: unknown) => void): void {
    if (this.#queue.length <= RpcMemberQueryLimit.recent || this.#finished) return
    /** This is the original prescribed watch overflow error, not a native terminal state. */
    const error = createRemoteLayerError(RpcRemoteLayerErrorCode.runtimeEventOverflow)
    this.#finish(true, error)
    reportEventFailure(report, error)
  }

  /** Retire membership and clear ownership before settling the original pending reads. */
  #finish(reject: boolean, error?: unknown): void {
    if (this.#finished) return
    this.#finished = true
    this.#failed = reject
    this.#failure = error
    this.#publisher.removeWatch(this.#receipt, this.#close)
    this.#queue.length = 0
    /** Snapshot/clear retains original settlement order and reentrant terminal behavior. */
    const reads = [...this.#reads]
    this.#reads.clear()
    for (const read of reads)
      if (!reject) read.resolve({ done: true, value: undefined })
      else read.reject(error)
  }

  /** Owner close and explicit return join the same graceful iterator termination. */
  #close = (): void => this.#finish(false)

  /** Read one bounded buffered event or join the existing FIFO pending-read owner. */
  next = (): Promise<IteratorResult<IRpcMemberEvent>> => {
    if (this.#failed) return Promise.reject(this.#failure)
    if (this.#finished) return Promise.resolve({ done: true as const, value: undefined })
    /** The event queue has the existing fixed RpcMemberQueryLimit.recent bound. */
    const value = this.#queue.shift()
    if (value) return Promise.resolve({ done: false as const, value })
    return new Promise<IteratorResult<IRpcMemberEvent>>((resolve, reject) =>
      this.#reads.add({ resolve, reject })
    )
  }

  /** Explicit return preserves the original graceful terminal result. */
  return = (): Promise<IteratorResult<IRpcMemberEvent>> => {
    this.#finish(false)
    return Promise.resolve({ done: true as const, value: undefined })
  }

  /** A thrown undefined still rejects and stays visible to later reads. */
  throw = (error: unknown): Promise<IteratorResult<IRpcMemberEvent>> => {
    this.#finish(true, error)
    return Promise.reject(error)
  }
}

/** Own only local lifecycle subscribers and bounded watches, never native connection state. */
class RpcMemberEventPublisher {
  /** Each listener is an exact receipt snapshotted before publication invokes callbacks. */
  #listeners = new Set<IRpcMemberEventListener>()
  /** Publisher close settles every original watch without requiring a later native event. */
  #watchers = new Set<() => void>()
  /** This boundary belongs to subscriber lifetime rather than native execution lifecycle. */
  #closed = false

  /** A watch snapshots the original publisher terminal boundary before subscription. */
  get closed(): boolean {
    return this.#closed
  }

  /** Register only this exact watch's listener and publisher-close receipts. */
  addWatch(receipt: IRpcMemberEventListener, close: () => void): void {
    this.#listeners.add(receipt)
    this.#watchers.add(close)
  }

  /** One watch terminal transition releases both original membership receipts. */
  removeWatch(receipt: IRpcMemberEventListener, close: () => void): void {
    this.#listeners.delete(receipt)
    this.#watchers.delete(close)
  }

  /** Capture one exact callback receipt; later additions cannot enter an in-progress publication. */
  #on = (
    event: RpcMemberEventName,
    listener: (event: IRpcMemberEvent) => unknown
  ): (() => void) => {
    if (!Object.values(RpcMemberEventName).includes(event) || typeof listener !== 'function')
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.eventInvalid)
    if (this.#closed) return () => undefined
    /** Each registration retains its callback on an independent removal receipt. */
    const receipt = { event, invoke: listener }
    this.#listeners.add(receipt)
    return () => {
      this.#listeners.delete(receipt)
    }
  }

  /** Publish native facts synchronously while observing every original callback rejection. */
  #publish(event: IRpcMemberEvent, report: (error: unknown) => void): void {
    if (this.#closed) return
    for (const receipt of Array.from(this.#listeners)) {
      if (receipt.event !== undefined && receipt.event !== event.type) continue
      try {
        /** User subscribers receive no private receipt as their receiver. */
        const result = (0, receipt.invoke)(event)
        observeThenableRejection(result, inspectThenable(result), (error) =>
          reportEventFailure(report, error)
        )
        receipt.checkOverflow?.(report)
      } catch (error) {
        reportEventFailure(report, error)
      }
    }
  }

  /** Terminate watches before clearing callback membership; repeat close remains inert. */
  #close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const close of Array.from(this.#watchers)) close()
    this.#listeners.clear()
  }

  /** Retain the original frozen own-property callback surface, with unbound on/watch consumers. */
  surface(): IRpcMemberEventPublisher {
    return Object.freeze({
      on: this.#on,
      watch: () => new RpcMemberEventWatch(this),
      publish: (event, report) => this.#publish(event, report),
      close: () => this.#close()
    })
  }
}

/** Create the existing local subscriber owner with its original bounded event-buffer policy. */
export function createRpcMemberEventPublisher(): IRpcMemberEventPublisher {
  return new RpcMemberEventPublisher().surface()
}
