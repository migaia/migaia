import { inspectThenable, observeThenableRejection } from '@migaia/utils/function'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { RpcCoreErrorCode, RpcError } from '../../core/errors.js'
import { createRemoteLayerError } from '../error.js'
import { RpcRemoteLayerErrorCode } from '../error-code.js'
import { RuntimeEventName, RuntimeQueryLimit, RuntimeApiErrorText } from './constants.js'
import type { IRuntimeUnavailable } from './overview.js'

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
export function createRuntimeEventPublisher(): IRuntimeEventPublisher {
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
        throw new RpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.eventInvalid)
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
