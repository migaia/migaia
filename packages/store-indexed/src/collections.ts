import { defaultRuntime } from '@migaia/reactive'
import type { IDisposable, IReactiveSignal, IRuntime } from '@migaia/reactive'
import type { IMutationGuard } from '@migaia/store-light'
import {
  claimOwnership,
  internalRuntimeOf,
  isRuntimeTracking,
  isAnyRuntimeTracking,
  type IObservable
} from '@migaia/reactive/extension'
import { ReactiveCellPool } from './reactive-cell-pool.js'
import {
  createStoreIndexedError,
  createStoreIndexedRangeError,
  createStoreIndexedTypeError
} from './errors.js'
import { StoreIndexedErrorCode } from './error-code.js'
import { StoreIndexedErrorText } from './error-text.js'
import { runCollectionCallback } from './collection-callback.js'
import { snapshotOwnDescriptors } from '@migaia/utils/object'

const ABSENT = Symbol('observable-collection-absent')

/** Rejects JavaScript values that bypass the typed collection input contracts. */
function assertCollectionInput(value: unknown, allowPrimitiveIterable = false): void {
  if (
    value === null ||
    (typeof value !== 'object' &&
      typeof value !== 'function' &&
      !(allowPrimitiveIterable && typeof value === 'string'))
  ) {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.collectionInput
    )
  }
}

/**
 * Materializes object entries before ownership admission so hostile input cannot leak partial
 * construction.
 */
function readObjectEntries<T extends Record<string, unknown>>(initial: T): [string, unknown][] {
  assertCollectionInput(initial)
  try {
    return Object.keys(initial).map((key) => [key, initial[key]])
  } catch (error) {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.collectionInput,
      { cause: error }
    )
  }
}

/** Materializes iterable input before ownership admission, preserving construction atomicity. */
function materializeIterable<T>(initial: Iterable<T>, allowPrimitiveString = false): T[] {
  assertCollectionInput(initial, allowPrimitiveString)
  let iteratorMethod: unknown
  try {
    iteratorMethod = (initial as { [Symbol.iterator]?: unknown })[Symbol.iterator]
  } catch (error) {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.collectionInput,
      { cause: error }
    )
  }
  if (typeof iteratorMethod !== 'function') {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.collectionInput
    )
  }
  try {
    const iterator = Reflect.apply(iteratorMethod, initial, [])
    return Array.from({ [Symbol.iterator]: () => iterator })
  } catch (error) {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.collectionInput,
      { cause: error }
    )
  }
}

/** Native Map admission is shared by construction and replacement before collection state changes. */
function materializeMap<K, V>(initial: ReadonlyMap<K, V> | Iterable<readonly [K, V]>): Map<K, V> {
  /** Consume the outer iterator once before native entry-shape validation. */
  const entries = materializeIterable(initial)
  try {
    return new Map(entries)
  } catch (error) {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.collectionInput,
      { cause: error }
    )
  }
}

/** Enforces the string-key contract of ObservableObject after JavaScript type erasure. */
function assertObjectKey(key: unknown): asserts key is string {
  if (typeof key !== 'string') {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.objectKey
    )
  }
}

function isTrackingIn(runtime: IRuntime): boolean {
  const tracking = isRuntimeTracking(runtime)
  if (!tracking && isAnyRuntimeTracking()) {
    throw createStoreIndexedError(
      StoreIndexedErrorCode.crossRuntime,
      StoreIndexedErrorText.crossRuntime
    )
  }
  return tracking
}

/** Optional write admission and diagnostic naming shared by all four collection constructors. */
export type IObservableCollectionOptions = {
  /**
   * Synchronous guard called before each public mutation, including no-ops; omitted by default. A
   * failure prevents the outer write or updater from running, but does not undo callback-owned
   * effects. Existing error identities remain intact; other failures receive CALLBACK_FAILED.
   */
  readonly mutationGuard?: IMutationGuard
  /** Diagnostic prefix for nodes and mutation labels; defaults to the collection class name. */
  readonly debugName?: string
}

/**
 * Shared lifecycle for explicit structural collections. These collections never Proxy user objects;
 * all tracked reads and writes go through named methods.
 */
abstract class ObservableCollectionBase implements IDisposable {
  /** Borrowed owner of tracked cells and batches; collection disposal never disposes this Runtime. */
  readonly runtime: IRuntime
  #mutationGuard?: IMutationGuard
  protected readonly debugName: string
  /** Nodes and cell pools share the same collection owner and terminal disposal pass. */
  #nodes = new Set<Pick<IDisposable, 'dispose'>>()
  #disposed = false

