/** Per-host resource store: cache entries, the asynchronous state machine, tags and watches. */
import {
  ResourceStatus,
  splitDescriptorId,
  type IResourceBinding,
  type IResourceSnapshot,
  type IStandardSchemaInput
} from '@migaia/part-contract'
import type { IReactiveEffect, IReactiveSignal, IRuntime } from '@migaia/reactive'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import type { IResourceDefinition, IResourceHandle, IResourceWatch } from './types.ts'

/** A resource definition with the dependency outputs of its current plugin generation. */
export type IResourceRuntime = {
  readonly definition: IResourceDefinition
  readonly features: Readonly<Record<string, unknown>>
  /** Identity of the registering generation; entries of another generation are stale. */
  readonly token: object
}

/** What the store needs from its host: catalog lookups, state reads and error reporting. */
export type IResourceStoreHost = {
  readonly runtime: () => IRuntime
  readonly resource: (id: string) => IResourceRuntime | undefined
  readonly readState: (path: string) => unknown
  readonly derived: (id: string) => unknown
  readonly report: (error: unknown) => void
}

/** Snapshot of an entry that has not produced anything yet. */
const IDLE: IResourceSnapshot = Object.freeze({ status: ResourceStatus.idle, refreshing: false })

/** Separator of the composite entry key; NUL cannot appear in a descriptor id. */
const KEY_SEPARATOR = '\u0000'

/** Default cache key: parameters serialised in their written key order (no sorting). */
function defaultKey(params: unknown): string {
  return JSON.stringify(params ?? {})
}

/** Default empty test: an empty array, or an object whose `items` is an empty array. */
function defaultIsEmpty(result: unknown): boolean {
  if (Array.isArray(result)) return result.length === 0
  /** Items field of an object result. */
  const items = (result as { items?: unknown } | null | undefined)?.items
  return Array.isArray(items) && items.length === 0
}

/** Name part of a resource id, the default invalidation tag. */
export function resourceName(id: string): string {
  return splitDescriptorId(id).name
}

/** Error shape kept on a snapshot: the serialisable code and message of a failure. */
function snapshotError(error: unknown): { readonly code?: string; readonly message: string } {
  /** Error fields when the value is an object. */
  const fields = (typeof error === 'object' && error !== null ? error : {}) as {
    code?: unknown
    message?: unknown
  }
  return {
    ...(typeof fields.code === 'string' ? { code: fields.code } : {}),
    message: typeof fields.message === 'string' ? fields.message : messageOf(error)
  }
}

/** Text of a failure without a message: JSON for plain objects, `String` for anything else. */
function messageOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error)
  try {
    return JSON.stringify(error) ?? String(error)
  } catch {
    // Cyclic or otherwise unserialisable objects fall back to their string form.
    return String(error)
  }
}

/** Creates the `ARGS_INVALID` error of a failed runtime validation, issues on `cause`. */
function argsInvalid(target: string, issues: unknown): Error {
  return createPartHostError(
    PartHostErrorCode.argsInvalid,
    PartHostErrorText.argsInvalid(target),
    issues
  )
}

/**
 * Validates a value with a Standard Schema; resolves with the validated value or rejects with
 * `ARGS_INVALID` carrying the issue list.
 */
export async function validateRuntimeArgs(
  schema: IStandardSchemaInput | undefined,
  value: unknown,
  target: string
): Promise<unknown> {
  if (schema === undefined) return value
  /** Validation result, awaited for synchronous and asynchronous validators alike. */
  const result = await schema['~standard'].validate(value)
  if (result.issues !== undefined) throw argsInvalid(target, result.issues)
  return result.value
}

/**
 * One cache entry: one resource with one set of parameters. Holds the snapshot signal, the running
 * load and its abort controller, and the subscriber count. Generations order loads so a late result
 * of a superseded load never changes the snapshot.
 */
