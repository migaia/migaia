import { ResourceStatus } from '@migaia/part-contract'
import type { IReactiveSignal, IRuntime } from '@migaia/reactive'
import { comparatorFor, compareValues } from './default-store.ts'
import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import {
  isThenable,
  type IStateStatus,
  type IStateStore,
  type IStateStoreContext
} from './state-store.ts'

/** Host services a namespace slot uses: the reactive runtime, diagnostics and the closed flag. */
export type ISlotServices = {
  readonly runtime: IRuntime
  readonly report: (error: unknown) => void
  readonly closed: () => boolean
}

/**
 * `create` progress of one generation: `pending` while a thenable is unsettled, `resolved` with a
 * handle, `rejected` after the thenable rejected.
 */
export const GenerationState = {
  pending: 'pending',
  resolved: 'resolved',
  rejected: 'rejected'
} as const

/** One generation state. */
export type GenerationState = (typeof GenerationState)[keyof typeof GenerationState]

/**
 * Routing mode of a namespace, derived from its live generations: `target` (the newest resolved
 * generation serves it), `registering` (only pending generations) or `unregistered` (none, or only
 * rejected ones).
 */
export const SlotMode = {
  target: 'target',
  registering: 'registering',
  unregistered: 'unregistered'
} as const

/** One routing mode. */
export type SlotMode = (typeof SlotMode)[keyof typeof SlotMode]

/** Status of a path in the default store and of every ready path. */
export const READY_STATUS: IStateStatus = Object.freeze({
  status: ResourceStatus.ready,
  refreshing: false
})
/** Status of a path whose namespace has no generation. */
const IDLE_STATUS: IStateStatus = Object.freeze({ status: ResourceStatus.idle, refreshing: false })
/** Status of a path waiting for its first value. */
const LOADING_STATUS: IStateStatus = Object.freeze({
  status: ResourceStatus.loading,
  refreshing: false
})

/** True when two status snapshots are the same; status signals use it to skip equal writes. */
function sameStatus(previous: IStateStatus, next: IStateStatus): boolean {
  return (
    previous.status === next.status &&
    previous.refreshing === next.refreshing &&
    previous.error?.code === next.error?.code &&
    previous.error?.message === next.error?.message
  )
}

/** Serializable error snapshot of a failure (code when it carries one). */
function errorSnapshot(error: unknown): NonNullable<IStateStatus['error']> {
  /** Code property, if any. */
  const code = (error as { readonly code?: unknown } | null | undefined)?.code
  /** Message of the failure. */
  const message = error instanceof Error ? error.message : String(error)
  return typeof code === 'string' ? { code, message } : { message }
}

/**
 * One plugin generation's instance of a store: its `create` progress, handle, context and release
 * state. `context` is what the store's `create` receives; its calls are ignored after release.
 */
export class StoreGeneration {
  /** Plugin name owning the generation. */
  readonly plugin: string
  /** Install order across the host; newer generations have larger numbers. */
  readonly order: number
  /** Store definition of this generation. */
  readonly store: IStateStore<unknown>
  /** Namespace slot the generation serves. */
  readonly slot: NamespaceSlot
  /** Aborted when the generation ends; exposed as `context.signal`. */
  readonly controller = new AbortController()
  /** Context handed to `create`. */
  readonly context: IStateStoreContext
  /** `create` progress. */
  state: GenerationState = GenerationState.pending
  /** Handle once resolved. */
  handle: unknown
  /** Rejection of `create`, kept as the `load` cause when only rejected generations remain. */
  error: unknown
  /** True once the generation ended (abort, rollback or host close). */
  dead = false
  /** True once `dispose` was called for the handle. */
  released = false
  /** Removes the store subscription, when one was made. */
  unsubscribe: (() => void) | undefined

  /** Builds the generation and the context its store's `create` receives. */
  constructor(plugin: string, order: number, store: IStateStore<unknown>, slot: NamespaceSlot) {
    this.plugin = plugin
    this.order = order
    this.store = store
    this.slot = slot
    this.context = {
      invalidate: (keys) => this.slot.invalidate(this, keys),
      report: (error) => this.slot.reportFrom(this, error),
      runtime: slot.services.runtime,
      signal: this.controller.signal
    }
  }
}

