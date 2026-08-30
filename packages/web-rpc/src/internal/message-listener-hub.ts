/** Listener callback accepted by the package-private transport hub. */
export type IMessageListener<TMessage> = (message: TMessage) => void

/**
 * Owns listener membership and the physical registration boundary for one transport event. Dispatch
 * snapshots membership so reentrant add/remove operations affect only later events.
 */
export function createMessageListenerHub<TMessage>(): IMessageListenerHub<TMessage> {
  const listeners = new Set<IMessageListener<TMessage>>()
  let attached = false
  return {
    get size(): number {
      return listeners.size
    },
    has(listener) {
      return listeners.has(listener)
    },
    add(listener, attach) {
      if (listeners.size === 0) {
        attach()
        attached = true
      }
      listeners.add(listener)
    },
    remove(listener, detach) {
      if (!listeners.has(listener)) return false
      if (listeners.size === 1 && attached) {
        detach()
        attached = false
      }
      listeners.delete(listener)
      return true
    },
    dispatch(message, invoke) {
      for (const listener of Array.from(listeners)) invoke(listener, message)
    },
    clear(detach) {
      if (listeners.size > 0 && attached) detach()
      listeners.clear()
      attached = false
    }
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
