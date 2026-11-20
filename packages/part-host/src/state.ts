import type { ITraceSink } from './trace/sink.ts'
import type { IReactiveComputed, IRuntime, IReactiveSignal } from '@migaia/reactive'
import { isDefaultStateNamespace, stateNamespaceOf } from '@migaia/part-contract'
import { DefaultStore } from './default-store.ts'
import { ERROR_SOURCE, PartHostErrorCode } from './error-code.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import {
  NamespaceSlot,
  READY_STATUS,
  SlotMode,
  StoreGeneration,
  type ISlotServices
} from './external-store.ts'
import {
  isThenable,
  StateStoreKind,
  type IDefaultStateStore,
  type IDefaultStateStoreOptions,
  type IStateStatus,
  type IStateStore
} from './state-store.ts'
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

  /** Tracked read of a state path; an unregistered namespace reads `undefined` (reported once). */
  read(path: string): unknown {
    this.reads.add(path)
    return this.#state.readShared(path)
  }

  /** Tracked status of a state path; an unregistered namespace is `idle`. */
  status(path: string): IStateStatus {
    return this.#state.statusShared(path)
  }

  /** Always throws: derives are pure. */
  write(path: string): never {
    throw createPartHostError(PartHostErrorCode.deriveWrite, PartHostErrorText.deriveWrite(path))
  }
}

/** Store registrations of one plugin generation, created but not yet routed (install step 2). */
export type IStoreAdmission = {
  readonly plugin: string
  readonly generations: readonly StoreGeneration[]
  readonly defaults: readonly IDefaultStateStore[]
}

/** One live `defaultStateStore` registration. */
type IDefaultGeneration = { readonly plugin: string; readonly options: IDefaultStateStoreOptions }

/** The part of a generation lifetime signal this module uses. */
type IGenerationSignal = {
  addEventListener(type: 'abort', listener: () => void, options: { readonly once: true }): void
}

/**
 * Scope state of one host: a router from the first path segment to the default store (`page`,
 * `section`, `part`) or to the external store a plugin registered, plus cached computeds for derive
 * bindings keyed by derive id.
 */
export class ScopeState implements IScopeState {
  /** Runtime that owns every signal and computed of this host. */
  readonly runtime: IRuntime
  /** Store of `page`, `section` and `part`. */
  readonly #default: DefaultStore
  /** Live `defaultStateStore` registrations in install order. */
  readonly #defaults = new Set<IDefaultGeneration>()
  /** External namespaces by name, created on first registration or first read. */
  readonly #slots = new Map<string, NamespaceSlot>()
  /** Services every slot uses. */
  readonly #services: ISlotServices
  /** Host diagnostics. */
  readonly #report: (error: unknown) => void
  /** Install counter ordering generations. */
  #order = 0
  /** True once the host closed its state; no signal is written afterwards. */
  #closed = false
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

  /** Binds the state to a runtime, a derive lookup, the host diagnostics and a trace sink. */
  constructor(
    runtime: IRuntime,
    derive: (id: string) => IDeriveDefinition<unknown, unknown> | undefined,
    report: (error: unknown) => void,
    trace?: ITraceSink
  ) {
    this.runtime = runtime
    this.#derive = derive
    this.#trace = trace
    this.#report = report
    this.#default = new DefaultStore(runtime, report)
    this.#services = { runtime, report, closed: () => this.#closed }
  }

  /** Options of the newest live `defaultStateStore` registration. */
  #defaultOptions(): IDefaultStateStoreOptions | undefined {
    /** Newest registration. */
    let options: IDefaultStateStoreOptions | undefined
    for (const registration of this.#defaults) options = registration.options
    return options
  }