export class ResourceEntry {
  /** Resource id. */
  readonly id: string
  /** Composite store key. */
  readonly key: string
  /** Parameters of every load of this entry. */
  readonly params: unknown
  /** Definition and dependency outputs captured when the entry was created. */
  readonly #resource: IResourceRuntime
  /** Snapshot signal read by watches. */
  readonly snapshot: IReactiveSignal<IResourceSnapshot>
  /** Store that owns the entry; told when tags change. */
  readonly #store: ResourceStore
  /** Load generation; increases with every start. */
  #generation = 0
  /** Abort controller of the running load. */
  #controller: AbortController | undefined
  /** Promise of the latest load. */
  #promise: Promise<unknown> | undefined
  /** Original error of the latest failure. */
  #error: unknown
  /** Whether the latest load is still running. */
  #running = false
  /** Whether the entry was deleted from the store. */
  #dead = false
  /** Number of watches and queries holding the entry. */
  subscribers = 0
  /** Tags the entry is indexed under. */
  tags: ReadonlySet<string> = new Set()

  /** Creates an idle entry. */
  constructor(
    store: ResourceStore,
    id: string,
    key: string,
    params: unknown,
    resource: IResourceRuntime
  ) {
    this.#store = store
    this.id = id
    this.key = key
    this.params = params
    this.#resource = resource
    this.snapshot = store.runtime().signal<IResourceSnapshot>(IDLE)
  }

  /** Generation token of the definition the entry loads with. */
  get token(): object {
    return this.#resource.token
  }

  /** Whether the entry was deleted. */
  get dead(): boolean {
    return this.#dead
  }

  /** Original error of the latest failure. */
  get error(): unknown {
    return this.#error
  }

  /** Promise of the latest load, without starting one. */
  get current(): Promise<unknown> | undefined {
    return this.#promise
  }

