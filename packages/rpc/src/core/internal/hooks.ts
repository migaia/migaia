import { createEventChannel } from '@migaia/event-subscriber'
import type { IWebRpcHook, IWebRpcHookEvent } from '../typing.js'

/** Reports one listener failure without allowing diagnostics to re-enter listener dispatch. */
export type IWebRpcHookFailureReporter = (error: unknown, event: IWebRpcHookEvent) => void

/** Dispatches one listener and contains both sync throws and async rejections. */
export function dispatchHookListener(
  listener: IWebRpcHook,
  event: IWebRpcHookEvent,
  onError?: IWebRpcHookFailureReporter
): void {
  const report = (error: unknown): void => {
    try {
      onError?.(error, event)
    } catch {
      // Hook diagnostics are terminal and must not re-enter listener dispatch.
    }
  }
  try {
    void Promise.resolve(listener(event)).then(undefined, report)
  } catch (error) {
    report(error)
  }
}

/** Creates a detached construction reporter from one immutable listener snapshot. */
export function createConstructionDiagnosticReporter(
  listeners: readonly IWebRpcHook[],
  onError?: IWebRpcHookFailureReporter
): (event: IWebRpcHookEvent) => void {
  const listenerSnapshot = Object.freeze([...listeners])
  return (event): void => {
    for (const listener of listenerSnapshot) dispatchHookListener(listener, event, onError)
  }
}

/** Owns hook subscription and failure isolation for one endpoint runtime. */
export class HookRegistry {
  /** Event-subscriber channel owning hook registration and snapshot dispatch. */
  readonly #channel = createEventChannel<IWebRpcHookEvent>({ report: () => undefined })
  /** Maps legacy hook identities to event-subscriber registrations for Set semantics. */
  readonly #registrations = new Map<IWebRpcHook, () => void>()

  /** Returns the number of registered hooks for test-only lifecycle inspection. */
  get size(): number {
    return this.#registrations.size
  }

  /** Adds a hook and returns its idempotent disposer. */
  add(listener: IWebRpcHook): () => void {
    const existing = this.#registrations.get(listener)
    if (existing) {
      return () => {
        if (this.#registrations.get(listener) !== existing) return
        this.#registrations.delete(listener)
        existing()
      }
    }
    const registration = this.#channel.subscribe((event) => {
      dispatchHookListener(listener, event.value, this.#activeReport)
    })
    this.#registrations.set(listener, registration)
    return () => {
      if (this.#registrations.get(listener) !== registration) return
      this.#registrations.delete(listener)
      registration()
    }
  }

  /** Clears all hooks during endpoint disposal. */
  clear(): void {
    this.#channel.clear()
    this.#registrations.clear()
  }

  /** Emits an event while isolating synchronous and asynchronous hook failures. */
  emit(event: IWebRpcHookEvent, onError?: (error: unknown, event: IWebRpcHookEvent) => void): void {
    const previousReport = this.#activeReport
    this.#activeReport = onError
    try {
      this.#channel.publish(event)
    } finally {
      this.#activeReport = previousReport
    }
  }

  /** Stores the report callback for the synchronous dispatch window only. */
  #activeReport?: (error: unknown, event: IWebRpcHookEvent) => void
}
