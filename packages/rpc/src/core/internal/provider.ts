import { createEventChannel, withSnapshotEntries } from '@migaia/event-subscriber'
import type { ICanonicalEventChannel } from '@migaia/event-subscriber'
import type { IRpcEventListener, IRpcProvider } from '../typing.js'
import type { IRpcContext } from '../typing.js'

/** Owns provider and event routing tables for one endpoint. */
export class ProviderRegistry {
  /** Provider ownership remains separate from event listener registrations. */
  readonly providers = new Map<string, IRpcProvider>()
  /** Each event owns one channel so subscription handles identify their own registration. */
  readonly #events = new Map<string, ICanonicalEventChannel<IRpcContext, void | Promise<void>>>()

  /** Removes all application callbacks during endpoint disposal. */
  clear(): void {
    this.providers.clear()
    for (const channel of this.#events.values()) channel.clear()
    this.#events.clear()
  }
  /** Registers a provider and rejects duplicate method ownership. */
  register(method: string, provider: IRpcProvider): boolean {
    if (this.providers.has(method)) return false
    this.providers.set(method, provider)
    return true
  }

  /** Registers an event listener and returns its idempotent disposer. */
  listen(event: string, listener: IRpcEventListener): () => void {
    const channel =
      this.#events.get(event) ?? createEventChannel<IRpcContext, void | Promise<void>>()
    this.#events.set(event, channel)
    const subscription = channel.subscribe((entry) => listener(entry.value))
    return () => {
      subscription()
      if (channel.size === 0 && this.#events.get(event) === channel) this.#events.delete(event)
    }
  }

  /** Reports whether the provider has a live dispatch-only listener for an event. */
  hasListeners(event: string): boolean {
    return (this.#events.get(event)?.size ?? 0) > 0
  }

  /** Counts live registrations, including multiple handles for one callback. */
  get listenerCount(): number {
    let count = 0
    for (const channel of this.#events.values()) count += channel.size
    return count
  }

  /** Invokes the event's starting snapshot in registration order and stops on the first failure. */
  dispatch(event: string, context: IRpcContext): void | Promise<void> {
    const channel = this.#events.get(event)
    if (!channel) return
    return withSnapshotEntries(channel, context, async (entries) => {
      for (const entry of entries) await entry.invoke()
    })
  }

  /** Looks up an inbound provider. */
  getProvider(method: string): IRpcProvider | undefined {
    return this.providers.get(method)
  }
}
