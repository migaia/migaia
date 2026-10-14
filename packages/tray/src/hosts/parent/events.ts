import type { IAbortSignal } from '@migaia/utils/promise'
import { createEventHub } from '@migaia/event-subscriber'
import { TrayInstanceEvent } from '../constants.js'
import type { ITrayInstanceEventRecord, ITrayInstanceEventRecord as IRecord } from '../typing.js'
/** Lifecycle publisher remains private; the facade exposes only on/watch operations. */
export function createTrayEvents(report: (error: unknown) => void) {
  /** EventSubscriber owns listener snapshots, throwing-listener reporting and release receipts. */
  const hub = createEventHub<Record<string, IRecord>>({
    report: ({ error }) => report(error),
    terminalReport: report
  })
  /** Watches own only their bounded unread observation queue and pending reads. */
  const watches = new Set<() => void>()
  /** Closed observation channels settle watches without waiting for another lifecycle event. */
  let closed = false
  return {
    /** Freeze before first listener so subsequent listeners and watches observe the same record. */
    publish(event: IRecord): void {
      if (closed) return
      try {
        hub.publish(event.event, Object.freeze(event))
      } catch (error) {
        report(error)
      }
    },
    on(event: TrayInstanceEvent, listener: (event: IRecord) => void): () => void {
      return hub.subscribe(event, (value) => listener(value.value))
    },
    watch(options?: { signal?: IAbortSignal }): AsyncIterableIterator<ITrayInstanceEventRecord> {
      /** The view retains the latest 100 unread observations; it is not a durable event journal. */
      const queue: IRecord[] = []
      /** Each waiting caller receives the next event in arrival order. */
      const pending: ((value: IteratorResult<IRecord>) => void)[] = []
      /** Receipts release the existing hub listeners on return, abort or owner close. */
      const releases: (() => void)[] = []
      /** Watch termination is local iterator state, not a native lifecycle state. */
      let finished = closed
      /** Settle every pending read and release only this watch's subscriptions. */
      const finish = (): void => {
        if (finished) return
        finished = true
        for (const release of releases) release()
        options?.signal?.removeEventListener('abort', finish)
        watches.delete(finish)
        queue.length = 0
        for (const resolve of pending.splice(0)) resolve({ done: true, value: undefined })
      }
      if (!closed && !options?.signal?.aborted) {
        for (const name of Object.values(TrayInstanceEvent))
          releases.push(
            hub.subscribe(name, (context) => {
              const read = pending.shift()
              if (read) read({ done: false, value: context.value })
              else {
                if (queue.length === 100) queue.shift()
                queue.push(context.value)
              }
            })
          )
        watches.add(finish)
        options?.signal?.addEventListener('abort', finish, { once: true })
      } else finished = true
      return {
        [Symbol.asyncIterator]() {
          return this
        },
        next() {
          if (finished) return Promise.resolve({ done: true, value: undefined })
          const value = queue.shift()
          return value
            ? Promise.resolve({ done: false, value })
            : new Promise((resolve) => pending.push(resolve))
        },
        return() {
          finish()
          return Promise.resolve({ done: true, value: undefined })
        },
        throw(error: unknown) {
          finish()
          return Promise.reject(error)
        }
      }
    },
    close(): void {
      if (closed) return
      for (const finish of watches) finish()
      closed = true
      hub.clear()
    }
  }
}
