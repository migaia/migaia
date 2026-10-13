import { createRpcError } from '../../core/errors.js'
import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { RpcCoreErrorCode } from '../../core/index.js'
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
    event.type !== RuntimeEventName.degraded
  )
    return undefined
  return Object.freeze({
    type: event.type,
    name,
    generation: event.generation,
    instanceId: registration.runtimeInstanceId(event.generation),
    timestamp: event.observedAt ?? runtimeUnavailable(RuntimeQueryReason.owner),
    clock: RuntimeQueryClock.scheduler,
    ...(event.type === RuntimeEventName.exit
      ? {
          reason: event.reason,
          code: event.status?.code ?? runtimeUnavailable(RuntimeQueryReason.native),
          signal: event.status?.signal ?? runtimeUnavailable(RuntimeQueryReason.native),
          ...(event.error === undefined ? {} : { error: runtimeErrorIdentity(event.error, report) })
        }
      : event.type === RuntimeEventName.restart
        ? { count: event.count }
        : {
            degraded: Object.freeze([...event.degraded])
          })
  })
}

/** Lifecycle facts contain only the original identity, time and explicitly safe native fields. */
export type IRuntimeEvent = Readonly<{
  type: RuntimeEventName
  name: string
  instanceId: string | IRuntimeUnavailable
  generation: number | IRuntimeUnavailable
  timestamp: number | IRuntimeUnavailable
  clock: string
  reason?: string
  code?: number | IRuntimeUnavailable
  signal?: string | IRuntimeUnavailable
  error?: Readonly<{ source?: string; code?: string }>
  count?: number
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

/** Create only the local lifecycle subscriber adapter, with the prescribed bounded event buffer. */
export function createRuntimeEventPublisher(probe?: IProbeEmitter): IRuntimeEventPublisher {
  /**
   * Each subscription is an exact receipt; publication snapshots this Set before invoking
   * callbacks.
   */
  const listeners = new Set<IRuntimeEventListener>()
  /** Owner close settles every watch without depending on a later native event. */
  const watchers = new Set<() => void>()
  /** This flag belongs only to publisher lifetime, not connection or native lifecycle state. */
  let closed = false
  /**
   * Reporter failure cannot replace native command completion or leave unhandled callback
   * rejection.
   */
  const reportSafely = (report: (error: unknown) => void, error: unknown): void => {
    try {
      report(error)
    } catch (failure) {
      hostRethrowReporter(failure, IpcReporterContext)
    }
  }
  return Object.freeze({
    on(event, listener) {
      if (!Object.values(RuntimeEventName).includes(event) || typeof listener !== 'function')
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.eventInvalid)
      if (closed) return () => undefined
      const receipt = { event, invoke: listener }
      listeners.add(receipt)
      return () => {
        listeners.delete(receipt)
      }
    },
    watch() {
      /**
       * Only unread events occupy this local 100-record queue; no native facts are retained
       * elsewhere.
       */
      const queue: IRuntimeEvent[] = []
      /** Pending caller reads preserve FIFO and all settle when this watch terminates. */
      const reads: IWatchRead[] = []
      /** One terminal transition removes both exact subscriber and owner-close receipt. */
      let finished = closed
      /** Overflow remains visible to subsequent next(), without silently dropping the old queue. */
      let failure: unknown
      /** A thrown undefined still rejects; absence of a failure value cannot represent closure. */
      let failed = false
      const finish = (reject: boolean, error?: unknown): void => {
        if (finished) return
        finished = true
        failed = reject
        failure = error
        listeners.delete(receipt)
        watchers.delete(closeWatch)
        queue.length = 0
        for (const read of reads.splice(0))
          if (!reject) read.resolve({ done: true, value: undefined })
          else read.reject(error)
      }
      const closeWatch = (): void => finish(false)
      const receipt: IRuntimeEventListener = {
        invoke(event: IRuntimeEvent): void {
          if (finished) return
          const read = reads.shift()
          if (read) read.resolve({ done: false, value: event })
          else queue.push(event)
        },
        /** The publication owner supplies the actual reporter for an overflowing event. */
        checkOverflow(report): void {
          if (queue.length <= RuntimeQueryLimit.recent || finished) return
          const error = createRemoteLayerError(RpcRemoteLayerErrorCode.runtimeEventOverflow)
          finish(true, error)
          reportSafely(report, error)
        }
      }
      if (!closed) {
        listeners.add(receipt)
        watchers.add(closeWatch)
      }
      return {
        [Symbol.asyncIterator]() {
          return this
        },
        next() {
          if (failed) return Promise.reject(failure)
          if (finished) return Promise.resolve({ done: true as const, value: undefined })
          const value = queue.shift()
          if (value) return Promise.resolve({ done: false as const, value })
          return new Promise<IteratorResult<IRuntimeEvent>>((resolve, reject) =>
            reads.push({ resolve, reject })
          )
        },
        return() {
          finish(false)
          return Promise.resolve({ done: true as const, value: undefined })
        },
        throw(error: unknown) {
          finish(true, error)
          return Promise.reject(error)
        }
      }
    },
    publish(event, report) {
      if (closed) return
      if (probe && (probe.mask & (1 << RpcProbeStage.peer)) !== 0)
        probe.peer(
          event.type,
          typeof event.instanceId === 'string' ? event.instanceId : undefined,
          event.error
        )
      for (const receipt of Array.from(listeners)) {
        if (receipt.event !== undefined && receipt.event !== event.type) continue
        try {
          const result = receipt.invoke(event)
          observeThenableRejection(result, inspectThenable(result), (error) =>
            reportSafely(report, error)
          )
          receipt.checkOverflow?.(report)
        } catch (error) {
          reportSafely(report, error)
        }
      }
    },
    close() {
      if (closed) return
      closed = true
      for (const close of Array.from(watchers)) close()
      listeners.clear()
    }
  })
}
