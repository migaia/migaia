import { createRpcError } from '../../core/errors.js'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { RpcCoreErrorCode } from '../../core/errors.js'
import { createRemoteLayerError } from '../error.js'
import { RpcRemoteLayerErrorCode } from '../error-code.js'
import {
  RuntimeEventName,
  RuntimeQueryLimit,
  RuntimeApiErrorText,
  RuntimeQueryClock,
  RuntimeQueryReason
} from './constants.js'
import { runtimeUnavailable, runtimeErrorIdentity, type IRuntimeUnavailable } from './overview.js'
import { readRuntimePeerConnection, type IRuntimePeer } from './peer.js'
import type { IRemoteRuntimeRegistration } from '../proxy.js'
import { readInstalledProbe, type IProbeEmitter } from '../../core/internal/probe-emitter.js'
import { RpcProbeStage } from '../../core/probe/constants.js'
/** Endpoint-owned lifecycle observations use these stable names beside native RuntimeEventName. */
export const RuntimeProbeLifecycle = {
  handshake: 'handshake',
  directory: 'directory',
  closing: 'closing'
} as const

/** Event shape comes from the original supervisor, without another native-state definition. */
type IRuntimeSupervisorEvent = Parameters<
  Parameters<IRemoteRuntimeRegistration['supervisor']['subscribe']>[0]
>[0]

/** Project genuine accepted readiness for standalone Peers and committed Host publication alike. */
export function runtimeReadyEvent(
  name: string,
  peer: IRuntimePeer,
  generation?: number
): IRuntimeEvent {
  /** The private connection reader admits only the original constructed Peer. */
  const accepted = readRuntimePeerConnection(peer)
  /** Registration publishes this fact only after its actual current-generation pointer commits. */
  const probe = readInstalledProbe(accepted.channel.transport)
  if (probe && (probe.mask & (1 << RpcProbeStage.peer)) !== 0)
    probe.peer(RuntimeEventName.ready, accepted.peerId, undefined)
  return Object.freeze({
    type: RuntimeEventName.ready,
    name,
    instanceId: accepted.peerId,
    generation: generation ?? runtimeUnavailable(RuntimeQueryReason.owner),
    timestamp: accepted.channel.scheduler.now(),
    clock: RuntimeQueryClock.scheduler
  })
}

/** Project actual native observations through one canonical event mapping, never local error codes. */
export function runtimeSupervisorEvent(
  name: string,
  registration: IRemoteRuntimeRegistration,
  event: IRuntimeSupervisorEvent,
  report: (error: unknown) => void
): IRuntimeEvent | undefined {
  if (
    event.type !== RuntimeEventName.exit &&
    event.type !== RuntimeEventName.restart &&
    event.type !== RuntimeEventName.degraded &&
    event.type !== RuntimeEventName.terminal
  )
    return undefined
  /** Terminal has no event generation; the original supervisor exposes its last launch attempt. */
  const generation =
    event.type === RuntimeEventName.terminal ? registration.supervisor.generation : event.generation
  return Object.freeze({
    type: event.type,
    name,
    generation: generation || runtimeUnavailable(RuntimeQueryReason.owner),
    instanceId: registration.runtimeInstanceId(generation),
    timestamp:
      event.type === RuntimeEventName.terminal
        ? runtimeUnavailable(RuntimeQueryReason.owner)
        : (event.observedAt ?? runtimeUnavailable(RuntimeQueryReason.owner)),
    clock: RuntimeQueryClock.scheduler,
    ...(event.type === RuntimeEventName.exit
      ? {
          reason: event.reason,
          code: event.status?.code ?? runtimeUnavailable(RuntimeQueryReason.native),
          signal: event.status?.signal ?? runtimeUnavailable(RuntimeQueryReason.native),
          ...(event.error === undefined ? {} : { error: runtimeErrorIdentity(event.error, report) })
        }
      : event.type === RuntimeEventName.terminal
        ? { error: runtimeErrorIdentity(event.error, report) }
        : event.type === RuntimeEventName.restart
          ? { count: event.count }
          : {
              degraded: Object.freeze([...event.degraded])
            })
  })
}

