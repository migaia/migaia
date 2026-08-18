import { createEventChannel } from '@migaia/event-subscriber';
import type { IWebRpcHook, IWebRpcHookEvent } from '../typing.js';

/** Owns hook subscription and failure isolation for one endpoint runtime. */
export class HookRegistry {
  /** Event-subscriber channel owning hook registration and snapshot dispatch. */
  readonly #channel = createEventChannel<IWebRpcHookEvent>({ report: () => undefined });
  /** Maps legacy hook identities to event-subscriber registrations for Set semantics. */
  readonly #registrations = new Map<IWebRpcHook, () => void>();

  /** Returns the number of registered hooks for test-only lifecycle inspection. */
  get size(): number {
    return this.#registrations.size;
  }

  /** Adds a hook and returns its idempotent disposer. */
  add(listener: IWebRpcHook): () => void {
    const existing = this.#registrations.get(listener);
    if (existing) {
      return () => {
        if (this.#registrations.get(listener) !== existing) return;
        this.#registrations.delete(listener);
        existing();
      };
    }
    const registration = this.#channel.subscribe((event) => {
      const report = this.#activeReport;
      try {
        const result = listener(event.value);
        return Promise.resolve(result).then(undefined, (error: unknown) => {
          this.#report(report, error, event.value);
        });
      } catch (error) {
        this.#report(report, error, event.value);
        return undefined;
      }
    });
    this.#registrations.set(listener, registration);
    return () => {
      if (this.#registrations.get(listener) !== registration) return;
      this.#registrations.delete(listener);
      registration();
    };
  }

  /** Clears all hooks during endpoint disposal. */
  clear(): void {
    this.#channel.clear();
    this.#registrations.clear();
  }

  /** Emits an event while isolating synchronous and asynchronous hook failures. */
  emit(event: IWebRpcHookEvent, onError?: (error: unknown, event: IWebRpcHookEvent) => void): void {
    const previousReport = this.#activeReport;
    this.#activeReport = onError;
    try {
      this.#channel.publish(event);
    } finally {
      this.#activeReport = previousReport;
    }
  }

  /** Stores the report callback for the synchronous dispatch window only. */
  #activeReport?: (error: unknown, event: IWebRpcHookEvent) => void;

  /** Reports a hook failure without allowing diagnostics to re-enter dispatch. */
  #report(
    report: ((error: unknown, event: IWebRpcHookEvent) => void) | undefined,
    error: unknown,
    event: IWebRpcHookEvent
  ): void {
    try {
      report?.(error, event);
    } catch {
      // Diagnostics are a terminal boundary and must never re-enter the hook path.
    }
  }
}
