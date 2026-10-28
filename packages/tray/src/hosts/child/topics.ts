/** Own generation-local topic membership; EventSubscriber owns delivery and RPC owns parent IO. */
import { createEventHub } from '@migaia/event-subscriber'
import { TrayInternal } from '../constants.ts'
import { toWire } from '../portable.ts'
import { assertTopic, type ITrayTopicDelivery, type ITrayTopicListener } from '../topics.ts'
import type { ITrayRuntimeOutlet } from '../runtime.ts'

/** One listener owns only its original local remover and idempotent last-listener cleanup. */
type ITopicSubscription = {
  topic: string
  release(): void
  removed?: Promise<void>
}

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
    await this.#outlet().request(TrayInternal.publish, {
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
      pending = this.#join(topic, pending)
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
    /** One explicit registration keeps the original cached off Promise without nested components. */
    const registration: ITopicSubscription = { topic, release }
    return () => (registration.removed ??= this.#leave(registration))
  }

  /** A new first listener waits for the original preceding membership before registering again. */
  async #join(topic: string, previous?: Promise<void>): Promise<void> {
    if (previous) await previous
    await this.#outlet().request(TrayInternal.subscribe, { topic })
  }

  /** Last-listener removal preserves the original release-before-remote-unsubscribe sequence. */
  async #leave(registration: ITopicSubscription): Promise<void> {
    registration.release()
    /** Only the last local listener owns the existing remote membership transition. */
    const topic = registration.topic
    if (this.#hub.size(topic) !== 0) return
    /** Capture the exact old transition before publishing this listener's completion. */
    const previous = this.#memberships.get(topic)
    /** Actual remote completion remains distinct from the local listener's idempotent off result. */
    const leaving = this.#unsubscribe(topic, previous)
    /** This exact transition is published before its native finally reaction may remove it. */
    const transition: { topic: string; completion?: Promise<void> } = { topic }
    /** A later first listener must never have its replacement membership erased by this cleanup. */
    const completion = leaving.finally(() => {
      if (
        this.#hub.size(transition.topic) === 0 &&
        this.#memberships.get(transition.topic) === transition.completion
      )
        this.#memberships.delete(transition.topic)
    })
    transition.completion = completion
    this.#memberships.set(topic, completion)
    await completion
  }

  /** Wait for the exact preceding registration before sending the original remote leave request. */
  async #unsubscribe(topic: string, previous?: Promise<void>): Promise<void> {
    await previous
    await this.#outlet().request(TrayInternal.unsubscribe, { topic })
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
