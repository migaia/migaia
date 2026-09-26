import type { IRpcEventListener, IRpcProvider } from '../typing.js'

/** Owns provider and event routing tables for one endpoint. */
export class ProviderRegistry {
  readonly providers = new Map<string, IRpcProvider>()
  readonly events = new Map<string, IRpcEventListener[]>()

  /** Removes all application callbacks during endpoint disposal. */
  clear(): void {
    this.providers.clear()
    this.events.clear()
  }
  /** Registers a provider and rejects duplicate method ownership. */
  register(method: string, provider: IRpcProvider): boolean {
    if (this.providers.has(method)) return false
    this.providers.set(method, provider)
    return true
  }

  /** Registers an event listener and returns its idempotent disposer. */
  listen(event: string, listener: IRpcEventListener): () => void {
    const listeners = this.events.get(event) ?? []
    listeners.push(listener)
    this.events.set(event, listeners)
    return () => {
      const current = this.events.get(event)
      if (!current) return
      const index = current.indexOf(listener)
      if (index >= 0) current.splice(index, 1)
      if (current.length === 0) this.events.delete(event)
    }
  }

  /** Looks up an inbound provider. */
  getProvider(method: string): IRpcProvider | undefined {
    return this.providers.get(method)
  }

  /** Returns listeners for one event without exposing the registry map. */
  getListeners(event: string): readonly IRpcEventListener[] | undefined {
    return this.events.get(event)
  }
}
