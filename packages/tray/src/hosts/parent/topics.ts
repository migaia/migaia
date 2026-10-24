import { createEventHub } from '@migaia/event-subscriber'
import type { IRpcContext } from '@migaia/rpc-host'
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
  return new ParentTopics(registry, deliver, report)
}
/** Owns only parent topic membership; EventSubscriber retains fan-out and listener lifecycle. */
class ParentTopics {
  /** Registry remains the sole authenticated sender admission owner. */
  readonly #registry: ITrayRegistry
  /** Original generation delivery uses the canonical native outlet. */
  readonly #deliver: (record: ITrayRecord, delivery: ITrayTopicDelivery) => Promise<void>
  /** Original reporter contains user and native delivery failures. */
  readonly #report: (error: unknown) => void
  /** EventSubscriber remains the only topic fan-out owner. */
  readonly #hub: ReturnType<typeof createEventHub<Record<string, ITrayTopicDelivery>>>
  /** Each original release receipt belongs to one admission, generation and topic. */
  readonly #memberships = new Map<ITrayRecord, Map<number, Map<string, () => void>>>()
  /** Borrow registry admission and native delivery without taking their lifecycle ownership. */
  constructor(
    registry: ITrayRegistry,
    deliver: (record: ITrayRecord, delivery: ITrayTopicDelivery) => Promise<void>,
    report: (error: unknown) => void
  ) {
    this.#registry = registry
    this.#deliver = deliver
    this.#report = report
    this.#hub = createEventHub<Record<string, ITrayTopicDelivery>>({
      report: ({ error }) => this.#report(error),
      terminalReport: this.#report
    })
  }

  /** Publish parent business messages separately from read-only lifecycle observations. */
  publish = (topic: string, payload?: unknown): void => {
    this.#hub.publish(
      topic,
      this.#message(
        topic,
        payload,
        Object.freeze({ from: Object.freeze({ parent: true as const }) })
      )
    )
  }
  /** Contain synchronous listener throws while EventSubscriber owns Promise rejection reports. */
  subscribe = (topic: string, listener: ITrayTopicListener): (() => void) => {
    assertTopic(topic)
    return this.#hub.subscribe(topic, ({ value }) => {
      try {
        return listener(value.payload, value.meta)
      } catch (error) {
        this.#report(error)
      }
    })
  }
  /** Derive publisher identity only from the current authenticated sender admission. */
  publishChild = (input: { topic: string; payload?: unknown }, context: IRpcContext): void => {
    const { record, generation } = this.#sender(context)
    const meta = Object.freeze({
      from: Object.freeze({ id: record.id, host: record.definition.name, generation })
    })
    this.#hub.publish(input.topic, this.#message(input.topic, input.payload, meta))
  }
  /** Retain one real fan-out subscription per admission, generation and topic. */
  register = (topic: string, context: IRpcContext): void => {
    const { record, generation } = this.#sender(context)
    assertTopic(topic)
    let generations = this.#memberships.get(record)
    if (!generations) this.#memberships.set(record, (generations = new Map()))
    let topics = generations.get(generation)
    if (!topics) generations.set(generation, (topics = new Map()))
    if (topics.has(topic)) return
    topics.set(
      topic,
      this.#hub.subscribe(topic, ({ value }) => {
        if (
          record.removed ||
          this.#registry.records.get(record.id) !== record ||
          record.generation !== generation ||
          record.state !== TrayInstanceState.ready
        )
          return
        try {
          return this.#deliver(record, value).catch(this.#report)
        } catch (error) {
          this.#report(error)
        }
      })
    )
  }
  /** Reject stale senders before releasing the exact generation membership receipt. */
  unregister = (topic: string, context: IRpcContext): void => {
    const { record, generation } = this.#sender(context)
    assertTopic(topic)
    const generations = this.#memberships.get(record)
    const topics = generations?.get(generation)
    topics?.get(topic)?.()
    topics?.delete(topic)
    if (topics?.size === 0) generations?.delete(generation)
    if (generations?.size === 0) this.#memberships.delete(record)
  }
  /** Release departed generation memberships synchronously before native cleanup. */
  remove = (record: ITrayRecord, generation?: number): void => {
    const generations = this.#memberships.get(record)
    if (!generations) return
    if (generation !== undefined) {
      for (const release of generations.get(generation)?.values() ?? []) release()
      generations.delete(generation)
    } else {
      for (const topics of generations.values()) for (const release of topics.values()) release()
      generations.clear()
    }
    if (generations.size === 0) this.#memberships.delete(record)
  }
  /** Release all parent listeners and generation membership references. */
  close = (): void => {
    this.#memberships.clear()
    this.#hub.clear()
  }
  /** Private authenticated topic operation shares this exact membership owner. */
  #sender = (context: IRpcContext) => {
    const admitted = this.#registry.instanceIds.get(context.senderId)
    if (
      !admitted ||
      admitted.record.removed ||
      this.#registry.records.get(admitted.record.id) !== admitted.record ||
      admitted.record.generation !== admitted.generation
    )
      throw createTrayError(TrayErrorCode.instanceUnknown)
    return admitted
  }
  /** Private authenticated topic operation shares this exact membership owner. */
  #message = (
    topic: string,
    payload: unknown,
    meta: ITrayTopicDelivery['meta']
  ): ITrayTopicDelivery => {
    assertTopic(topic)
    const value = toWire(payload)
    return { topic, ...(value === undefined ? {} : { payload: value }), meta }
  }
}