  protected constructor(
    runtime: IRuntime,
    options: IObservableCollectionOptions,
    defaultName: string
  ) {
    if (options === null || typeof options !== 'object') {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.optionsObject
      )
    }
    const descriptorSnapshot = snapshotOwnDescriptors(options)
    if (!descriptorSnapshot.ok) {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.optionsObject,
        { cause: descriptorSnapshot.error }
      )
    }
    let mutationGuard: IMutationGuard | undefined
    let debugName: unknown
    try {
      mutationGuard = options.mutationGuard
      debugName = options.debugName
    } catch (error) {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.optionsObject,
        { cause: error }
      )
    }
    if (debugName !== undefined && typeof debugName !== 'string') {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.debugName
      )
    }
    this.runtime = runtime
    claimOwnership(this, runtime)
    this.#mutationGuard = mutationGuard
    this.debugName = debugName ?? defaultName
  }

  /** Terminal state readable after disposal; ordinary collection reads and writes then reject. */
  get disposed(): boolean {
    return this.#disposed
  }

  /** Registers nodes and their reference pools with the existing terminal collection owner. */
  protected own<T extends Pick<IDisposable, 'dispose'>>(resource: T): T {
    this.#nodes.add(resource)
    return resource
  }

  /** Releases ownership only after the last observer disconnects. */
  protected release(node: IReactiveSignal<unknown> & IObservable): boolean {
    if (node.subs.size > 0) return false
    return this.#nodes.delete(node)
  }

  protected assertActive(): void {
    if (this.#disposed) {
      throw createStoreIndexedError(
        StoreIndexedErrorCode.collectionDisposed,
        StoreIndexedErrorText.disposed(this.debugName)
      )
    }
  }

  protected assertMutation(operation: string): void {
    this.assertActive()
    runCollectionCallback(() =>
      this.#mutationGuard?.assertMutationAllowed(`${this.debugName}.${operation}`)
    )
  }

  /**
   * Synchronously retire owned reactive nodes and disconnect their downstream dependencies once.
   * Repeated calls do nothing; subsequent collection operations throw COLLECTION_DISPOSED.
   */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    // Signal 现在有 dispose（断开下游边），不必再为这一步拿整张图的权限
    for (const node of this.#nodes) node.dispose()
    this.#nodes.clear()
  }
}

/**
 * String-keyed reactive object for explicit per-property reads and writes without a Proxy. Initial
 * own enumerable string values and snapshots are shallow: nested objects retain identity. Tracked
 * reads must use the owning Runtime; reads and writes after disposal reject.
 */