/** Lifecycle facts contain only the original identity, time and explicitly safe native fields. */
export type IRuntimeEvent = Readonly<{
  /** Original ready/exit/degraded/restart/terminal/liquidated lifecycle fact. */
  type: RuntimeEventName
  /** Safe registered connection name. */
  name: string
  /** Accepted remote instance identity, or explicit unavailable state. */
  instanceId: string | IRuntimeUnavailable
  /** Original unit generation if observable; it is distinct from accepted provider generation. */
  generation: number | IRuntimeUnavailable
  /** Original monotonic observation time, or explicit unavailable state. */
  timestamp: number | IRuntimeUnavailable
  /** Clock label describing the timestamp domain. */
  clock: string
  /** Safe lifecycle reason when the original event supplies one. */
  reason?: string
  /** Native exit code when observed; absence remains explicit. */
  code?: number | IRuntimeUnavailable
  /** Native exit signal when observed; absence remains explicit. */
  signal?: string | IRuntimeUnavailable
  /** Safe source/code diagnostic projection; no raw native handle or credentials. */
  error?: Readonly<{ source?: string; code?: string }>
  /** Observed restart count for a restart event. */
  count?: number
  /** Original unit degradation reasons when supplied. */
  degraded?: readonly string[]
}>
/** Subscriptions and watch share one publisher; none is a terminal handler or control owner. */
export type IRuntimeEventPublisher = Readonly<{
  on(event: RuntimeEventName, listener: (event: IRuntimeEvent) => unknown): () => void
  watch(): AsyncIterableIterator<IRuntimeEvent>
  publish(event: IRuntimeEvent, report: (error: unknown) => void): void
  close(): void
}>
/** A watch's queued reads settle independently while lifecycle publication never waits for them. */
type IWatchRead = {
  resolve(result: IteratorResult<IRuntimeEvent>): void
  reject(error: unknown): void
}
/** Exact listener receipts optionally own the bounded-watch overflow check. */
type IRuntimeEventListener = Readonly<{
  event?: RuntimeEventName
  invoke(value: IRuntimeEvent): unknown
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
class RuntimeEventWatch implements AsyncIterableIterator<IRuntimeEvent> {
  /** The original publisher alone owns listener membership and its terminal boundary. */
  #publisher: RuntimeEventPublisher
  /** Unread events are bounded by the existing100-record overflow contract. */
  #queue: IRuntimeEvent[] = []
  /** Insertion order retains FIFO pending reads without repeated growing-array shifts. */
  #reads = new Set<IWatchRead>()
  /** One terminal transition removes both exact listener and publisher-close receipts. */
  #finished: boolean
  /** A rejected undefined remains distinct from graceful terminal completion. */
  #failed = false
  /** Terminal failure remains visible to every subsequent original next call. */
  #failure: unknown
  /** This exact receipt alone can receive events and run its original overflow policy. */
  #receipt: IRuntimeEventListener

  /** Capture publisher lifetime before registering this iterator's exact listener receipt. */
  constructor(publisher: RuntimeEventPublisher) {
    this.#publisher = publisher
    this.#finished = publisher.closed
    this.#receipt = {
      invoke: (event) => this.#receive(event),
      checkOverflow: (report) => this.#checkOverflow(report)
    }
    if (!this.#finished) publisher.addWatch(this.#receipt, this.#close)
  }

  /** The iterator retains its own native async-iteration receiver. */
  [Symbol.asyncIterator](): AsyncIterableIterator<IRuntimeEvent> {
    return this
  }

  /** Settle one original FIFO read, otherwise retain only an unread bounded local event. */
  #receive(event: IRuntimeEvent): void {
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
    if (this.#queue.length <= RuntimeQueryLimit.recent || this.#finished) return
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
  next = (): Promise<IteratorResult<IRuntimeEvent>> => {
    if (this.#failed) return Promise.reject(this.#failure)
    if (this.#finished) return Promise.resolve({ done: true as const, value: undefined })
    /** The event queue has the existing fixed RuntimeQueryLimit.recent bound. */
    const value = this.#queue.shift()
    if (value) return Promise.resolve({ done: false as const, value })
    return new Promise<IteratorResult<IRuntimeEvent>>((resolve, reject) =>
      this.#reads.add({ resolve, reject })
    )
  }

  /** Explicit return preserves the original graceful terminal result. */
  return = (): Promise<IteratorResult<IRuntimeEvent>> => {
    this.#finish(false)
    return Promise.resolve({ done: true as const, value: undefined })
  }

  /** A thrown undefined still rejects and stays visible to later reads. */
  throw = (error: unknown): Promise<IteratorResult<IRuntimeEvent>> => {
    this.#finish(true, error)
    return Promise.reject(error)
  }
}

/** Own only local lifecycle subscribers and bounded watches, never native connection state. */
class RuntimeEventPublisher {
  /** Each listener is an exact receipt snapshotted before publication invokes callbacks. */
  #listeners = new Set<IRuntimeEventListener>()
  /** Publisher close settles every original watch without requiring a later native event. */
  #watchers = new Set<() => void>()
  /** This boundary belongs to subscriber lifetime rather than native execution lifecycle. */
  #closed = false
  /** Host bootstrap may select its actual emitter after subscribers have already joined. */
  #probe: IProbeEmitter | (() => IProbeEmitter | undefined) | undefined

  /** Capture the existing probe or cold reader without acquiring a runtime observer. */
  constructor(probe?: IProbeEmitter | (() => IProbeEmitter | undefined)) {
    this.#probe = probe
  }

  /** A watch snapshots the original publisher terminal boundary before subscription. */
  get closed(): boolean {
    return this.#closed
  }

  /** Register only this exact watch's listener and publisher-close receipts. */
  addWatch(receipt: IRuntimeEventListener, close: () => void): void {
    this.#listeners.add(receipt)
    this.#watchers.add(close)
  }

  /** One watch terminal transition releases both original membership receipts. */
  removeWatch(receipt: IRuntimeEventListener, close: () => void): void {
    this.#listeners.delete(receipt)
    this.#watchers.delete(close)
  }

  /** Capture one exact callback receipt; later additions cannot enter an in-progress publication. */
  #on = (event: RuntimeEventName, listener: (event: IRuntimeEvent) => unknown): (() => void) => {
    if (!Object.values(RuntimeEventName).includes(event) || typeof listener !== 'function')
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.eventInvalid)
    if (this.#closed) return () => undefined
    /** The original callback remains on its exact receipt, including its invocation receiver. */
    const receipt = { event, invoke: listener }
    this.#listeners.add(receipt)
    return () => {
      this.#listeners.delete(receipt)
    }
  }

  /** Publish native facts synchronously while observing every original callback rejection. */
  #publish(event: IRuntimeEvent, report: (error: unknown) => void): void {
    if (this.#closed) return
    /** Cold lookup retains its original bare receiver and yields only the actual installed emitter. */
    const observer = typeof this.#probe === 'function' ? (0, this.#probe)() : this.#probe
    if (observer && (observer.mask & (1 << RpcProbeStage.peer)) !== 0)
      observer.peer(
        event.type,
        typeof event.instanceId === 'string' ? event.instanceId : undefined,
        event.error
      )
    for (const receipt of Array.from(this.#listeners)) {
      if (receipt.event !== undefined && receipt.event !== event.type) continue
      try {
        /** Invocation preserves the original exact callback receipt receiver. */
        const result = receipt.invoke(event)
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
  surface(): IRuntimeEventPublisher {
    return Object.freeze({
      on: this.#on,
      watch: () => new RuntimeEventWatch(this),
      publish: (event, report) => this.#publish(event, report),
      close: () => this.#close()
    })
  }
}

/** Create the existing local subscriber owner with its original bounded event-buffer policy. */
export function createRuntimeEventPublisher(
  probe?: IProbeEmitter | (() => IProbeEmitter | undefined)
): IRuntimeEventPublisher {
  return new RuntimeEventPublisher(probe).surface()
}