  /** Promise of the latest load, starting one when none ran yet. */
  promise(): Promise<unknown> {
    if (this.#promise === undefined) this.start()
    return this.#promise as Promise<unknown>
  }

  /**
   * Starts a load. The first load moves the entry to `loading`; later loads keep the status and set
   * `refreshing`, except while the first load is still running, which simply restarts. A running
   * load is aborted first.
   */
  start(): void {
    if (this.#dead) return
    this.#controller?.abort()
    /** Controller of this load. */
    const controller = new AbortController()
    this.#controller = controller
    this.#generation += 1
    /** Generation of this load. */
    const generation = this.#generation
    /** Snapshot before the load. */
    const current = this.snapshot.value
    /** Whether a result exists, so this load is a refresh. */
    const settled =
      current.status !== ResourceStatus.idle && current.status !== ResourceStatus.loading
    this.snapshot.value = settled
      ? { ...current, refreshing: true }
      : { status: ResourceStatus.loading, refreshing: false, ...this.#page(undefined) }
    this.#running = true
    this.#promise = this.#load(controller.signal)
    this.#promise.then(
      (result) => this.#succeed(generation, result),
      (error: unknown) => this.#fail(generation, error)
    )
  }

  /** Aborts the running load and marks the entry deleted. */
  kill(): void {
    this.#dead = true
    this.#controller?.abort()
    this.#controller = undefined
  }

  /** Validates parameters and calls the definition's load. */
  async #load(signal: INativeAbortSignal): Promise<unknown> {
    /** Definition of the entry. */
    const definition = this.#resource.definition
    /** Validated parameters. */
    const params = await validateRuntimeArgs(definition.params, this.params, this.id)
    return await definition.load(params, { features: this.#resource.features as never, signal })
  }

  /** Applies a successful result unless a newer load superseded it. */
  #succeed(generation: number, result: unknown): void {
    if (generation !== this.#generation || this.#dead) return
    this.#running = false
    /** Definition of the entry. */
    const definition = this.#resource.definition
    /** Whether the result counts as empty. */
    const empty = (definition.isEmpty ?? defaultIsEmpty)(result)
    this.#error = undefined
    this.snapshot.value = {
      status: empty ? ResourceStatus.empty : ResourceStatus.ready,
      data: result,
      refreshing: false,
      ...this.#page(result)
    }
    this.#store.retag(this, definition.tags?.(this.params, result) ?? [])
  }

  /** Applies a failure unless a newer load superseded it; reports the original error once. */
  #fail(generation: number, error: unknown): void {
    if (generation !== this.#generation || this.#dead) return
    this.#running = false
    this.#error = error
    /** Snapshot before the failure; its data is kept. */
    const current = this.snapshot.value
    this.snapshot.value = {
      status: ResourceStatus.error,
      ...(current.data === undefined ? {} : { data: current.data }),
      error: snapshotError(error),
      refreshing: false,
      ...(current.page === undefined ? {} : { page: current.page })
    }
    this.#store.report(error)
  }

  /** Paging field of a snapshot when the resource declares paging. */
  #page(result: unknown): Pick<IResourceSnapshot, 'page'> {
    /** Paging declaration. */
    const paging = this.#resource.definition.paging
    if (paging === undefined) return {}
    /** Page index parameter as a number. */
    const raw = Number((this.params as Record<string, unknown> | undefined)?.[paging.param] ?? 0)
    /** Page index; a parameter that is not a finite number counts as the first page. */
    const index = Number.isFinite(raw) ? raw : 0
    /** Total count from the result, when it is a number. */
    const total = (result as { total?: unknown } | null | undefined)?.total
    return {
      page: { index, size: paging.size, ...(typeof total === 'number' ? { total } : {}) }
    }
  }

  /** Whether a load is running. */
  get running(): boolean {
    return this.#running
  }
}

/** What a watch currently shows: its entry and the snapshot kept from the previous key. */
type IWatchTarget = {
  readonly entry: ResourceEntry | undefined
  readonly previous: IResourceSnapshot | undefined
  readonly missing: string | undefined
}

/**
 * Observation of one binding. A reactive effect created with the watch tracks the parameter
 * bindings and the resource's version, and switches entries outside render; `read` only reads.
 */
export class ResourceWatch implements IResourceWatch {
  /** Owning store. */
  readonly #store: ResourceStore
  /** Watched binding. */
  readonly #binding: IResourceBinding
  /** Template row feeding `$row` parameters. */
  readonly #row: Readonly<Record<string, unknown>> | undefined
  /** Current target; written only by the effect. */
  readonly #target: IReactiveSignal<IWatchTarget>
  /** Effect switching entries. */
  readonly #effect: IReactiveEffect
  /** Version of the resource id seen by the last switch. */
  #version = -1
  /** Whether `release` ran. */
  #released = false

  /** Starts watching; the store tracks the watch until it is released. */
  constructor(
    store: ResourceStore,
    binding: IResourceBinding,
    row?: Readonly<Record<string, unknown>>
  ) {
    this.#store = store
    store.track(this)
    this.#binding = binding
    this.#row = row
    this.#target = store.runtime().signal<IWatchTarget>({
      entry: undefined,
      previous: undefined,
      missing: undefined
    })
    this.#effect = store.runtime().effect(() => this.#track())
  }

  /** Tracked, side-effect-free read of the current snapshot. */
  read(): IResourceSnapshot {
    /** Current target. */
    const target = this.#target.value
    if (target.missing !== undefined)
      return {
        status: ResourceStatus.error,
        error: {
          code: PartHostErrorCode.resourceUnknown,
          message: PartHostErrorText.resourceUnknown(target.missing)
        },
        refreshing: false
      }
    /** Snapshot of the current entry. */
    const snapshot = target.entry?.snapshot.value ?? IDLE
    /** Snapshot kept from the previous key while the new one loads for the first time. */
    const previous = target.previous
    if (
      previous?.data !== undefined &&
      (snapshot.status === ResourceStatus.loading || snapshot.status === ResourceStatus.idle)
    )
      return { ...previous, refreshing: true }
    return snapshot
  }

