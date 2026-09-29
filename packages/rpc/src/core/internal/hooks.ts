import { createEventChannel, EventAdmissionPolicy } from '@migaia/event-subscriber'
import type { IRpcHook, IRpcHookEvent } from '../typing.js'

/** Reports one listener failure without allowing diagnostics to re-enter listener dispatch. */
export type IRpcHookFailureReporter = (error: unknown, event: IRpcHookEvent) => void

/** Dispatches one listener and contains both sync throws and async rejections. */
export function dispatchHookListener(
  listener: IRpcHook,
  event: IRpcHookEvent,
  onError?: IRpcHookFailureReporter
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
  listeners: readonly IRpcHook[],
  onError?: IRpcHookFailureReporter
): (event: IRpcHookEvent) => void {
  const listenerSnapshot = Object.freeze([...listeners])
  return (event): void => {
    for (const listener of listenerSnapshot) dispatchHookListener(listener, event, onError)
  }
}

/** Owns hook subscription and failure isolation for one endpoint runtime. */
export class HookRegistry {
  /** Event-subscriber channel owning hook registration and snapshot dispatch. */
  readonly #channel = createEventChannel<IRpcHookEvent>({
    admissionPolicy: EventAdmissionPolicy.unique,
    report: () => undefined
  })
  /** Reuses a wrapper per hook so the channel can compare the original function identity. */
  readonly #wrappers = new WeakMap<IRpcHook, (event: { value: IRpcHookEvent }) => void>()

  /** Returns the number of registered hooks for test-only lifecycle inspection. */
  get size(): number {
    return this.#channel.size
  }

  /** Adds a hook and returns its idempotent disposer. */
  add(listener: IRpcHook): () => void {
    let wrapper = this.#wrappers.get(listener)
    if (wrapper === undefined) {
      wrapper = (event) => dispatchHookListener(listener, event.value, this.#activeReport)
      this.#wrappers.set(listener, wrapper)
    }
    return this.#channel.subscribe(wrapper)
  }

  /** Clears all hooks during endpoint disposal. */
  clear(): void {
    this.#channel.clear()
  }

  /** Emits an event while isolating synchronous and asynchronous hook failures. */
  emit(event: IRpcHookEvent, onError?: (error: unknown, event: IRpcHookEvent) => void): void {
    const previousReport = this.#activeReport
    this.#activeReport = onError
    try {
      this.#channel.publish(event)
    } finally {
      this.#activeReport = previousReport
    }
  }

  /** Stores the report callback for the synchronous dispatch window only. */
  #activeReport?: (error: unknown, event: IRpcHookEvent) => void
}
