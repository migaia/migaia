/** Listener callback accepted by the package-private transport hub. */
export type IMessageListener<TMessage> = (message: TMessage) => void

/**
 * Owns listener membership and the physical registration boundary for one transport event. Dispatch
 * snapshots membership so reentrant add/remove operations affect only later events.
 */
export function createMessageListenerHub<TMessage>(): IMessageListenerHub<TMessage> {
  return new MessageListenerHub<TMessage>()
}

/** One transport event owns membership and its single physical registration boundary. */
class MessageListenerHub<TMessage> implements IMessageListenerHub<TMessage> {
  /** Reentrant dispatch observes a snapshot while later events use current membership. */
  readonly #listeners = new Set<IMessageListener<TMessage>>()
  /** Failed attachment/removal never commits a different physical registration state. */
  #attached = false

  /** Membership size determines the existing first-attach and last-detach transitions. */
  get size(): number {
    return this.#listeners.size
  }

  /** Exact function identity determines whether this transport owns a listener. */
  readonly has = (listener: IMessageListener<TMessage>): boolean => this.#listeners.has(listener)

  /** Attach physically before publishing the first listener so failure leaves no membership. */
  readonly add = (listener: IMessageListener<TMessage>, attach: () => void): void => {
    if (this.#listeners.size === 0) {
      attach()
      this.#attached = true
    }
    this.#listeners.add(listener)
  }

  /** Failed final detachment leaves the original listener registered for an explicit retry. */
  readonly remove = (listener: IMessageListener<TMessage>, detach: () => void): boolean => {
    if (!this.#listeners.has(listener)) return false
    if (this.#listeners.size === 1 && this.#attached) {
      detach()
      this.#attached = false
    }
    this.#listeners.delete(listener)
    return true
  }

  /** Reentrant add/remove affects subsequent events rather than this dispatch snapshot. */
  readonly dispatch = (
    message: TMessage,
    invoke: (listener: IMessageListener<TMessage>, message: TMessage) => void
  ): void => {
    for (const listener of Array.from(this.#listeners)) invoke(listener, message)
  }

  /** Commit logical clearing only after the original physical detachment succeeds. */
  readonly clear = (detach: () => void): void => {
    if (this.#listeners.size > 0 && this.#attached) detach()
    this.#listeners.clear()
    this.#attached = false
  }
}

/** Package-private state surface for a single physical listener registration. */
export type IMessageListenerHub<TMessage> = {
  readonly size: number
  has(listener: IMessageListener<TMessage>): boolean
  add(listener: IMessageListener<TMessage>, attach: () => void): void
  remove(listener: IMessageListener<TMessage>, detach: () => void): boolean
  dispatch(
    message: TMessage,
    invoke: (listener: IMessageListener<TMessage>, message: TMessage) => void
  ): void
  clear(detach: () => void): void
}