  /** Stops the effect and releases the entry; idempotent. */
  release(): void {
    if (this.#released) return
    this.#released = true
    this.#effect.dispose()
    this.#store.untrack(this)
    this.#store.release(this.#target.value.entry)
  }

  /** Effect body: tracked reads of version and parameters, then an untracked switch. */
  #track(): void {
    /** Version of the resource id. */
    const version = this.#store.version(this.#binding.$resource)
    /** Resolved parameters. */
    const params = this.#store.resolveParams(this.#binding.params, this.#row)
    this.#store.runtime().untracked(() => this.#switch(version, params))
  }

  /** Moves to the entry of the current parameters, keeping the old snapshot on a key change. */
  #switch(version: number, params: unknown): void {
    if (this.#released) return
    /** Current target. */
    const current = this.#target.value
    /** Whether the definition changed generation since the last switch. */
    const regenerated = version !== this.#version
    this.#version = version
    /** Entry for the new parameters, or undefined when the resource is missing. */
    const next = this.#store.acquire(this.#binding.$resource, params)
    if (next === undefined) {
      this.#store.release(current.entry)
      this.#target.value = {
        entry: undefined,
        previous: undefined,
        missing: this.#binding.$resource
      }
      return
    }
    if (next === current.entry) {
      this.#store.release(next)
      return
    }
    /** Snapshot shown before the switch, kept while the new entry has nothing. */
    const shown = current.entry?.snapshot.value
    this.#store.release(current.entry)
    this.#target.value = {
      entry: next,
      previous: regenerated || shown?.data === undefined ? undefined : shown,
      missing: undefined
    }
  }
}

/**
 * Resource store of one host. Entries by resource id and key, an index from tags to entries and
 * from ids to entries, and a version signal per resource id that changes on every generation change
 * of the definition.
 */
export class ResourceStore implements IResourceHandle {
  /** Host services. */
  readonly #host: IResourceStoreHost
  /** Entries by composite key. */
  readonly #entries = new Map<string, ResourceEntry>()
  /** Entries by resource id. */
  readonly #byId = new Map<string, Set<ResourceEntry>>()
  /** Entries by tag. */
  readonly #byTag = new Map<string, Set<ResourceEntry>>()
  /** Version signals by resource id. */
  readonly #versions = new Map<string, IReactiveSignal<number>>()
  /** Live watches, released when the store is disposed. */
  readonly #watches = new Set<ResourceWatch>()
  /** Abort controllers of running commands, aborted when the store is disposed. */
  readonly #commands = new Set<AbortController>()
  /** Whether the store was disposed. */
  #disposed = false

  /** Binds the store to its host services. */
  constructor(host: IResourceStoreHost) {
    this.#host = host
  }

  /** Reactive runtime of the host. */
  runtime(): IRuntime {
    return this.#host.runtime()
  }

  /** Reports an error through the host's error channel. */
  report(error: unknown): void {
    this.#host.report(error)
  }

  /** Watches a binding; see `ResourceWatch`. */
  watch(binding: IResourceBinding, row?: Readonly<Record<string, unknown>>): IResourceWatch {
    this.#assertOpen()
    return new ResourceWatch(this, binding, row)
  }

  /** Result of one load of an entry, holding a temporary subscription while it runs. */
  async query(id: string, params: unknown): Promise<never> {
    this.#assertOpen()
    /** Entry held for the query. */
    const entry = this.acquire(id, params)
    if (entry === undefined) throw this.#unknown(id)
    try {
      return (await this.#settled(entry)) as never
    } finally {
      this.release(entry)
    }
  }

  /**
   * Result of an entry's load. When the awaited load fails because a newer load replaced it (a
   * refresh or invalidation), the newer load is awaited instead; a deleted entry rethrows.
   */
  async #settled(entry: ResourceEntry): Promise<unknown> {
    /** Load being awaited. */
    let promise = entry.promise()
    for (;;) {
      try {
        return await promise
      } catch (error) {
        /** Newer load of the entry, when one replaced the failed one. */
        const next = entry.dead ? undefined : entry.current
        if (next === undefined || next === promise) throw error
        promise = next
      }
    }
  }

  /** Records a live watch. */
  track(watch: ResourceWatch): void {
    this.#watches.add(watch)
  }

