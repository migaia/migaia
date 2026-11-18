import type { IReactiveComputed, IRuntime, IReactiveSignal } from '@migaia/reactive'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import type { IDeriveDefinition, IDeriveStateView, IResolvedNode, IScopeState } from './types.ts'

/** Binding object referencing a state path. */
type IStateBinding = { readonly $state: string }
/** Binding object referencing a derive. */
type IDeriveBinding = { readonly $derive: string }

/** True for a `{ $state }` binding. */
function isStateBinding(value: unknown): value is IStateBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { $state?: unknown }).$state === 'string'
  )
}

/** True for a `{ $derive }` binding. */
function isDeriveBinding(value: unknown): value is IDeriveBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { $derive?: unknown }).$derive === 'string'
  )
}

/** Read-only state view handed to derive computations; writes throw DERIVE_WRITE. */
class DeriveView implements IDeriveStateView {
  /** State the view reads from. */
  readonly #state: ScopeState

  /** Wraps the host state. */
  constructor(state: ScopeState) {
    this.#state = state
  }

  /** Tracked read of a state path. */
  read(path: string): unknown {
    return this.#state.read(path)
  }

  /** Always throws: derives are pure. */
  write(path: string): never {
    throw createPartHostError(PartHostErrorCode.deriveWrite, PartHostErrorText.deriveWrite(path))
  }
}

/**
 * Scope state of one host: one signal per path on the host's reactive runtime, plus cached
 * computeds for derive bindings keyed by derive id.
 */
export class ScopeState implements IScopeState {
  /** Runtime that owns every signal and computed of this host. */
  readonly runtime: IRuntime
  /** Signals by state path. */
  readonly #signals = new Map<string, IReactiveSignal<unknown>>()
  /** Computeds by derive id. */
  readonly #computeds = new Map<string, IReactiveComputed<unknown>>()
  /** Derive lookup supplied by the host's catalog. */
  readonly #derive: (id: string) => IDeriveDefinition<unknown, unknown> | undefined

  /** Binds the state to a runtime and a derive lookup. */
  constructor(
    runtime: IRuntime,
    derive: (id: string) => IDeriveDefinition<unknown, unknown> | undefined
  ) {
    this.runtime = runtime
    this.#derive = derive
  }

  /** Signal of a path, created on first use with `undefined`. */
  #signal(path: string): IReactiveSignal<unknown> {
    /** Existing signal. */
    let signal = this.#signals.get(path)
    if (signal === undefined) {
      signal = this.runtime.signal<unknown>(undefined)
      this.#signals.set(path, signal)
    }
    return signal
  }

  /** Tracked read of a path. */
  read(path: string): unknown {
    return this.#signal(path).value
  }

  /** Writes a path. */
  write(path: string, value: unknown): void {
    this.#signal(path).value = value
  }

  /** Seeds a path only when it has never been written. */
  seed(path: string, value: unknown): void {
    if (!this.#signals.has(path)) this.#signal(path).value = value
  }

  /** Value of a derive, computed lazily and cached by the runtime. */
  derived(id: string): unknown {
    /** Cached computed. */
    let computed = this.#computeds.get(id)
    if (computed === undefined) {
      /** Derive definition; an unknown id yields undefined. */
      const definition = this.#derive(id)
      if (definition === undefined) return undefined
      /** View shared by every evaluation of this derive. */
      const view = new DeriveView(this)
      computed = this.runtime.computed(() => definition.compute(view, undefined))
      this.#computeds.set(id, computed)
    }
    return computed.value
  }

  /** Resolves a facet value: bindings read state or derives, literals pass through. */
  resolve(_node: IResolvedNode, value: unknown): unknown {
    if (isStateBinding(value)) return this.read(value.$state)
    if (isDeriveBinding(value)) return this.derived(value.$derive)
    return value
  }

  /** Releases every computed and signal. */
  dispose(): void {
    for (const computed of this.#computeds.values()) computed.dispose()
    for (const signal of this.#signals.values()) signal.dispose()
    this.#computeds.clear()
    this.#signals.clear()
  }
}

export { isDeriveBinding, isStateBinding }
