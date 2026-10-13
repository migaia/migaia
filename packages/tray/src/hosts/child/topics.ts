import { createEventHub } from '@migaia/event-subscriber'
import { TrayInternal } from '../constants.js'
import { toWire } from '../portable.js'
import { assertTopic, type ITrayTopicDelivery, type ITrayTopicListener } from '../topics.js'
import type { ITrayRuntimeOutlet } from '../runtime.js'

/** Each child generation owns one local hub and first/last relay membership transitions. */
export function createChildTopics(
  outlet: () => ITrayRuntimeOutlet,
  report: (error: unknown) => void
) {
  /** Local fan-out and asynchronous user rejection reporting stay with EventSubscriber. */
  const hub = createEventHub<Record<string, ITrayTopicDelivery>>({
    report: ({ error }) => report(error),
    terminalReport: report
  })
  /** Concurrent first listeners share registration; a new first listener waits for a prior off. */
  const memberships = new Map<string, Promise<void>>()
  return {
    /** Portable payload admission happens before the request to the parent publisher. */
    async publish(topic: string, payload?: unknown): Promise<void> {
      assertTopic(topic)
      const value = toWire(payload)
      await outlet().request(TrayInternal.connection, TrayInternal.publish, {
        topic,
        ...(value === undefined ? {} : { payload: value })
      })
    },
    /** Failed first registration rolls back each waiting listener and retains the original error. */
    async subscribe(topic: string, listener: ITrayTopicListener): Promise<() => Promise<void>> {
      assertTopic(topic)
      const release = hub.subscribe(topic, ({ value }) => {
        try {
          return listener(value.payload, value.meta)
        } catch (error) {
          report(error)
        }
      })
      let pending = memberships.get(topic)
      if (hub.size(topic) === 1) {
        pending = (async () => {
          if (pending) await pending
          await outlet().request(TrayInternal.connection, TrayInternal.subscribe, { topic })
        })()
        memberships.set(topic, pending)
      }
      try {
        await pending
      } catch (error) {
        release()
        if (hub.size(topic) === 0 && memberships.get(topic) === pending) memberships.delete(topic)
        throw error
      }
      /** One off receipt releases only this listener and shares its last-listener relay Promise. */
      let removed: Promise<void> | undefined
      return () => {
        removed ??= (async () => {
          release()
          if (hub.size(topic) !== 0) return
          const previous = memberships.get(topic)
          const leaving = (async () => {
            await previous
            await outlet().request(TrayInternal.connection, TrayInternal.unsubscribe, { topic })
          })()
          const completion = leaving.finally(() => {
            if (hub.size(topic) === 0 && memberships.get(topic) === completion)
              memberships.delete(topic)
          })
          memberships.set(topic, completion)
          await completion
        })()
        return removed
      }
    },
    /** Deserialization removes freezing, so freeze the authenticated metadata once in this realm. */
    deliver(input: ITrayTopicDelivery): void {
      const meta = Object.freeze({ from: Object.freeze(input.meta.from) })
      hub.publish(input.topic, { ...input, meta })
    },
    /** Generation shutdown releases local callbacks; parent departure owns remote membership. */
    close(): void {
      hub.clear()
      memberships.clear()
    }
  }
}

/** Client and dispatcher share the same generation-local business topic owner. */
export type IChildTopics = ReturnType<typeof createChildTopics>