/** One `load` call waiting for its qualifying read. */
type ILoadWaiter = {
  /** Read generation the waiter counts reads of. */
  readGen: number
  /** Sets in flight at the call (current read generation) that must settle first. */
  readonly sets: Set<object>
  /** True once attached to a read. */
  attached: boolean
  readonly resolve: (value: unknown) => void
  readonly reject: (error: unknown) => void
}

/** One issued `get`. */
type IReadRequest = {
  readonly readGen: number
  readonly compare: boolean
  readonly generation: StoreGeneration
  readonly waiters: ILoadWaiter[]
}

/** One `seed` waiting for an asynchronous `has`. */
type IPendingSeed = { readonly key: string; readonly readGen: number; cancelled: boolean }

/**
 * Tracking cell of one read path: a version signal (the reactive edge), a status signal, the cached
 * value and the bookkeeping of in-flight reads, writes and `load` waiters.
 */
class ReadCell {
  /** Key inside the namespace. */
  readonly key: string
  /** Bumped when the cached value changes. */
  readonly version: IReactiveSignal<number>
  /** Status snapshot; equal snapshots do not notify. */
  readonly status: IReactiveSignal<IStateStatus>
  /** Cached value. */
  value: unknown = undefined
  /** True once a read stored a value. */
  has = false
  /** True when the next read is not compared (first read of the path or of a read generation). */
  fresh = true
  /** Read in flight in the current read generation. */
  inflight: IReadRequest | undefined
  /** True when a compare request arrived while a read was in flight. */
  reread = false
  /** `load` calls waiting on this path. */
  waiters: ILoadWaiter[] = []

  /** Creates the signals with the given initial status and value. */
  constructor(runtime: IRuntime, key: string, status: IStateStatus) {
    this.key = key
    this.version = runtime.signal(0)
    this.status = runtime.signal(status, { equals: sameStatus })
  }
}

/**
 * State of one external namespace: the live generations of its owning plugin, the routing mode
 * derived from them, the read generation and the tracking cells of every read path.
 */
export class NamespaceSlot {
  /** Namespace served. */
  readonly namespace: string
  /** Host services. */
  readonly services: ISlotServices
  /** Live generations in install order. */
  readonly #generations = new Set<StoreGeneration>()
  /** Plugin holding the namespace while any of its generations lives. */
  #owner: string | undefined
  /** Current routing mode. */
  #mode: SlotMode = SlotMode.unregistered
  /** Generation serving the namespace in `target` mode. */
  #target: StoreGeneration | undefined
  /** Read generation; bumped on every registration change. */
  #readGen = 0
  /** Cells by key. */
  readonly #cells = new Map<string, ReadCell>()
  /** Keys queued by `invalidate`/listeners for the next emission. */
  #pending = new Set<string>()
  /** True when the next emission compares every read key. */
  #pendingAll = false
  /** True while an emission microtask is scheduled. */
  #scheduled = false
  /** True once the current unregistered period reported STATE_NAMESPACE_UNKNOWN. */
  #reportedUnknown = false
  /** Keys written through the host, for `seed` without `has`. */
  readonly #written = new Set<string>()
  /** Seeds waiting for an asynchronous `has`. */
  readonly #seeds = new Set<IPendingSeed>()
  /**
   * Tokens of writes in flight in the current read generation, by key. Kept per key rather than per
   * read cell, so a `load` waits for writes to a path that was never read.
   */
  readonly #sets = new Map<string, Set<object>>()

  /** Creates an unregistered slot. */
  constructor(namespace: string, services: ISlotServices) {
    this.namespace = namespace
    this.services = services
  }

  /** Current routing mode. */
  get mode(): SlotMode {
    return this.#mode
  }

  /** Owner plugin name, or `undefined` while no generation lives. */
  get owner(): string | undefined {
    return this.#owner
  }

  /** Handle of the serving generation; only meaningful in `target` mode. */
  handle(): unknown {
    return this.#target?.handle
  }

