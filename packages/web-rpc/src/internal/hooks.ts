import type { IWebRpcHook, IWebRpcHookEvent } from '../typing.js';
import { observeListener } from './listener-safety.js';

/** Owns hook subscription and failure isolation for one endpoint runtime. */
export class HookRegistry {
  readonly #listeners = new Set<IWebRpcHook>();

  /** Returns the number of registered hooks for test-only lifecycle inspection. */
  get size(): number {
    return this.#listeners.size;
  }

  /** Adds a hook and returns its idempotent disposer. */
  add(listener: IWebRpcHook): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Clears all hooks during endpoint disposal. */
  clear(): void {
    this.#listeners.clear();
  }

  /** Emits an event while isolating synchronous and asynchronous hook failures. */
  emit(event: IWebRpcHookEvent, onError?: (error: unknown, event: IWebRpcHookEvent) => void): void {
    const report = (error: unknown): void => {
      try {
        onError?.(error, event);
      } catch {
        // Diagnostics are a terminal boundary and must never re-enter the hook path.
      }
    };
    for (const listener of Array.from(this.#listeners)) {
      observeListener(() => listener(event), report);
    }
  }
}
