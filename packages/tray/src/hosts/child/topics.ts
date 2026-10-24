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
  return new ChildTopics(outlet, report)
}
/** Owns only child topic membership; EventSubscriber retains fan-out and listener lifecycle. */
class ChildTopics {
  /** Accepted generation outlet is borrowed for each parent request. */
  readonly #outlet: () => ITrayRuntimeOutlet
  /** User failures remain contained by the original reporter. */
  readonly #report: (error: unknown) => void
  /** EventSubscriber retains local callback and rejection semantics. */
  readonly #hub: ReturnType<typeof createEventHub<Record<string, ITrayTopicDelivery>>>
  /** Concurrent first listeners share registration and last-listener off completion. */
  readonly #memberships = new Map<string, Promise<void>>()
  /** Capture the accepted outlet and its original generation reporter. */
  constructor(outlet: () => ITrayRuntimeOutlet, report: (error: unknown) => void) {
    this.#outlet = outlet
    this.#report = report
    this.#hub = createEventHub<Record<string, ITrayTopicDelivery>>({
      report: ({ error }) => this.#report(error),
      terminalReport: this.#report
    })
  }

  /** Validate portable payload before the original parent publication request. */
  publish = async (topic: string, payload?: unknown): Promise<void> => {
    assertTopic(topic)
    const value = toWire(payload)
    await this.#outlet().request(TrayInternal.connection, TrayInternal.publish, {
      topic,
      ...(value === undefined ? {} : { payload: value })
    })
  }
  /** Share first membership registration and roll back only this listener after failure. */
  subscribe = async (topic: string, listener: ITrayTopicListener): Promise<() => Promise<void>> => {
    assertTopic(topic)
    const release = this.#hub.subscribe(topic, ({ value }) => {
      try {
        return listener(value.payload, value.meta)
      } catch (error) {
        this.#report(error)
      }
    })
    let pending = this.#memberships.get(topic)
    if (this.#hub.size(topic) === 1) {
      pending = (async () => {
        if (pending) await pending
        await this.#outlet().request(TrayInternal.connection, TrayInternal.subscribe, { topic })
      })()
      this.#memberships.set(topic, pending)
    }
    try {
      await pending
    } catch (error) {
      release()
      if (this.#hub.size(topic) === 0 && this.#memberships.get(topic) === pending)
        this.#memberships.delete(topic)
      throw error
    }
    /** One off receipt releases only this listener and shares its last-listener relay Promise. */
    let removed: Promise<void> | undefined
    return () => {
      removed ??= (async () => {
        release()
        if (this.#hub.size(topic) !== 0) return
        const previous = this.#memberships.get(topic)
        const leaving = (async () => {
          await previous
          await this.#outlet().request(TrayInternal.connection, TrayInternal.unsubscribe, { topic })
        })()
        const completion = leaving.finally(() => {
          if (this.#hub.size(topic) === 0 && this.#memberships.get(topic) === completion)
            this.#memberships.delete(topic)
        })
        this.#memberships.set(topic, completion)
        await completion
      })()
      return removed
    }
  }
  /** Freeze authenticated metadata once in the receiving realm before local fan-out. */
  deliver = (input: ITrayTopicDelivery): void => {
    const meta = Object.freeze({ from: Object.freeze(input.meta.from) })
    this.#hub.publish(input.topic, { ...input, meta })
  }
  /** Release generation-local callbacks; parent departure retains remote membership ownership. */
  close = (): void => {
    this.#hub.clear()
    this.#memberships.clear()
  }
}

/** Client and dispatcher share the same generation-local business topic owner. */
export type IChildTopics = ReturnType<typeof createChildTopics>
