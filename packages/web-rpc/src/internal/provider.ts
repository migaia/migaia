import type { IWebRpcEventListener, IWebRpcProvider } from '../typing';

/** Owns provider and event routing tables for one endpoint. */
export class ProviderRegistry {
  readonly providers = new Map<string, IWebRpcProvider>();
  readonly events = new Map<string, IWebRpcEventListener[]>();

  /** Removes all application callbacks during endpoint disposal. */
  clear(): void {
    this.providers.clear();
    this.events.clear();
  }
  /** Registers a provider and rejects duplicate method ownership. */
  register(method: string, provider: IWebRpcProvider): boolean {
    if (this.providers.has(method)) return false;
    this.providers.set(method, provider);
    return true;
  }

  /** Registers an event listener and returns its idempotent disposer. */
  listen(event: string, listener: IWebRpcEventListener): () => void {
    const listeners = this.events.get(event) ?? [];
    listeners.push(listener);
    this.events.set(event, listeners);
    return () => {
      const current = this.events.get(event);
      if (!current) return;
      const index = current.indexOf(listener);
      if (index >= 0) current.splice(index, 1);
      if (current.length === 0) this.events.delete(event);
    };
  }

  /** Looks up an inbound provider. */
  getProvider(method: string): IWebRpcProvider | undefined {
    return this.providers.get(method);
  }

  /** Returns listeners for one event without exposing the registry map. */
  getListeners(event: string): readonly IWebRpcEventListener[] | undefined {
    return this.events.get(event);
  }
}