export class ObservableObject<T extends Record<string, unknown>> extends ObservableCollectionBase {
  #values = new Map<string, unknown>()
  /** The collection owner clears this pool alongside its nodes at terminal disposal. */
  #cells = this.own(
    new ReactiveCellPool<string, unknown>(
      (node) => this.own(node),
      (node) => this.release(node)
    )
  )
  /** Invalidates object key enumeration when the stored shape changes. */
  #structure: IReactiveSignal<number> & IObservable
  /** Invalidates cached object snapshots after any committed mutation. */
  #revision: IReactiveSignal<number> & IObservable
  #snapshotCache: Readonly<T> | undefined
  #snapshotRevision = -1

  /**
   * Copy initial own enumerable string entries, evaluating getters before acquiring ownership.
   * Runtime defaults to defaultRuntime and options to {}; invalid input/options throw
   * INVALID_OPTION with the original read failure as cause when present. No deep observation is
   * installed.
   */
  constructor(
    initial: T,
    runtime: IRuntime = defaultRuntime,
    options: IObservableCollectionOptions = {}
  ) {
    const initialEntries = readObjectEntries(initial)
    super(runtime, options, 'ObservableObject')
    for (const [key, value] of initialEntries) this.#values.set(key, value)
    this.#structure = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.keys`
      })
    )
    this.#revision = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.revision`
      })
    )
  }

  /** Read one string key, tracking its cell only during observation; absent keys yield undefined. */
  get<K extends keyof T & string>(key: K): T[K] {
    this.assertActive()
    assertObjectKey(key)
    if (!isTrackingIn(this.runtime)) {
      return this.#values.get(key) as T[K]
    }
    const value = this.#cell(key).value
    return (value === ABSENT ? undefined : value) as T[K]
  }

  /** Read one string key without tracking or allocating a cell, including from another Runtime. */
  peek<K extends keyof T & string>(key: K): T[K] {
    this.assertActive()
    assertObjectKey(key)
    return this.#values.get(key) as T[K]
  }

  /**
   * Test presence, tracking the whole key structure; changing another key's membership can rerun
   * it.
   */
  has(key: keyof T & string): boolean {
    this.assertActive()
    assertObjectKey(key)
    void this.#structure.value
    return this.#values.has(key)
  }

  /** Set a string key in one batch; Object.is-equal existing values do not revise the snapshot. */
  set<K extends keyof T & string>(key: K, value: T[K]): void {
    this.assertActive()
    assertObjectKey(key)
    this.assertMutation(`set(${key})`)
    this.runtime.batch(() => this.#setInternal(key, value))
  }

  /**
   * After guard admission, pass the untracked current value to a synchronous updater and store its
   * result in one batch. A nonfunction is INVALID_OPTION; callback failure leaves the outer write
   * uncommitted and preserves the original error identity or cause under CALLBACK_FAILED.
   */
  update<K extends keyof T & string>(key: K, updater: (value: T[K]) => T[K]): void {
    this.assertActive()
    assertObjectKey(key)
    this.assertMutation(`update(${key})`)
    if (typeof updater !== 'function') {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.collectionInput
      )
    }
    const nextValue = runCollectionCallback(() => updater(this.peek(key)))
    this.runtime.batch(() => this.#setInternal(key, nextValue))
  }

  /** Remove a string key, returning whether it existed; active key observers then read undefined. */
  delete(key: keyof T & string): boolean {
    this.assertActive()
    assertObjectKey(key)
    this.assertMutation(`delete(${key})`)
    if (!this.#values.has(key)) return false
    this.runtime.batch(() => this.#deleteInternal(key))
    return true
  }

  #setInternal<K extends keyof T & string>(key: K, value: T[K]): void {
    const existed = this.#values.has(key)
    const previous = this.#values.get(key)
    this.#values.set(key, value)
    const cell = this.#cells.get(key)
    if (cell) cell.value = value
    if (!existed) this.#bumpStructure()
    if (!existed || !Object.is(previous, value)) this.#revision.value = this.#revision.peek() + 1
  }

  #deleteInternal(key: keyof T & string): void {
    this.#values.delete(key)
    const cell = this.#cells.get(key)
    if (cell) cell.value = ABSENT
    this.#bumpStructure()
    this.#revision.value = this.#revision.peek() + 1
    this.#cells.tombstone(key)
  }

  /**
   * Return a fresh key array, tracking membership/order rather than existing values; it is not
   * frozen.
   */
  keys(): readonly (keyof T & string)[] {
    this.assertActive()
    void this.#structure.value
    return [...this.#values.keys()] as (keyof T & string)[]
  }

  /**
   * Track any committed value or shape change and return a cached, shallow-frozen null-prototype
   * object. Its identity remains stable until the revision changes; nested values remain shared.
   */
  snapshot(): Readonly<T> {
    this.assertActive()
    if (isTrackingIn(this.runtime)) void this.#revision.value
    const revision = this.#revision.peek()
    if (this.#snapshotCache !== undefined && this.#snapshotRevision === revision) {
      return this.#snapshotCache
    }
    // Keys may come from external payloads. A null-prototype snapshot keeps
    // `__proto__` a data key instead of invoking Object.prototype's setter.
    const snapshot = Object.create(null) as Record<string, unknown>
    for (const key of this.#values.keys()) snapshot[key] = this.peek(key)
    this.#snapshotCache = Object.freeze(snapshot) as Readonly<T>
    this.#snapshotRevision = revision
    return this.#snapshotCache
  }

  /**
   * Read all own enumerable string entries before one batched replacement, removing omitted keys.
   * Getter/input failure is INVALID_OPTION and leaves the prior collection intact; nested values
   * are retained rather than cloned.
   */
  replace(next: T): void {
    this.assertMutation('replace')
    assertCollectionInput(next)
    // Read every hostile getter before touching the current collection. A
    // failed snapshot must leave the replacement atomic.
    let nextEntries: readonly (readonly [string, unknown])[]
    let nextKeys: ReadonlySet<string>
    try {
      const preparedEntries: Array<readonly [string, unknown]> = []
      const preparedKeys = new Set<string>()
      for (const key of Object.keys(next)) {
        preparedEntries.push([key, next[key as keyof T]] as const)
        preparedKeys.add(key)
      }
      nextEntries = preparedEntries
      nextKeys = preparedKeys
    } catch (error) {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.collectionInput,
        { cause: error }
      )
    }
    this.runtime.batch(() => {
      for (const key of this.#values.keys()) {
        if (!nextKeys.has(key)) this.#deleteInternal(key)
      }
      for (const [key, value] of nextEntries) {
        const typedKey = key as keyof T & string
        this.#setInternal(typedKey, value as T[typeof typedKey])
      }
    })
  }

  /** Release remaining cells for absent, unobserved keys and return the number removed. */
  prune(): number {
    this.assertActive()
    return this.#cells.pruneStale((key) => this.#values.has(key))
  }

  /** Obtains the owned per-key node, including absent values needed by live observers. */
  #cell(key: string): IReactiveSignal<unknown> & IObservable {
    return this.#cells.getOrCreate(key, () =>
      internalRuntimeOf(this.runtime).signal(
        this.#values.has(key) ? this.#values.get(key) : ABSENT,
        { debugName: `${this.debugName}.${key}` }
      )
    )
  }

  #bumpStructure(): void {
    this.#structure.value = this.#structure.peek() + 1
  }
}

