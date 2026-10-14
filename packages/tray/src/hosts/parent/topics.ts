import { createEventHub } from '@migaia/event-subscriber'
import type { IRpcContext } from '@migaia/rpc-core'
import { TrayErrorCode } from '../../error-code.js'
import { createTrayError } from '../../errors.js'
import { TrayInstanceState } from '../constants.js'
import { toWire } from '../portable.js'
import { assertTopic, type ITrayTopicDelivery, type ITrayTopicListener } from '../topics.js'
import type { ITrayRecord, ITrayRegistry } from './registry.js'

/** One parent hub fans out to local users and each authenticated generation membership. */
export function createParentTopics(
  registry: ITrayRegistry,
  deliver: (record: ITrayRecord, delivery: ITrayTopicDelivery) => Promise<void>,
  report: (error: unknown) => void
) {
  /** EventSubscriber owns fan-out and asynchronous callback rejection reporting. */
  const hub = createEventHub<Record<string, ITrayTopicDelivery>>({
    report: ({ error }) => report(error),
    terminalReport: report
  })
  /** Release receipts belong to one admission and native generation, never only an id. */
  const memberships = new Map<ITrayRecord, Map<number, Map<string, () => void>>>()
  /** Authenticate before mutating membership or deriving business publisher metadata. */
  const sender = (context: IRpcContext) => {
    const admitted = registry.instanceIds.get(context.senderId)
    if (
      !admitted ||
      admitted.record.removed ||
      registry.records.get(admitted.record.id) !== admitted.record ||
      admitted.record.generation !== admitted.generation
    )
      throw createTrayError(TrayErrorCode.instanceUnknown)
    return admitted
  }
  /** Payload validation precedes fan-out; absent application payload is omitted on the wire. */
  const message = (
    topic: string,
    payload: unknown,
    meta: ITrayTopicDelivery['meta']
  ): ITrayTopicDelivery => {
    assertTopic(topic)
    const value = toWire(payload)
    return { topic, ...(value === undefined ? {} : { payload: value }), meta }
  }
  return {
    /** Parent business publications never enter the read-only lifecycle channel. */
    publish(topic: string, payload?: unknown): void {
      hub.publish(
        topic,
        message(topic, payload, Object.freeze({ from: Object.freeze({ parent: true as const }) }))
      )
    },
    /** Catch synchronous user failures while returning Promises to the hub's report owner. */
    subscribe(topic: string, listener: ITrayTopicListener): () => void {
      assertTopic(topic)
      return hub.subscribe(topic, ({ value }) => {
        try {
          return listener(value.payload, value.meta)
        } catch (error) {
          report(error)
        }
      })
    },
    /** Only the accepted sender projection supplies the instance publisher's identity. */
    publishChild(input: { topic: string; payload?: unknown }, context: IRpcContext): void {
      const { record, generation } = sender(context)
      const meta = Object.freeze({
        from: Object.freeze({ id: record.id, host: record.definition.name, generation })
      })
      hub.publish(input.topic, message(input.topic, input.payload, meta))
    },
    /** Init-time registration is permitted; delivery remains restricted to ready generations. */
    register(topic: string, context: IRpcContext): void {
      const { record, generation } = sender(context)
      assertTopic(topic)
      let generations = memberships.get(record)
      if (!generations) memberships.set(record, (generations = new Map()))
      let topics = generations.get(generation)
      if (!topics) generations.set(generation, (topics = new Map()))
      if (topics.has(topic)) return
      topics.set(
        topic,
        hub.subscribe(topic, ({ value }) => {
          if (
            record.removed ||
            registry.records.get(record.id) !== record ||
            record.generation !== generation ||
            record.state !== TrayInstanceState.ready
          )
            return
          try {
            return deliver(record, value).catch(report)
          } catch (error) {
            report(error)
          }
        })
      )
    },
    /** A stale sender rejects before it can release another generation's receipt. */
    unregister(topic: string, context: IRpcContext): void {
      const { record, generation } = sender(context)
      assertTopic(topic)
      const generations = memberships.get(record)
      const topics = generations?.get(generation)
      topics?.get(topic)?.()
      topics?.delete(topic)
      if (topics?.size === 0) generations?.delete(generation)
      if (generations?.size === 0) memberships.delete(record)
    },
    /** Raw exit releases synchronously, including departures ignored by lifecycle projections. */
    remove(record: ITrayRecord, generation?: number): void {
      const generations = memberships.get(record)
      if (!generations) return
      if (generation !== undefined) {
        for (const release of generations.get(generation)?.values() ?? []) release()
        generations.delete(generation)
      } else {
        for (const topics of generations.values()) for (const release of topics.values()) release()
        generations.clear()
      }
      if (generations.size === 0) memberships.delete(record)
    },
    /** Parent disposal releases all hub listeners and admission membership references. */
    close(): void {
      memberships.clear()
      hub.clear()
    }
  }
}
