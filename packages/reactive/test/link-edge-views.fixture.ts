/**
 * Controlled observers expose supported graph protocols while a named owner retains lifecycle
 * state.
 */
import {
  createTrackedObserver,
  type IObserver,
  type ITrackedObserverBinding
} from '../src/entry/extension.ts'
import type { IRuntime } from '../src/index.ts'

/** A receiver token proves collection callbacks retain the caller's explicit thisArg. */
export type IForEachContext = { label: string }

/** A controlled observer owns terminal state and the canonical binding used by view tests. */
class ControlledObserver {
  /** Terminal state changes before the canonical clear operation. */
  #disposed = false
  /** Tests supply only the supported synchronous dirty callback. */
  #onDirty: () => void
  /** This exact protocol object retains identity throughout the test. */
  readonly observer: IObserver
  /** Canonical binding owns all actual dependency and version storage. */
  readonly binding: ITrackedObserverBinding

  /** Register the same controlled protocol without factory-captured lifecycle state. */
  constructor(runtime: IRuntime, onDirty: () => void) {
    this.#onDirty = onDirty
    /** Metadata getters refer to the named state owner without capturing independent mutable locals. */
    // oxlint-disable-next-line typescript/no-this-alias -- Object getters receive the protocol object; private state belongs to the named fixture owner.
    const owner = this
    this.observer = {
      runtime,
      get disposed() {
        return owner.#disposed
      },
      get deps() {
        return owner.binding.deps
      },
      get depVersions() {
        return owner.binding.depVersions
      },
      markDirty: () => this.#markDirty(),
      onDependencyDisconnected() {}
    }
    this.binding = createTrackedObserver(this.observer)
  }

  /** Terminal observers never invoke a later dirty callback. */
  #markDirty(): void {
    if (!this.#disposed) this.#onDirty()
  }

  /** Release the graph once, after making terminal state visible to reentrant callbacks. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.binding.clear()
  }
}

/** Construct one named observer owner through the existing controlled-extension boundary. */
export function createControlledObserver(
  runtime: IRuntime,
  onDirty: () => void = () => undefined
): ControlledObserver {
  return new ControlledObserver(runtime, onDirty)
}