/**
 * Reactive sequence with explicit index reads and separate length tracking, without deep proxies.
 * Element references remain shared; tracked reads use its borrowed Runtime and disposal is
 * terminal.
 */
export class ObservableArray<T> extends ObservableCollectionBase {
  #values: T[]
  /** The collection owner clears this pool alongside its nodes at terminal disposal. */
  #cells = this.own(
    new ReactiveCellPool<number, T | typeof ABSENT>(
      (node) => this.own(node),
      (node) => this.release(node)
    )
  )
  /** Invalidates array structure observers when length or index membership changes. */
  #structure: IReactiveSignal<number> & IObservable
  /** Invalidates cached array snapshots after any committed mutation. */
  #revision: IReactiveSignal<number> & IObservable
  #snapshotCache: readonly T[] | undefined
  #snapshotRevision = -1

  /**
   * Materialize the iterable before ownership admission; defaults are [], defaultRuntime and {}.
   * Strings are accepted as iterables. Invalid input/iterator/options throw INVALID_OPTION,
   * retaining the original iterator failure as cause when present.
   */
  constructor(
    initial: Iterable<T> = [],
    runtime: IRuntime = defaultRuntime,
    options: IObservableCollectionOptions = {}
  ) {
    const initialValues = materializeIterable(initial, true)
    super(runtime, options, 'ObservableArray')
    this.#values = initialValues
    this.#structure = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.structure`
      })
    )
    this.#revision = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.revision`
      })
    )
  }

  /** Read length with a structural dependency; replacing only existing values does not change it. */
  get length(): number {
    this.assertActive()
    void this.#structure.value
    return this.#values.length
  }

  /**
   * Read an integer index, with negative indices counted from the end and out-of-bounds returning
   * undefined. Observation tracks the resolved index and any necessary length dependency; untracked
   * reads allocate no cell. Noninteger indices throw INVALID_INDEX.
   */
  at(index: number): T | undefined {
    this.assertActive()
    assertIntegerIndex(index)
    if (index < 0) void this.#structure.value
    const normalized = index < 0 ? this.#values.length + index : index
    if (normalized < 0 || normalized >= this.#values.length) {
      void this.#structure.value
      return undefined
    }
    if (!isTrackingIn(this.runtime)) {
      return this.#values[normalized]
    }
    const value = this.#cell(normalized).value
    return value === ABSENT ? undefined : value
  }

  /** Return a revision-cached shallow-frozen array, tracking any changed element or length. */
  snapshot(): readonly T[] {
    this.assertActive()
    if (isTrackingIn(this.runtime)) void this.#revision.value
    const revision = this.#revision.peek()
    if (this.#snapshotCache !== undefined && this.#snapshotRevision === revision) {
      return this.#snapshotCache
    }
    this.#snapshotCache = freezeArray(this.#values)
    this.#snapshotRevision = revision
    return this.#snapshotCache
  }

  /** Return a fresh shallow-frozen copy without tracking; element objects remain shared. */
  peek(): readonly T[] {
    this.assertActive()
    return freezeArray(this.#values)
  }

  /**
   * Replace an existing element in one batch, skipping Object.is-equal values. Unlike at(),
   * negative indices are out of range: nonintegers throw INVALID_INDEX and bounds failures
   * INDEX_OUT_OF_RANGE.
   */
  set(index: number, value: T): void {
    this.assertMutation(`set(${index})`)
    assertIntegerIndex(index)
    if (index < 0 || index >= this.#values.length) {
      throw createStoreIndexedRangeError(
        StoreIndexedErrorCode.indexOutOfRange,
        StoreIndexedErrorText.arrayIndex
      )
    }
    if (Object.is(this.#values[index], value)) return
    this.runtime.batch(() => {
      this.#values[index] = value
      const cell = this.#cells.get(index)
      if (cell) cell.value = value
      this.#revision.value = this.#revision.peek() + 1
    })
  }

  /** Append values in one batch and return the resulting length; no values leaves content unchanged. */
  push(...values: readonly T[]): number {
    this.assertMutation('push')
    if (values.length === 0) return this.#values.length
    this.runtime.batch(() => {
      const start = this.#values.length
      this.#values.push(...values)
      for (let offset = 0; offset < values.length; offset++) {
        const cell = this.#cells.get(start + offset)
        if (cell) cell.value = values[offset]
      }
      this.#bumpStructure()
      this.#revision.value = this.#revision.peek() + 1
    })
    return this.#values.length
  }

  /** Remove and return the last element in one batch, or undefined for an empty array. */
  pop(): T | undefined {
    this.assertMutation('pop')
    if (this.#values.length === 0) return undefined
    const index = this.#values.length - 1
    let removed: T | undefined
    this.runtime.batch(() => {
      removed = this.#values.pop()
      const cell = this.#cells.get(index)
      if (cell) cell.value = ABSENT
      this.#bumpStructure()
      this.#revision.value = this.#revision.peek() + 1
    })
    return removed
  }

  /**
   * Apply native splice positioning and return a shallow-frozen removed-elements array. Omitting
   * deleteCount removes the remainder; explicit undefined removes none. The JavaScript no-argument
   * call is a no-op. Changed index cells and length are published together.
   */
  splice(start: number, deleteCount?: number, ...items: readonly T[]): readonly T[] {
    this.assertMutation('splice')
    // Preserve native `splice()` semantics at the JavaScript boundary. Forwarding an omitted
    // `start` as an explicit `undefined` would otherwise delete the whole array.
    if (arguments.length === 0) return Object.freeze([])
    const hasDeleteCount = arguments.length >= 2
    // A common insertion cursor probe must not clone and compare the entire collection.
    if (hasDeleteCount && items.length === 0 && (deleteCount === undefined || deleteCount === 0)) {
      return Object.freeze([])
    }
    const next = [...this.#values]
    const removed = hasDeleteCount
      ? next.splice(start, deleteCount ?? 0, ...items)
      : next.splice(start)
    this.#replaceInternal(next)
    return Object.freeze(removed)
  }

  /**
   * Materialize a complete iterable before replacing the sequence in one batch. Invalid input or
   * iteration failure throws INVALID_OPTION without replacing prior contents.
   */
  replace(values: Iterable<T>): void {
    this.assertMutation('replace')
    this.#replaceInternal(materializeIterable(values, true))
  }

  /** Replace the sequence with an empty array through the same single guard/batch boundary. */
  clear(): void {
    this.replace([])
  }

  /** Obtains the owned per-index node without losing observations beyond the current bounds. */
  #cell(index: number): IReactiveSignal<T | typeof ABSENT> & IObservable {
    return this.#cells.getOrCreate(index, () =>
      internalRuntimeOf(this.runtime).signal(
        index < this.#values.length ? this.#values[index] : ABSENT,
        { debugName: `${this.debugName}[${index}]` }
      )
    )
  }

  #replaceInternal(next: T[]): void {
    const previous = this.#values
    const previousLength = previous.length
    this.runtime.batch(() => {
      this.#values = next
      // Walk the materialized cells, not the full index range: a 100k-item
      // array with 5 tracked indices doesn't need 100k iterations to update
      // them. Untracked indices have no cell to notify — nothing observes a
      // value change there until something reads it and materializes one,
      // at which point it picks up `next` directly (see `#cell()`).
      for (const [index, cell] of this.#cells) {
        const value = index < next.length ? next[index] : ABSENT
        cell.value = value
      }
      if (previousLength !== next.length) this.#bumpStructure()
      if (
        previousLength !== next.length ||
        previous.some((value, i) => !Object.is(value, next[i]))
      ) {
        this.#revision.value = this.#revision.peek() + 1
      }
    })
  }

  #bumpStructure(): void {
    this.#structure.value = this.#structure.peek() + 1
  }
}

