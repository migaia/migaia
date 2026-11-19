import type { ITraceSink } from './trace/sink.ts'
import type { IReactiveComputed, IRuntime, IReactiveSignal } from '@migaia/reactive'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import type { IDeriveDefinition, IDeriveStateView, IResolvedNode, IScopeState } from './types.ts'

/** Binding object referencing a state path. */
type IStateBinding = { readonly $state: string }
/** Binding object referencing a derive. */
type IDeriveBinding = { readonly $derive: string }
/** Binding object reading a field of the current template row. */
type IRowBinding = { readonly $row: string }

/** True for a `{ $row }` binding. */
function isRowBinding(value: unknown): value is IRowBinding {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { $row?: unknown }).$row === 'string'
  )
}

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

/**
 * Read-only state view handed to derive computations; writes throw DERIVE_WRITE. It records the
 * paths read by the current evaluation so tracing can show a derive's dependencies.
 */
class DeriveView implements IDeriveStateView {
  /** State the view reads from. */
  readonly #state: ScopeState
  /** Paths read by the current evaluation, in first-read order. */
  readonly reads = new Set<string>()

  /** Wraps the host state. */
  constructor(state: ScopeState) {
    this.#state = state
  }

  /** Tracked read of a state path. */
  read(path: string): unknown {
    this.reads.add(path)
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
  /** Paths written at least once, so `seed` never overwrites an authored or user value. */
  readonly #written = new Set<string>()
  /** Signals by state path. */
  readonly #signals = new Map<string, IReactiveSignal<unknown>>()
  /** Computeds by derive id. */
  readonly #computeds = new Map<string, IReactiveComputed<unknown>>()
  /** Derive lookup supplied by the host's catalog. */
  readonly #derive: (id: string) => IDeriveDefinition<unknown, unknown> | undefined
  /**
   * Definition version per derive id; bumped when the catalog replaces or removes the derive, so
   * every binding reading it re-evaluates against the current definition.
   */
  readonly #versions = new Map<string, IReactiveSignal<number>>()
  /** Trace sink for derive recomputation events. */
  readonly #trace: ITraceSink | undefined

  /** Binds the state to a runtime, a derive lookup and an optional trace sink. */
  constructor(
    runtime: IRuntime,
    derive: (id: string) => IDeriveDefinition<unknown, unknown> | undefined,
    trace?: ITraceSink
  ) {
    this.runtime = runtime
    this.#derive = derive
    this.#trace = trace
  }

  /** Version signal of a derive id, created on first use. */
  #version(id: string): IReactiveSignal<number> {
    /** Existing signal. */
    let version = this.#versions.get(id)
    if (version === undefined) {
      version = this.runtime.signal(0)
      this.#versions.set(id, version)
    }
    return version
  }

  /**
   * Drops cached computeds of replaced or removed derives and bumps their versions, so the next
   * read builds a computed from the current definition. The old `compute` is never called again.
   */
  forget(ids: Iterable<string>): void {
    for (const id of ids) {
      /** Cached computed of the id. */
      const computed = this.#computeds.get(id)
      if (computed === undefined) continue
      this.#computeds.delete(id)
      computed.dispose()
      /** Version signal of the id. */
      const version = this.#version(id)
      version.value = version.value + 1
    }
  }

  /** Evaluates a derive once, recording its reads when tracing is enabled. */
  #evaluate(id: string, definition: IDeriveDefinition<unknown, unknown>): unknown {
    /** View of this evaluation. */
    const view = new DeriveView(this)
    /** Computed value. */
    const value = definition.compute(view, undefined)
    if (this.#trace?.enabled === true)
      this.#trace.event({
        address: `$derive:${id}`,
        kind: 'derive',
        name: id,
        detail: { reads: [...view.reads] },
        at: Date.now()
      })
    return value
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

  /** Writes a path and remembers that it was written. */
  write(path: string, value: unknown): void {
    this.#written.add(path)
    this.#signal(path).value = value
  }

  /** Seeds a path only when it has never been written; earlier reads do not count. */
  seed(path: string, value: unknown): void {
    if (!this.#written.has(path)) this.write(path, value)
  }

  /** Value of a derive, computed lazily and cached by the runtime. */
  derived(id: string): unknown {
    // Reading the version subscribes callers to definition replacement of this id.
    void this.#version(id).value
    /** Cached computed. */
    let computed = this.#computeds.get(id)
    if (computed === undefined) {
      /** Derive definition; an unknown id yields undefined. */
      const definition = this.#derive(id)
      if (definition === undefined) return undefined
      computed = this.runtime.computed(() => this.#evaluate(id, definition))
      this.#computeds.set(id, computed)
    }
    return computed.value
  }

  /**
   * Resolves a facet value: `$state` and `$derive` bindings read state or derives, `$row` reads a
   * field of the given template row (`undefined` outside a row), literals pass through.
   */
  resolve(_node: IResolvedNode, value: unknown, row?: Readonly<Record<string, unknown>>): unknown {
    if (isStateBinding(value)) return this.read(value.$state)
    if (isRowBinding(value)) return row?.[value.$row]
    if (isDeriveBinding(value)) return this.derived(value.$derive)
    return value
  }

  /** Releases every computed and signal. */
  dispose(): void {
    for (const computed of this.#computeds.values()) computed.dispose()
    for (const signal of this.#signals.values()) signal.dispose()
    for (const version of this.#versions.values()) version.dispose()
    this.#computeds.clear()
    this.#signals.clear()
    this.#versions.clear()
  }
}

export { isDeriveBinding, isStateBinding }