  /** Full path of a key, for messages. */
  #path(key: string): string {
    return key === '' ? this.namespace : `${this.namespace}.${key}`
  }

  /** STATE_NAMESPACE_UNKNOWN for this namespace, with an optional cause. */
  unknown(cause?: unknown): Error {
    return createPartHostError(
      PartHostErrorCode.stateNamespaceUnknown,
      PartHostErrorText.stateNamespaceUnknown(this.namespace),
      cause
    )
  }

  // ── generations ────────────────────────────────────────────────────────────────────────────

  /** Adds a live generation for its plugin and re-derives the routing. */
  addGeneration(generation: StoreGeneration): void {
    this.#generations.add(generation)
    this.#owner = generation.plugin
    if (generation.state === GenerationState.resolved) this.#subscribe(generation)
    this.derive()
  }

  /** Records a resolved `create`; a dead generation releases the late handle instead. */
  resolved(generation: StoreGeneration, handle: unknown): void {
    if (generation.dead) {
      this.release(generation, handle)
      return
    }
    generation.state = GenerationState.resolved
    generation.handle = handle
    if (!this.#generations.has(generation)) return
    this.#subscribe(generation)
    this.derive()
  }

  /** Records a rejected `create` of a live generation and reports it. */
  rejected(generation: StoreGeneration, error: unknown): void {
    if (generation.dead) return
    generation.state = GenerationState.rejected
    generation.error = error
    this.services.report(
      createPartHostError(
        PartHostErrorCode.stateStoreCreateFailed,
        PartHostErrorText.stateStoreCreateFailed(this.namespace),
        error
      )
    )
    if (this.#generations.has(generation)) this.derive()
  }

  /** Subscribes to a resolved generation's store when it offers `subscribe`. */
  #subscribe(generation: StoreGeneration): void {
    if (generation.store.subscribe === undefined || generation.unsubscribe !== undefined) return
    generation.unsubscribe = generation.store.subscribe(generation.handle, (keys) =>
      this.invalidate(generation, keys)
    )
  }

  /**
   * Ends a generation: aborts its context signal, unsubscribes, releases its handle and re-derives
   * the routing (unless the host closed). Calling it twice does nothing.
   */
  endGeneration(generation: StoreGeneration): void {
    if (generation.dead) return
    generation.dead = true
    generation.controller.abort()
    generation.unsubscribe?.()
    generation.unsubscribe = undefined
    this.#generations.delete(generation)
    if (this.#generations.size === 0) this.#owner = undefined
    if (generation.state === GenerationState.resolved) this.release(generation, generation.handle)
    if (!this.services.closed()) this.derive()
  }

  /**
   * Calls the store's `dispose` once for a handle. A synchronous throw or a rejection is reported
   * as STATE_STORE_DISPOSE_FAILED with the failure on `cause`.
   */
  release(generation: StoreGeneration, handle: unknown): void {
    if (generation.released) return
    generation.released = true
    if (generation.store.dispose === undefined) return
    /** Release result. */
    let result: unknown
    try {
      result = generation.store.dispose(handle)
    } catch (error) {
      this.#reportDispose(error)
      return
    }
    if (isThenable(result)) result.then(undefined, (error: unknown) => this.#reportDispose(error))
  }

  /** Reports a release failure. */
  #reportDispose(error: unknown): void {
    this.services.report(
      createPartHostError(
        PartHostErrorCode.stateStoreDisposeFailed,
        PartHostErrorText.stateStoreDisposeFailed(this.namespace),
        error
      )
    )
  }

  /** Error handed in by a store; ignored after the generation ended. */
  reportFrom(generation: StoreGeneration, error: unknown): void {
    if (!generation.dead && !this.services.closed()) this.services.report(error)
  }

  /** Mode and serving generation derived from the live generations. */
  #derived(): { readonly mode: SlotMode; readonly target: StoreGeneration | undefined } {
    /** Newest resolved generation. */
    let target: StoreGeneration | undefined
    /** True when some generation is still pending. */
    let pending = false
    for (const generation of this.#generations) {
      if (generation.state === GenerationState.resolved) target = generation
      else if (generation.state === GenerationState.pending) pending = true
    }
    if (target !== undefined) return { mode: SlotMode.target, target }
    return { mode: pending ? SlotMode.registering : SlotMode.unregistered, target: undefined }
  }

  /** Re-derives the routing; a change of mode or serving generation is a registration change. */
  derive(): void {
    /** New routing. */
    const next = this.#derived()
    if (next.mode === this.#mode && next.target === this.#target) return
    this.#mode = next.mode
    this.#target = next.target
    this.#registrationChanged()
  }

  /** Cause of a `load` rejection: the last rejected `create` when only rejected generations live. */
  #rejectionCause(): unknown {
    /** Last rejection seen. */
    let cause: unknown
    for (const generation of this.#generations) {
      if (generation.state !== GenerationState.rejected) return undefined
      cause = generation.error
    }
    return cause
  }

  /**
   * Opens a new read generation: discards in-flight reads, writes and seeds, then updates every
   * cell in one batch for the new mode and bumps its version. In `target` mode each cell reads the
   * new generation once, uncompared.
   */
  #registrationChanged(): void {
    this.#readGen += 1
    for (const seed of this.#seeds) seed.cancelled = true
    this.#seeds.clear()
    for (const cell of this.#cells.values()) {
      cell.inflight = undefined
      cell.reread = false
      cell.fresh = true
    }
    this.#sets.clear()
    if (this.#mode === SlotMode.unregistered) this.#reportedUnknown = false
    if (this.services.closed()) return
    this.services.runtime.batch(() => {
      for (const cell of this.#cells.values()) this.#changeCell(cell)
    })
  }

  /** Applies a registration change to one cell. */
  #changeCell(cell: ReadCell): void {
    if (this.#mode === SlotMode.unregistered) {
      cell.value = undefined
      cell.has = false
      cell.status.value = IDLE_STATUS
      this.#rejectWaiters(cell, this.unknown(this.#rejectionCause()))
    } else {
      cell.status.value = cell.has
        ? { status: cell.status.peek().status, refreshing: true }
        : LOADING_STATUS
      for (const waiter of cell.waiters) {
        waiter.readGen = this.#readGen
        waiter.sets.clear()
        waiter.attached = false
      }
      if (this.#mode === SlotMode.target) this.#issue(cell)
    }
    this.#bump(cell)
  }

  /** Rejects and drops every waiter of a cell. */
  #rejectWaiters(cell: ReadCell, error: unknown): void {
    /** Waiters to settle. */
    const waiters = cell.waiters
    cell.waiters = []
    for (const waiter of waiters) waiter.reject(error)
  }

  /** Number of writes in flight for a key in the current read generation. */
  #writesOf(key: string): number {
    return this.#sets.get(key)?.size ?? 0
  }

  /** Bumps a cell's version. */
  #bump(cell: ReadCell): void {
    cell.version.value = cell.version.peek() + 1
  }

  // ── reads ──────────────────────────────────────────────────────────────────────────────────

  /**
   * Cell of a key. A new cell in `target` mode reads the store once, uncompared; the outcome
   * becomes the cell's initial value and status without any signal write, so a first read inside a
   * derive or render is safe. An asynchronous first read stays in flight with `loading` status.
   */
  #cell(key: string): ReadCell {
    /** Existing cell. */
    const existing = this.#cells.get(key)
    if (existing !== undefined) return existing
    if (this.#mode !== SlotMode.target)
      return this.#addCell(key, this.#mode === SlotMode.unregistered ? IDLE_STATUS : LOADING_STATUS)
    /** Serving generation. */
    const generation = this.#target as StoreGeneration
    /** Store result. */
    let result: unknown
    try {
      result = generation.store.get(generation.handle, key)
    } catch (error) {
      this.#reportRead(key, error)
      return this.#addCell(key, {
        status: ResourceStatus.error,
        refreshing: false,
        error: errorSnapshot(error)
      })
    }
    if (!isThenable(result)) {
      /** Cell holding the first value. */
      const cell = this.#addCell(key, READY_STATUS)
      cell.value = result
      cell.has = true
      cell.fresh = false
      return cell
    }
    /** Cell waiting for the first value. */
    const cell = this.#addCell(key, LOADING_STATUS)
    cell.fresh = false
    /** The first read, in flight. */
    const request: IReadRequest = {
      readGen: this.#readGen,
      compare: false,
      generation,
      waiters: []
    }
    cell.inflight = request
    result.then(
      (value) => this.#settled(cell, request, true, value),
      (error: unknown) => this.#settled(cell, request, false, error)
    )
    return cell
  }

  /** Adds a cell with an initial status and no read. */
  #addCell(key: string, status: IStateStatus): ReadCell {
    /** New cell. */
    const cell = new ReadCell(this.services.runtime, key, status)
    this.#cells.set(key, cell)
    return cell
  }

  /** Reports a failed read of a key. */
  #reportRead(key: string, error: unknown): void {
    this.services.report(
      createPartHostError(
        PartHostErrorCode.stateStoreReadFailed,
        PartHostErrorText.stateStoreReadFailed(this.#path(key)),
        error
      )
    )
  }

  /** Tracked read of the cached value; creates the cell on first read. */
  read(key: string): unknown {
    /** Cell of the key. */
    const cell = this.#cell(key)
    void cell.version.value
    return cell.value
  }

  /**
   * Tracked read for rendering, derives and resource parameters: never throws; an unregistered
   * namespace reports STATE_NAMESPACE_UNKNOWN once per unregistered period and reads `undefined`.
   */
  readShared(key: string): unknown {
    if (this.#mode === SlotMode.unregistered && !this.#reportedUnknown) {
      this.#reportedUnknown = true
      this.services.report(this.unknown())
    }
    return this.read(key)
  }

  /** Tracked status of a key; creates the cell (and reads it) like a first read. */
  status(key: string): IStateStatus {
    return this.#cell(key).status.value
  }

  /** Compare request: reads now, or marks a re-read while a read is in flight. */
  #request(cell: ReadCell): void {
    if (this.#mode !== SlotMode.target) return
    if (cell.inflight !== undefined) {
      cell.reread = true
      return
    }
    this.#issue(cell)
  }

  /** Issues one `get` for a cell, attaching every `load` waiter it qualifies for. */
  #issue(cell: ReadCell): void {
    /** Serving generation. */
    const generation = this.#target as StoreGeneration
    /** This request. */
    const request: IReadRequest = {
      readGen: this.#readGen,
      compare: !cell.fresh,
      generation,
      waiters: []
    }
    cell.fresh = false
    for (const waiter of cell.waiters)
      if (!waiter.attached && waiter.readGen === this.#readGen && waiter.sets.size === 0) {
        waiter.attached = true
        request.waiters.push(waiter)
      }
    /** Store result. */
    let result: unknown
    try {
      result = generation.store.get(generation.handle, cell.key)
    } catch (error) {
      this.#failed(cell, request, error)
      return
    }
    if (!isThenable(result)) {
      this.#apply(cell, request, result)
      return
    }
    cell.inflight = request
    result.then(
      (value) => this.#settled(cell, request, true, value),
      (error: unknown) => this.#settled(cell, request, false, error)
    )
  }

  /** Settles an asynchronous read; stale results (new read generation, release, close) are dropped. */
  #settled(cell: ReadCell, request: IReadRequest, ok: boolean, outcome: unknown): void {
    try {
      if (
        cell.inflight !== request ||
        request.readGen !== this.#readGen ||
        request.generation.dead ||
        this.services.closed()
      )
        return
      cell.inflight = undefined
      if (ok) this.#apply(cell, request, outcome)
      else this.#failed(cell, request, outcome)
    } catch (error) {
      this.services.report(error)
    }
  }

  /**
   * Stores a read result: uncompared reads store it directly, compared reads store it only when the
   * comparator reports a change. Then resolves the request's waiters and runs a queued re-read.
   */
  #apply(cell: ReadCell, request: IReadRequest, value: unknown): void {
    /** Whether the value changes. */
    const changed =
      !request.compare ||
      !compareValues(
        comparatorFor(request.generation.store, cell.key),
        cell.value,
        value,
        cell.key,
        this.#path(cell.key),
        this.services.report
      )
    /** Status after the read. */
    const status: IStateStatus =
      this.#writesOf(cell.key) > 0
        ? { status: ResourceStatus.ready, refreshing: true }
        : READY_STATUS
    this.services.runtime.batch(() => {
      if (changed) {
        cell.value = value
        cell.has = true
        this.#bump(cell)
      }
      cell.status.value = status
    })
    this.#finish(cell, request, true, value)
  }

  /** Records a failed read: error status, cached value kept, reported every time. */
  #failed(cell: ReadCell, request: IReadRequest, error: unknown): void {
    cell.status.value = {
      status: ResourceStatus.error,
      refreshing: false,
      error: errorSnapshot(error)
    }
    this.#reportRead(cell.key, error)
    this.#finish(cell, request, false, error)
  }

  /** Settles the request's waiters, then runs a queued re-read. */
  #finish(cell: ReadCell, request: IReadRequest, ok: boolean, outcome: unknown): void {
    if (request.waiters.length > 0) {
      /** Waiters this read settles. */
      const settled = new Set(request.waiters)
      cell.waiters = cell.waiters.filter((waiter) => !settled.has(waiter))
      for (const waiter of request.waiters)
        if (ok) waiter.resolve(outcome)
        else waiter.reject(outcome)
    }
    if (cell.reread) {
      cell.reread = false
      this.#request(cell)
    }
  }

  /**
   * Resolves with the value of the first read issued after this call and after every write in
   * flight at the call has settled; rejects with that read's failure, or with
   * STATE_NAMESPACE_UNKNOWN when the namespace becomes unregistered meanwhile.
   */
  load(key: string): Promise<unknown> {
    /** Whether the cell already existed. */
    const existing = this.#cells.get(key)
    /** Cell of the key, created without reading so the waiter is attached first. */
    const cell = existing ?? this.#cellWithoutRead(key)
    return new Promise((resolve, reject) => {
      cell.waiters.push({
        readGen: this.#readGen,
        sets: new Set(this.#sets.get(key)),
        attached: false,
        resolve,
        reject
      })
      if (this.#mode !== SlotMode.target) return
      if (this.#writesOf(key) === 0) this.#request(cell)
    })
  }

  /** New cell with no read issued yet. */
  #cellWithoutRead(key: string): ReadCell {
    return this.#addCell(key, this.#mode === SlotMode.unregistered ? IDLE_STATUS : LOADING_STATUS)
  }

  // ── writes ─────────────────────────────────────────────────────────────────────────────────

  /**
   * Writes through the serving store. A synchronous `set` compares the written key and the keys it
   * returns, at once and in one batch; an asynchronous one marks the path refreshing and compares
   * when it settles. A rejection reports STATE_STORE_WRITE_FAILED and leaves the cache unchanged.
   */
  write(key: string, value: unknown): void {
    if (this.#mode !== SlotMode.target) throw this.unknown()
    this.#written.add(key)
    for (const seed of this.#seeds) if (seed.key === key) seed.cancelled = true
    /** Serving generation. */
    const generation = this.#target as StoreGeneration
    /** Store result. */
    const result = generation.store.set(generation.handle, key, value)
    if (!isThenable(result)) {
      this.#compareAfterWrite(key, result as readonly string[] | void)
      return
    }
    /** Token of this write. */
    const token = {}
    /** Read generation of the write. */
    const readGen = this.#readGen
    /** Writes in flight for the key. */
    const tokens = this.#sets.get(key) ?? new Set<object>()
    tokens.add(token)
    this.#sets.set(key, tokens)
    /** Cell of the written key, if read. */
    const cell = this.#cells.get(key)
    if (cell !== undefined) cell.status.value = { ...cell.status.peek(), refreshing: true }
    result.then(
      (keys) => this.#writeSettled(key, token, readGen, generation, true, keys),
      (error: unknown) => this.#writeSettled(key, token, readGen, generation, false, error)
    )
  }

  /** Compares the written key and the keys `set` returned, in one batch. */
  #compareAfterWrite(key: string, keys: readonly string[] | void): void {
    this.services.runtime.batch(() => {
      /** Cell of the written key. */
      const cell = this.#cells.get(key)
      if (cell !== undefined) this.#request(cell)
      for (const other of Array.isArray(keys) ? keys : []) {
        /** Cell of a related key. */
        const related = this.#cells.get(other)
        if (related !== undefined) this.#request(related)
      }
    })
  }

  /** Settles an asynchronous write; stale results are dropped. */
  #writeSettled(
    key: string,
    token: object,
    readGen: number,
    generation: StoreGeneration,
    ok: boolean,
    outcome: unknown
  ): void {
    try {
      if (readGen !== this.#readGen || generation.dead || this.services.closed()) return
      /** Cell of the written key, if read. */
      const cell = this.#cells.get(key)
      /** Writes in flight for the key. */
      const tokens = this.#sets.get(key)
      tokens?.delete(token)
      if (tokens?.size === 0) this.#sets.delete(key)
      if (cell !== undefined) for (const waiter of cell.waiters) waiter.sets.delete(token)
      if (ok) {
        this.#compareAfterWrite(key, outcome as readonly string[] | void)
        return
      }
      if (cell !== undefined)
        cell.status.value = {
          status: ResourceStatus.error,
          refreshing: this.#writesOf(key) > 0,
          error: errorSnapshot(outcome)
        }
      this.services.report(
        createPartHostError(
          PartHostErrorCode.stateStoreWriteFailed,
          PartHostErrorText.stateStoreWriteFailed(this.#path(key)),
          outcome
        )
      )
    } catch (error) {
      this.services.report(error)
    }
  }

  /**
   * Writes only when the store reports the key absent (`has`), or, without `has`, when the host
   * never wrote it. An asynchronous `has` is cancelled by any host write to the key or a new read
   * generation before it settles.
   */
  seed(key: string, value: unknown): void {
    if (this.#mode !== SlotMode.target) throw this.unknown()
    /** Serving generation. */
    const generation = this.#target as StoreGeneration
    if (generation.store.has === undefined) {
      if (!this.#written.has(key)) this.write(key, value)
      return
    }
    /** Store answer. */
    const present = generation.store.has(generation.handle, key)
    if (!isThenable(present)) {
      if (present !== true) this.write(key, value)
      return
    }
    /** Pending seed. */
    const seed: IPendingSeed = { key, readGen: this.#readGen, cancelled: false }
    this.#seeds.add(seed)
    present.then(
      (answer) => this.#seeded(seed, generation, true, answer, value),
      (error: unknown) => this.#seeded(seed, generation, false, error, value)
    )
  }

  /** Settles a pending seed. */
  #seeded(
    seed: IPendingSeed,
    generation: StoreGeneration,
    ok: boolean,
    outcome: unknown,
    value: unknown
  ): void {
    try {
      this.#seeds.delete(seed)
      if (
        seed.cancelled ||
        seed.readGen !== this.#readGen ||
        generation.dead ||
        this.services.closed()
      )
        return
      if (!ok) {
        this.#reportRead(seed.key, outcome)
        return
      }
      if (outcome !== true) this.write(seed.key, value)
    } catch (error) {
      this.services.report(error)
    }
  }

  // ── outside changes ────────────────────────────────────────────────────────────────────────

  /**
   * Queues keys changed outside the host (all read keys when `keys` is absent) for one emission at
   * the end of the current microtask. Calls from a generation that does not serve the namespace, or
   * after release or close, are ignored.
   */
  invalidate(generation: StoreGeneration, keys: readonly string[] | undefined): void {
    if (generation.dead || generation !== this.#target || this.services.closed()) return
    if (keys === undefined) this.#pendingAll = true
    else for (const key of keys) this.#pending.add(key)
    if (this.#scheduled) return
    this.#scheduled = true
    queueMicrotask(() => this.#emit())
  }

  /** Compares every queued key in one batch; a path's version moves at most once. */
  #emit(): void {
    try {
      this.#scheduled = false
      /** Keys of this emission. */
      const keys = this.#pending
      /** Whether every read key is compared. */
      const all = this.#pendingAll
      this.#pending = new Set()
      this.#pendingAll = false
      if (this.services.closed() || this.#mode !== SlotMode.target) return
      this.services.runtime.batch(() => {
        if (all) for (const cell of this.#cells.values()) this.#request(cell)
        else
          for (const key of keys) {
            /** Cell of the key, if read. */
            const cell = this.#cells.get(key)
            if (cell !== undefined) this.#request(cell)
          }
      })
    } catch (error) {
      this.services.report(error)
    }
  }

  /** Closes the slot: drops in-flight work and rejects waiting `load` calls. */
  close(): void {
    this.#readGen += 1
    for (const seed of this.#seeds) seed.cancelled = true
    this.#seeds.clear()
    for (const cell of this.#cells.values()) {
      cell.inflight = undefined
      this.#rejectWaiters(cell, this.unknown())
    }
  }

  /** Releases every cell signal; called after `close`. */
  disposeCells(): void {
    for (const cell of this.#cells.values()) {
      cell.version.dispose()
      cell.status.dispose()
    }
    this.#cells.clear()
  }
}