/**
 * Native-keyed map with lazy per-key cells and separate structural/value iteration dependencies.
 * Keys and values retain identity; no deep proxies are created. Use its owning Runtime for tracked
 * reads and dispose it when its observers no longer need it.
 */
export class ObservableMap<K, V> extends ObservableCollectionBase {
  #values = new Map<K, V>()
  /** The collection owner clears this pool alongside its nodes at terminal disposal. */
  #cells = this.own(
    new ReactiveCellPool<K, V | typeof ABSENT>(
      (node) => this.own(node),
      (node) => this.release(node)
    )
  )
  /** Invalidates map size and key observations when membership changes. */
  #structure: IReactiveSignal<number> & IObservable
  /** Invalidates map value iteration when a member value changes. */
  #iteration: IReactiveSignal<number> & IObservable

  /**
   * Materialize native Map entries before ownership; defaults are [], defaultRuntime and {}.
   * Invalid iterables, entry shapes or options throw INVALID_OPTION, with input failures retained
   * as cause. Duplicate keys follow native Map semantics.
   */
  constructor(
    initial: ReadonlyMap<K, V> | Iterable<readonly [K, V]> = [],
    runtime: IRuntime = defaultRuntime,
    options: IObservableCollectionOptions = {}
  ) {
    /** Validate the full native Map before the collection acquires Runtime ownership. */
    const initialEntries = materializeMap(initial)
    super(runtime, options, 'ObservableMap')
    this.#values = initialEntries
    this.#structure = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.structure`
      })
    )
    this.#iteration = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.iteration`
      })
    )
  }

  /** Read the member count with the map's structural dependency, which also observes key reorder. */
  get size(): number {
    this.assertActive()
    void this.#structure.value
    return this.#values.size
  }

  /** Read one key, tracking its value cell only during observation; absence yields undefined. */
  get(key: K): V | undefined {
    this.assertActive()
    if (!isTrackingIn(this.runtime)) return this.#values.get(key)
    const value = this.#cell(key).value
    return value === ABSENT ? undefined : value
  }

  /** Read one key without tracking or allocating a cell, including from another Runtime. */
  peek(key: K): V | undefined {
    this.assertActive()
    return this.#values.get(key)
  }

  /**
   * Test one key without observing unrelated keys. Tracking shares its value cell, so changing an
   * existing value can also invalidate this presence read.
   */
  has(key: K): boolean {
    this.assertActive()
    if (!isTrackingIn(this.runtime)) return this.#values.has(key)
    // Membership is a per-key dependency; changing an unrelated key must not
    // invalidate observers that only ask about this key.
    return this.#cell(key).value !== ABSENT
  }

  /** Set a key and return this map; Object.is-equal existing values do not notify. */
  set(key: K, value: V): this {
    this.assertMutation('set')
    const existed = this.#values.has(key)
    if (existed && Object.is(this.#values.get(key), value)) return this
    this.runtime.batch(() => {
      this.#values.set(key, value)
      const cell = this.#cells.get(key)
      if (cell) cell.value = value
      if (!existed) this.#bumpStructure()
      this.#bumpIteration()
    })
    return this
  }

  /** Remove a key and return whether it existed, notifying its cell and relevant iteration views. */
  delete(key: K): boolean {
    this.assertMutation('delete')
    if (!this.#values.has(key)) return false
    this.runtime.batch(() => {
      this.#values.delete(key)
      const cell = this.#cells.get(key)
      if (cell) cell.value = ABSENT
      this.#bumpStructure()
      this.#bumpIteration()
    })
    this.#cells.tombstone(key)
    return true
  }

  /** Clear all members in one batch; an empty map has no content notifications. */
  clear(): void {
    this.assertMutation('clear')
    if (this.#values.size === 0) return
    // Calling delete() per key walked the full key set even when only a
    // handful of entries ever got a tracked cell, and bumped structure/
    // iteration once per key instead of once for the whole clear. Only the
    // materialized cells need individual notification; everything else has
    // no observer to tell.
    this.runtime.batch(() => {
      this.#values.clear()
      for (const [key, cell] of this.#cells) {
        cell.value = ABSENT
        this.#cells.tombstone(key)
      }
      this.#bumpStructure()
      this.#bumpIteration()
    })
  }

  /**
   * Materialize all native entries before one batched replacement; invalid input is INVALID_OPTION
   * and leaves prior contents intact. Key insertion order is observable. Unchanged ordered entries
   * skip revision notifications; structural/value iteration revisions each advance at most once.
   */
  replace(next: ReadonlyMap<K, V> | Iterable<readonly [K, V]>): void {
    this.assertMutation('replace')
    this.#replaceInternal(materializeMap(next))
  }

  /** Return a fresh, unfrozen insertion-order key array, tracking structure rather than values. */
  keys(): readonly K[] {
    this.assertActive()
    void this.#structure.value
    return [...this.#values.keys()]
  }

  /** Return a fresh shallow-frozen insertion-order value array, tracking value/order changes. */
  valuesArray(): readonly V[] {
    this.assertActive()
    void this.#iteration.value
    return Object.freeze([...this.#values.values()])
  }

  /** Return a frozen entries array with frozen pairs; referenced keys/values remain shared. */
  entries(): readonly (readonly [K, V])[] {
    this.assertActive()
    void this.#iteration.value
    return Object.freeze(
      [...this.#values.entries()].map(([key, value]) => Object.freeze([key, value] as const))
    )
  }

  /**
   * Track value/order changes and return a new native Map copy each time. Readonly is a type-level
   * view: the copy is not frozen, and its keys/values retain their original references.
   */
  snapshot(): ReadonlyMap<K, V> {
    this.assertActive()
    void this.#iteration.value
    return new Map(this.#values)
  }

  /** Release remaining cells for absent, unobserved keys and return the number removed. */
  prune(): number {
    this.assertActive()
    return this.#cells.pruneStale((key) => this.#values.has(key))
  }

  /** Obtains the owned per-key node while retaining tombstones observed by subscribers. */
  #cell(key: K): IReactiveSignal<V | typeof ABSENT> & IObservable {
    return this.#cells.getOrCreate(key, () =>
      internalRuntimeOf(this.runtime).signal(
        this.#values.has(key) ? (this.#values.get(key) as V) : ABSENT,
        { debugName: `${this.debugName}.key` }
      )
    )
  }

  #replaceInternal(next: Map<K, V>): void {
    const previous = this.#values
    this.runtime.batch(() => {
      this.#values = next
      // Walk the materialized cells, not every key of `next`: an untracked
      // key has no cell to notify — it picks up `next` directly on first
      // read (see `#cell()`).
      for (const [key, cell] of this.#cells) {
        cell.value = next.has(key) ? (next.get(key) as V) : ABSENT
      }
      const sameSize = previous.size === next.size
      let structuralChange = !sameSize
      let contentChange = !sameSize
      if (sameSize) {
        /**
         * Native Map keys define both membership and insertion order, including canonical zero
         * keys.
         */
        const nextKeys = next.keys()
        for (const [key, value] of previous) {
          if (!Object.is(key, nextKeys.next().value)) structuralChange = true
          if (!Object.is(value, next.get(key))) contentChange = true
        }
      }
      if (structuralChange) this.#bumpStructure()
      if (structuralChange || contentChange) this.#bumpIteration()
    })
  }

  #bumpStructure(): void {
    this.#structure.value = this.#structure.peek() + 1
  }

  #bumpIteration(): void {
    this.#iteration.value = this.#iteration.peek() + 1
  }
}

/**
 * Native-value set with lazy per-value membership cells and shared structure/order tracking. Values
 * retain identity. Tracked reads use its borrowed Runtime and disposal is terminal.
 */
export class ObservableSet<T> extends ObservableCollectionBase {
  #values = new Set<T>()
  /** The collection owner clears this pool alongside its nodes at terminal disposal. */
  #cells = this.own(
    new ReactiveCellPool<T, boolean>(
      (node) => this.own(node),
      (node) => this.release(node)
    )
  )
  /** Invalidates set size and iteration observations when membership changes. */
  #structure: IReactiveSignal<number> & IObservable

  /**
   * Materialize the iterable before ownership; defaults are [], defaultRuntime and {}. Strings are
   * accepted and duplicates follow native Set semantics. Invalid input/iterator/options throw
   * INVALID_OPTION, retaining the original input failure as cause when present.
   */
  constructor(
    initial: Iterable<T> = [],
    runtime: IRuntime = defaultRuntime,
    options: IObservableCollectionOptions = {}
  ) {
    const initialValues = materializeIterable(initial, true)
    super(runtime, options, 'ObservableSet')
    for (const value of initialValues) this.#values.add(value)
    this.#structure = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.structure`
      })
    )
  }

  /** Read the member count with a structural dependency, which also observes value reorder. */
  get size(): number {
    this.assertActive()
    void this.#structure.value
    return this.#values.size
  }

  /** Test one value's membership, allocating its cell only when the read is tracked. */
  has(value: T): boolean {
    this.assertActive()
    if (!isTrackingIn(this.runtime)) return this.#values.has(value)
    return this.#cell(value).value
  }

  /** Add a value and return this set; an existing native-equal member leaves content unchanged. */
  add(value: T): this {
    this.assertMutation('add')
    if (this.#values.has(value)) return this
    this.runtime.batch(() => {
      this.#values.add(value)
      const cell = this.#cells.get(value)
      if (cell) cell.value = true
      this.#bumpStructure()
    })
    return this
  }

  /** Remove a value and return whether it existed, notifying its membership and structural views. */
  delete(value: T): boolean {
    this.assertMutation('delete')
    if (!this.#values.has(value)) return false
    this.runtime.batch(() => this.#deleteInternal(value))
    return true
  }

  /** Clear members in one batch and notify materialized membership cells; empty sets do not notify. */
  clear(): void {
    this.assertMutation('clear')
    if (this.#values.size === 0) return
    this.runtime.batch(() => {
      this.#values.clear()
      // Only materialized membership cells can have observers. Clear them individually, then
      // publish one structural revision for the whole operation.
      for (const [value, cell] of this.#cells) {
        cell.value = false
        this.#cells.tombstone(value)
      }
      this.#bumpStructure()
    })
  }

  #deleteInternal(value: T): void {
    this.#values.delete(value)
    const cell = this.#cells.get(value)
    if (cell) cell.value = false
    this.#bumpStructure()
    this.#cells.tombstone(value)
  }

  /**
   * Materialize the iterable before one batched replacement; invalid input throws INVALID_OPTION
   * without replacing prior contents. Insertion order is observable, and an identical ordered set
   * leaves the structural revision unchanged.
   */
  replace(next: Iterable<T>): void {
    this.assertMutation('replace')
    this.#replaceInternal(new Set(materializeIterable(next, true)))
  }

  /** Return a fresh shallow-frozen insertion-order array, tracking membership/order changes. */
  valuesArray(): readonly T[] {
    this.assertActive()
    void this.#structure.value
    return Object.freeze([...this.#values])
  }

  /**
   * Track membership/order changes and return a new native Set copy. Readonly is type-level rather
   * than runtime freezing; member objects retain their original references.
   */
  snapshot(): ReadonlySet<T> {
    this.assertActive()
    void this.#structure.value
    return new Set(this.#values)
  }

  /** Release remaining cells for absent, unobserved values and return the number removed. */
  prune(): number {
    this.assertActive()
    return this.#cells.pruneStale((value) => this.#values.has(value))
  }

  /** Obtains the owned membership node for this value. */
  #cell(value: T): IReactiveSignal<boolean> & IObservable {
    return this.#cells.getOrCreate(value, () =>
      internalRuntimeOf(this.runtime).signal(this.#values.has(value), {
        debugName: `${this.debugName}.member`
      })
    )
  }

  #replaceInternal(next: Set<T>): void {
    const previous = this.#values
    this.runtime.batch(() => {
      this.#values = next
      // Walk the materialized cells, not every value of `next`: an
      // untracked value has no cell to notify — it picks up `next` directly
      // on first read (see `#cell()`).
      for (const [value, cell] of this.#cells) {
        cell.value = next.has(value)
      }
      /**
       * Set values are canonical native keys, so ordered identity detects reorders as well as
       * membership.
       */
      const nextValues = next.values()
      const changed =
        previous.size !== next.size ||
        [...previous].some((value) => !Object.is(value, nextValues.next().value))
      if (changed) this.#bumpStructure()
    })
  }

  #bumpStructure(): void {
    this.#structure.value = this.#structure.peek() + 1
  }
}

function freezeArray<T>(values: Iterable<T>): readonly T[] {
  return Object.freeze([...values])
}

function assertIntegerIndex(index: number): void {
  if (!Number.isInteger(index)) {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidIndex,
      StoreIndexedErrorText.arrayInteger
    )
  }
}