  /** Forgets a released watch. */
  untrack(watch: ResourceWatch): void {
    this.#watches.delete(watch)
  }

  /** Refreshes one entry, or every entry of a resource when no parameters are given. */
  refresh(id: string, params?: unknown): void {
    /** Runtime of the resource. */
    const resource = this.#resource(id)
    if (params === undefined) {
      for (const entry of this.#byId.get(id) ?? []) entry.start()
      return
    }
    this.#entries.get(this.#keyOf(id, resource, params))?.start()
  }

  /** Runs a command, then refreshes the entries whose tags meet its invalidation tags. */
  async run(id: string, command: string, args: unknown): Promise<unknown> {
    this.#assertOpen()
    /** Runtime of the resource. */
    const resource = this.#resource(id)
    /** Runtime command. */
    const spec = resource.definition.commands[command]
    if (spec === undefined)
      throw createPartHostError(
        PartHostErrorCode.resourceCommandUnknown,
        PartHostErrorText.resourceCommandUnknown(id, command)
      )
    /** Validated arguments. */
    const value = await validateRuntimeArgs(spec.args, args, `${id} ${command}`)
    /** Controller of this run, aborted when the store is disposed. */
    const controller = new AbortController()
    this.#commands.add(controller)
    /** Command result; a rejection propagates unchanged and invalidates nothing. */
    let result: unknown
    try {
      result = await spec.run(value, {
        features: resource.features as never,
        signal: controller.signal
      })
    } finally {
      this.#commands.delete(controller)
    }
    if (!this.#disposed) this.invalidate(spec.invalidates?.(value, result) ?? [resourceName(id)])
    return result
  }

  /** Refreshes every entry indexed under any of the tags. */
  invalidate(tags: readonly string[]): void {
    /** Entries hit by the tags, each once. */
    const hit = new Set<ResourceEntry>()
    for (const tag of tags) for (const entry of this.#byTag.get(tag) ?? []) hit.add(entry)
    for (const entry of hit) entry.start()
  }

  /** Original error of an entry's latest failure. */
  errorOf(id: string, params: unknown): unknown {
    /** Runtime of the resource. */
    const resource = this.#resource(id)
    return this.#entries.get(this.#keyOf(id, resource, params))?.error
  }

  /** Tracked version of a resource id. */
  version(id: string): number {
    return this.#versionSignal(id).value
  }

  /** Resolves parameter bindings: tracked state and derive reads, row fields, literals. */
  resolveParams(
    params: Readonly<Record<string, unknown>> | undefined,
    row: Readonly<Record<string, unknown>> | undefined
  ): Readonly<Record<string, unknown>> {
    /** Resolved parameters in written order. */
    const resolved: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(params ?? {}))
      resolved[name] = this.#resolveValue(value, row)
    return resolved
  }

  /**
   * Subscribes to the entry of a resource and parameters, creating and starting it when new.
   * Returns undefined when the resource is not in the catalog.
   */
  acquire(id: string, params: unknown): ResourceEntry | undefined {
    if (this.#disposed) return undefined
    /** Runtime of the resource. */
    const resource = this.#host.resource(id)
    if (resource === undefined) return undefined
    /** Composite key. */
    const key = this.#keyOf(id, resource, params)
    /** Existing entry. */
    let entry = this.#entries.get(key)
    if (entry === undefined) {
      entry = new ResourceEntry(this, id, key, params, resource)
      this.#entries.set(key, entry)
      this.#add(this.#byId, id, entry)
      this.retag(entry, [])
      entry.subscribers += 1
      entry.start()
      return entry
    }
    entry.subscribers += 1
    return entry
  }

  /** Drops one subscription; the last one aborts the load and deletes the entry. */
  release(entry: ResourceEntry | undefined): void {
    if (entry === undefined || entry.dead) return
    entry.subscribers -= 1
    if (entry.subscribers <= 0) this.#delete(entry)
  }

  /** Re-indexes an entry under its default tag plus the given extra tags. */
  retag(entry: ResourceEntry, extra: readonly string[]): void {
    for (const tag of entry.tags) this.#remove(this.#byTag, tag, entry)
    /** New tag set. */
    const tags = new Set([resourceName(entry.id), ...extra])
    entry.tags = tags
    for (const tag of tags) this.#add(this.#byTag, tag, entry)
  }

  /**
   * Handles a generation change of resource ids: aborts and deletes their entries and bumps their
   * versions so watches re-subscribe with the current definition.
   */
  changed(ids: ReadonlySet<string>): void {
    for (const id of ids) {
      for (const entry of this.#byId.get(id) ?? []) this.#delete(entry)
      /** Version signal of the id. */
      const signal = this.#versionSignal(id)
      signal.value += 1
    }
  }

  /**
   * Releases every watch, aborts every running command and load and deletes every entry; later
   * calls throw HOST_DISPOSED.
   */
  dispose(): void {
    this.#disposed = true
    for (const watch of this.#watches) watch.release()
    for (const controller of this.#commands) controller.abort()
    this.#commands.clear()
    for (const entry of this.#entries.values()) this.#delete(entry)
  }

  /** Deletes an entry from every index and aborts its load. */
  #delete(entry: ResourceEntry): void {
    entry.kill()
    this.#entries.delete(entry.key)
    this.#remove(this.#byId, entry.id, entry)
    for (const tag of entry.tags) this.#remove(this.#byTag, tag, entry)
  }

  /** Removes an entry from a set index, dropping the key once its set is empty. */
  #remove(index: Map<string, Set<ResourceEntry>>, key: string, entry: ResourceEntry): void {
    /** Set under the key. */
    const set = index.get(key)
    if (set === undefined) return
    set.delete(entry)
    if (set.size === 0) index.delete(key)
  }

  /** Composite key of an entry. */
  #keyOf(id: string, resource: IResourceRuntime, params: unknown): string {
    return `${id}${KEY_SEPARATOR}${(resource.definition.key ?? defaultKey)(params)}`
  }

  /** Runtime of a resource id, or RESOURCE_UNKNOWN. */
  #resource(id: string): IResourceRuntime {
    this.#assertOpen()
    /** Runtime from the catalog. */
    const resource = this.#host.resource(id)
    if (resource === undefined) throw this.#unknown(id)
    return resource
  }

  /** RESOURCE_UNKNOWN error of an id. */
  #unknown(id: string): Error {
    return createPartHostError(
      PartHostErrorCode.resourceUnknown,
      PartHostErrorText.resourceUnknown(id)
    )
  }

  /** Throws HOST_DISPOSED after dispose. */
  #assertOpen(): void {
    if (this.#disposed)
      throw createPartHostError(PartHostErrorCode.hostDisposed, PartHostErrorText.hostDisposed)
  }

  /** Version signal of an id, created on first use. */
  #versionSignal(id: string): IReactiveSignal<number> {
    /** Existing signal. */
    let signal = this.#versions.get(id)
    if (signal === undefined) {
      signal = this.runtime().signal(0)
      this.#versions.set(id, signal)
    }
    return signal
  }

  /** Resolves one parameter value. */
  #resolveValue(value: unknown, row: Readonly<Record<string, unknown>> | undefined): unknown {
    if (typeof value !== 'object' || value === null) return value
    /** Binding fields. */
    const binding = value as { $state?: unknown; $derive?: unknown; $row?: unknown }
    if (typeof binding.$state === 'string') return this.#host.readState(binding.$state)
    if (typeof binding.$derive === 'string') return this.#host.derived(binding.$derive)
    if (typeof binding.$row === 'string') return row?.[binding.$row]
    return value
  }

  /** Adds an entry to a set index. */
  #add(index: Map<string, Set<ResourceEntry>>, key: string, entry: ResourceEntry): void {
    /** Set under the key. */
    const set = index.get(key) ?? new Set<ResourceEntry>()
    set.add(entry)
    index.set(key, set)
  }
}