  /** True once the state is closed. */
  get closed(): boolean {
    return this.#closed
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

  /** Slot of an external namespace, created on first use. */
  #slot(namespace: string): NamespaceSlot {
    /** Existing slot. */
    let slot = this.#slots.get(namespace)
    if (slot === undefined) {
      slot = new NamespaceSlot(namespace, this.#services)
      this.#slots.set(namespace, slot)
    }
    return slot
  }

  /** Slot of a registered or registering namespace; STATE_NAMESPACE_UNKNOWN otherwise. */
  #known(namespace: string): NamespaceSlot {
    /** Slot, if any. */
    const slot = this.#slots.get(namespace)
    if (slot === undefined || slot.mode === SlotMode.unregistered)
      throw (slot ?? new NamespaceSlot(namespace, this.#services)).unknown()
    return slot
  }

  /** Tracked read of a path; an unregistered namespace throws STATE_NAMESPACE_UNKNOWN. */
  read(path: string): unknown {
    /** Signal of a known default path. */
    const known = this.#default.known(path)
    if (known !== undefined) return known.value
    if (isDefaultPath(path)) return this.#default.read(path)
    /** Namespace of the path. */
    const namespace = stateNamespaceOf(path)
    return this.#known(namespace).read(keyOf(path, namespace))
  }

  /**
   * Tracked read for rendering, derives and resource parameters: an unregistered namespace reads
   * `undefined` and reports STATE_NAMESPACE_UNKNOWN once per unregistered period.
   */
  readShared(path: string): unknown {
    /** Signal of a known default path. */
    const known = this.#default.known(path)
    if (known !== undefined) return known.value
    if (isDefaultPath(path)) return this.#default.read(path)
    /** Namespace of the path. */
    const namespace = stateNamespaceOf(path)
    return this.#slot(namespace).readShared(keyOf(path, namespace))
  }

  /** Writes a path; an external namespace needs a serving store. */
  write(path: string, value: unknown): void {
    /** Signal of a known default path. */
    const known = this.#default.known(path)
    if (known !== undefined) {
      this.#default.writeKnown(path, known, value)
      return
    }
    if (isDefaultPath(path)) {
      this.#default.write(path, value)
      return
    }
    /** Namespace of the path. */
    const namespace = stateNamespaceOf(path)
    this.#known(namespace).write(keyOf(path, namespace), value)
  }

  /** Writes only when the path was never written (default) or the store reports it absent. */
  seed(path: string, value: unknown): void {
    /** Namespace of the path. */
    const namespace = stateNamespaceOf(path)
    if (isDefaultStateNamespace(namespace)) {
      this.#default.seed(path, value)
      return
    }
    this.#known(namespace).seed(keyOf(path, namespace), value)
  }

  /** Tracked status of a path; an unregistered namespace throws STATE_NAMESPACE_UNKNOWN. */
  status(path: string): IStateStatus {
    /** Namespace of the path. */
    const namespace = stateNamespaceOf(path)
    if (isDefaultStateNamespace(namespace)) return READY_STATUS
    return this.#known(namespace).status(keyOf(path, namespace))
  }

  /** Tracked status for derives: an unregistered namespace is `idle`, never an error. */
  statusShared(path: string): IStateStatus {
    /** Namespace of the path. */
    const namespace = stateNamespaceOf(path)
    if (isDefaultStateNamespace(namespace)) return READY_STATUS
    return this.#slot(namespace).status(keyOf(path, namespace))
  }

  /**
   * Value of the first read issued after this call and after the path's writes in flight settle.
   * Default paths resolve with their current value.
   */
  load(path: string): Promise<unknown> {
    /** Namespace of the path. */
    const namespace = stateNamespaceOf(path)
    if (isDefaultStateNamespace(namespace)) return Promise.resolve(this.#default.peek(path))
    return this.#known(namespace).load(keyOf(path, namespace))
  }

  /** Handle of the store serving a namespace; STATE_NAMESPACE_UNKNOWN when none serves it. */
  handle(namespace: string): unknown {
    /** Slot, if any. */
    const slot = this.#slots.get(namespace)
    if (isDefaultStateNamespace(namespace) || slot === undefined || slot.mode !== SlotMode.target)
      throw (slot ?? new NamespaceSlot(namespace, this.#services)).unknown()
    return slot.handle()
  }

  // ── registration (install steps 1, 2 and 4) ────────────────────────────────────────────────

  /**
   * Install steps 1 and 2: refuses namespaces (or a default store) another plugin holds, then calls
   * every `create` in order. A synchronous `create` failure releases what was created (in reverse)
   * and rethrows; see `rollback`. Returns `undefined` after close or without stores.
   */
  admit(
    plugin: string,
    stores: readonly (IStateStore<unknown> | IDefaultStateStore)[]
  ): IStoreAdmission | undefined {
    if (this.#closed || stores.length === 0) return undefined
    this.#checkConflicts(plugin, stores)
    /** Generations created so far. */
    const generations: StoreGeneration[] = []
    /** Default-store registrations. */
    const defaults: IDefaultStateStore[] = []
    for (const store of stores) {
      if (store.__kind === StateStoreKind.defaultStore) {
        defaults.push(store)
        continue
      }
      /** Generation of this store. */
      const generation = new StoreGeneration(
        plugin,
        (this.#order += 1),
        store,
        this.#slot(store.namespace)
      )
      try {
        this.#create(generation)
      } catch (error) {
        throw this.rollback({ plugin, generations, defaults }, error)
      }
      generations.push(generation)
    }
    return { plugin, generations, defaults }
  }

  /** Throws STATE_STORE_CONFLICT for the first namespace another plugin name holds. */
  #checkConflicts(
    plugin: string,
    stores: readonly (IStateStore<unknown> | IDefaultStateStore)[]
  ): void {
    for (const store of stores) {
      /** Current owner of the namespace. */
      const owner =
        store.__kind === StateStoreKind.defaultStore
          ? this.#defaultOwner()
          : this.#slots.get(store.namespace)?.owner
      if (owner !== undefined && owner !== plugin)
        throw createPartHostError(
          PartHostErrorCode.stateStoreConflict,
          PartHostErrorText.stateStoreConflict(
            store.__kind === StateStoreKind.defaultStore ? 'page' : store.namespace,
            owner
          )
        )
    }
  }

  /** Plugin holding the default store, if any. */
  #defaultOwner(): string | undefined {
    for (const registration of this.#defaults) return registration.plugin
    return undefined
  }

  /** Calls `create`; a thenable is tracked until it settles. Synchronous failures propagate. */
  #create(generation: StoreGeneration): void {
    /** Create result. */
    const result = generation.store.create(generation.context)
    if (!isThenable(result)) {
      generation.state = 'resolved'
      generation.handle = result
      return
    }
    result.then(
      (handle) => this.#settleCreate(generation, true, handle),
      (error: unknown) => this.#settleCreate(generation, false, error)
    )
  }

  /** Settles an asynchronous `create`; every failure goes to the host diagnostics. */
  #settleCreate(generation: StoreGeneration, ok: boolean, outcome: unknown): void {
    try {
      if (ok) generation.slot.resolved(generation, outcome)
      else generation.slot.rejected(generation, outcome)
    } catch (error) {
      this.#report(error)
    }
  }

  /**
   * Releases an admission whose install failed, newest first: resolved stores are disposed, pending
   * ones aborted (their late handle is released when it arrives). Returns the error to throw: the
   * original one, or a STATE_STORE_ROLLBACK_FAILED AggregateError when a synchronous release threw
   * (`errors[0]` and `cause` are the original). Asynchronous release failures are reported.
   */
  rollback(admission: IStoreAdmission, original: unknown): unknown {
    /** Synchronous release failures. */
    const failures: unknown[] = []
    for (let index = admission.generations.length - 1; index >= 0; index -= 1) {
      /** Generation to release. */
      const generation = admission.generations[index] as StoreGeneration
      generation.dead = true
      generation.controller.abort()
      if (generation.state !== 'resolved') continue
      generation.released = true
      /** Release result. */
      let result: unknown
      try {
        result = generation.store.dispose?.(generation.handle)
      } catch (error) {
        failures.push(error)
        continue
      }
      if (isThenable(result))
        result.then(undefined, (error: unknown) => this.#reportDispose(generation, error))
    }
    if (failures.length === 0) return original
    /** Rollback failure keeping the original first. */
    const aggregate = new AggregateError(
      [original, ...failures],
      PartHostErrorText.stateStoreRollbackFailed(admission.plugin),
      { cause: original }
    )
    return tagHostError(aggregate, PartHostErrorCode.stateStoreRollbackFailed)
  }

  /** Reports a release failure of a generation. */
  #reportDispose(generation: StoreGeneration, error: unknown): void {
    this.#report(
      createPartHostError(
        PartHostErrorCode.stateStoreDisposeFailed,
        PartHostErrorText.stateStoreDisposeFailed(generation.store.namespace),
        error
      )
    )
  }

  /**
   * Install step 4: routes the admitted generations (synchronous handles serve at once, pending
   * ones register) and ends each one when the plugin generation's lifetime signal aborts.
   */
  activate(admission: IStoreAdmission, signal: IGenerationSignal): void {
    for (const options of admission.defaults) {
      /** Live default-store registration. */
      const registration: IDefaultGeneration = { plugin: admission.plugin, options }
      this.#defaults.add(registration)
      this.#default.setOptions(this.#defaultOptions())
      signal.addEventListener('abort', () => this.#dropDefault(registration), { once: true })
    }
    for (const generation of admission.generations) {
      generation.slot.addGeneration(generation)
      signal.addEventListener('abort', () => this.#end(generation), { once: true })
    }
  }

  /** Removes a default-store registration and applies the remaining newest one. */
  #dropDefault(registration: IDefaultGeneration): void {
    this.#defaults.delete(registration)
    this.#default.setOptions(this.#defaultOptions())
  }

  /** Ends a generation from its abort listener; failures go to the host diagnostics. */
  #end(generation: StoreGeneration): void {
    try {
      generation.slot.endGeneration(generation)
    } catch (error) {
      this.#report(error)
    }
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
    if (isStateBinding(value)) return this.readShared(value.$state)
    if (isRowBinding(value)) return row?.[value.$row]
    if (isDeriveBinding(value)) return this.derived(value.$derive)
    return value
  }

  /**
   * Closes the state: no signal is written afterwards, in-flight store work is dropped and waiting
   * `load` calls reject with STATE_NAMESPACE_UNKNOWN. Generations ended later only release their
   * handles. Then releases every computed and signal.
   */
  dispose(): void {
    this.#closed = true
    for (const slot of this.#slots.values()) slot.close()
    for (const computed of this.#computeds.values()) computed.dispose()
    for (const version of this.#versions.values()) version.dispose()
    for (const slot of this.#slots.values()) slot.disposeCells()
    this.#default.dispose()
    this.#computeds.clear()
    this.#versions.clear()
  }
}

/**
 * True for a `page.`, `section.` or `part.` path (or the bare namespace), checked without
 * allocating, because every default-store read and write passes through it.
 */
function isDefaultPath(path: string): boolean {
  /** First character code: `p` (112) or `s` (115) start every default namespace. */
  const first = path.charCodeAt(0)
  if (first === 112)
    return (
      (path.startsWith('page') && (path.length === 4 || path.charCodeAt(4) === 46)) ||
      (path.startsWith('part') && (path.length === 4 || path.charCodeAt(4) === 46))
    )
  if (first === 115)
    return path.startsWith('section') && (path.length === 7 || path.charCodeAt(7) === 46)
  return false
}

/** Key of a path inside its namespace (`cart.items.0` → `items.0`; `cart` → ``). */
function keyOf(path: string, namespace: string): string {
  return path.length > namespace.length ? path.slice(namespace.length + 1) : ''
}

/** Tags a native error with a part-host code without replacing it. */
function tagHostError<T extends Error>(error: T, code: string): T {
  return attachErrorIdentity(error, { source: ERROR_SOURCE, code }) as T
}

export { isDeriveBinding, isStateBinding }
