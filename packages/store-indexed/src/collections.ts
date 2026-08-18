import { defaultRuntime } from '@migaia/reactive';
import type { IDisposable, IRuntime } from '@migaia/reactive';
import type { Signal } from '@migaia/reactive/reactive/signal.class';
import type { IMutationGuard } from '@migaia/store-light';
import { claimOwnership } from '@migaia/reactive/ownership';
import {
  internalRuntimeOf,
  isRuntimeTracking,
  isAnyRuntimeTracking
} from '@migaia/reactive/node-factories';
import { ReactiveCellPool } from './reactive-cell-pool.js';
import {
  createStoreIndexedError,
  createStoreIndexedRangeError,
  createStoreIndexedTypeError
} from './errors.js';
import { StoreIndexedErrorCode } from './error-code.js';
import { StoreIndexedErrorText } from './error-text.js';

const ABSENT = Symbol('observable-collection-absent');

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
    );
  }
}

/**
 * Materializes object entries before ownership admission so hostile input cannot leak partial
 * construction.
 */
function readObjectEntries<T extends Record<string, unknown>>(initial: T): [string, unknown][] {
  assertCollectionInput(initial);
  try {
    return Object.keys(initial).map((key) => [key, initial[key]]);
  } catch (error) {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.collectionInput,
      { cause: error }
    );
  }
}

/** Materializes iterable input before ownership admission, preserving construction atomicity. */
function materializeIterable<T>(initial: Iterable<T>, allowPrimitiveString = false): T[] {
  assertCollectionInput(initial, allowPrimitiveString);
  let iteratorMethod: unknown;
  try {
    iteratorMethod = (initial as { [Symbol.iterator]?: unknown })[Symbol.iterator];
  } catch (error) {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.collectionInput,
      { cause: error }
    );
  }
  if (typeof iteratorMethod !== 'function') {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.collectionInput
    );
  }
  try {
    const iterator = Reflect.apply(iteratorMethod, initial, []);
    return Array.from({ [Symbol.iterator]: () => iterator });
  } catch (error) {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.collectionInput,
      { cause: error }
    );
  }
}

/** Enforces the string-key contract of ObservableObject after JavaScript type erasure. */
function assertObjectKey(key: unknown): asserts key is string {
  if (typeof key !== 'string') {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidOption,
      StoreIndexedErrorText.objectKey
    );
  }
}

function isTrackingIn(runtime: IRuntime): boolean {
  const tracking = isRuntimeTracking(runtime);
  if (!tracking && isAnyRuntimeTracking()) {
    throw createStoreIndexedError(
      StoreIndexedErrorCode.crossRuntime,
      StoreIndexedErrorText.crossRuntime
    );
  }
  return tracking;
}

export type IObservableCollectionOptions = {
  readonly mutationGuard?: IMutationGuard;
  readonly debugName?: string;
};

/**
 * Shared lifecycle for explicit structural collections. These collections never Proxy user objects;
 * all tracked reads and writes go through named methods.
 */
abstract class ObservableCollectionBase implements IDisposable {
  readonly runtime: IRuntime;
  #mutationGuard?: IMutationGuard;
  protected readonly debugName: string;
  // 只收自己建的 Signal：释放要调它们的 dispose()，那是公开面上的操作
  #nodes = new Set<Signal<unknown>>();
  #disposed = false;

  protected constructor(
    runtime: IRuntime,
    options: IObservableCollectionOptions,
    defaultName: string
  ) {
    if (options === null || typeof options !== 'object') {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.optionsObject
      );
    }
    try {
      Object.getOwnPropertyDescriptors(options);
    } catch (error) {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.optionsObject,
        { cause: error }
      );
    }
    let mutationGuard: IMutationGuard | undefined;
    let debugName: unknown;
    try {
      mutationGuard = options.mutationGuard;
      debugName = options.debugName;
    } catch (error) {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.optionsObject,
        { cause: error }
      );
    }
    if (debugName !== undefined && typeof debugName !== 'string') {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.debugName
      );
    }
    this.runtime = runtime;
    claimOwnership(this, runtime);
    this.#mutationGuard = mutationGuard;
    this.debugName = debugName ?? defaultName;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  protected own<T>(node: Signal<T>): Signal<T> {
    this.#nodes.add(node as Signal<unknown>);
    return node;
  }

  protected release(node: Signal<unknown>): boolean {
    if (node.subs.size > 0) return false;
    return this.#nodes.delete(node);
  }

  protected assertActive(): void {
    if (this.#disposed) {
      throw createStoreIndexedError(
        StoreIndexedErrorCode.collectionDisposed,
        StoreIndexedErrorText.disposed(this.debugName)
      );
    }
  }

  protected assertMutation(operation: string): void {
    this.assertActive();
    this.#mutationGuard?.assertMutationAllowed(`${this.debugName}.${operation}`);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    // Signal 现在有 dispose（断开下游边），不必再为这一步拿整张图的权限
    for (const node of this.#nodes) node.dispose();
    this.#nodes.clear();
  }
}

/** Fine-grained keyed object with explicit accessors and structural key tracking. */
export class ObservableObject<T extends Record<string, unknown>> extends ObservableCollectionBase {
  #values = new Map<string, unknown>();
  #cells = new ReactiveCellPool<string, unknown>(
    (node) => this.own(node),
    (node) => this.release(node)
  );
  #structure: Signal<number>;
  #revision: Signal<number>;

  constructor(
    initial: T,
    runtime: IRuntime = defaultRuntime,
    options: IObservableCollectionOptions = {}
  ) {
    const initialEntries = readObjectEntries(initial);
    super(runtime, options, 'ObservableObject');
    for (const [key, value] of initialEntries) this.#values.set(key, value);
    this.#structure = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.keys`
      })
    );
    this.#revision = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.revision`
      })
    );
  }

  get<K extends keyof T & string>(key: K): T[K] {
    this.assertActive();
    assertObjectKey(key);
    if (!isTrackingIn(this.runtime)) {
      return this.#values.get(key) as T[K];
    }
    const value = this.#cell(key).value;
    return (value === ABSENT ? undefined : value) as T[K];
  }

  // peek 是非追踪读，绝不能顺手建 cell：cell 由 ReactiveCellPool 的观察者钩子回收，
  // 而从未被观察过的 cell 不会触发 onUnobserved，会一直挂在 nodes/cells 上。
  // 遍历十万个 key 做 peek 就会实体化十万个没人订阅的 Signal。
  peek<K extends keyof T & string>(key: K): T[K] {
    this.assertActive();
    assertObjectKey(key);
    return this.#values.get(key) as T[K];
  }

  // 存在性只随「键集合」变化，structure 正好在增删键时 bump（改值不 bump），
  // 因此追踪 structure 比追踪值 cell 更精确，且同样不分配。
  has(key: keyof T & string): boolean {
    this.assertActive();
    assertObjectKey(key);
    void this.#structure.value;
    return this.#values.has(key);
  }

  set<K extends keyof T & string>(key: K, value: T[K]): void {
    this.assertActive();
    assertObjectKey(key);
    this.assertMutation(`set(${key})`);
    this.runtime.batch(() => this.#setInternal(key, value));
  }

  update<K extends keyof T & string>(key: K, updater: (value: T[K]) => T[K]): void {
    this.assertActive();
    assertObjectKey(key);
    this.assertMutation(`update(${key})`);
    if (typeof updater !== 'function') {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.collectionInput
      );
    }
    const nextValue = updater(this.peek(key));
    this.runtime.batch(() => this.#setInternal(key, nextValue));
  }

  delete(key: keyof T & string): boolean {
    this.assertActive();
    assertObjectKey(key);
    this.assertMutation(`delete(${key})`);
    if (!this.#values.has(key)) return false;
    this.runtime.batch(() => this.#deleteInternal(key));
    return true;
  }

  #setInternal<K extends keyof T & string>(key: K, value: T[K]): void {
    const existed = this.#values.has(key);
    const previous = this.#values.get(key);
    this.#values.set(key, value);
    const cell = this.#cells.get(key);
    if (cell) cell.value = value;
    if (!existed) this.#bumpStructure();
    if (!Object.is(previous, value)) this.#revision.value = this.#revision.peek() + 1;
  }

  #deleteInternal(key: keyof T & string): void {
    this.#values.delete(key);
    const cell = this.#cells.get(key);
    if (cell) cell.value = ABSENT;
    this.#bumpStructure();
    this.#revision.value = this.#revision.peek() + 1;
    this.#cells.tombstone(key);
  }

  keys(): readonly (keyof T & string)[] {
    this.assertActive();
    void this.#structure.value;
    return [...this.#values.keys()] as (keyof T & string)[];
  }

  snapshot(): Readonly<T> {
    this.assertActive();
    if (isTrackingIn(this.runtime)) void this.#revision.value;
    // Keys may come from external payloads. A null-prototype snapshot keeps
    // `__proto__` a data key instead of invoking Object.prototype's setter.
    const snapshot = Object.create(null) as Record<string, unknown>;
    for (const key of this.#values.keys()) snapshot[key] = this.peek(key);
    return Object.freeze(snapshot) as Readonly<T>;
  }

  replace(next: T): void {
    this.assertMutation('replace');
    assertCollectionInput(next);
    // Read every hostile getter before touching the current collection. A
    // failed snapshot must leave the replacement atomic.
    let nextEntries: readonly (readonly [string, unknown])[];
    try {
      nextEntries = Object.keys(next).map((key) => [key, next[key as keyof T]] as const);
    } catch (error) {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.collectionInput,
        { cause: error }
      );
    }
    const nextKeys = new Set(nextEntries.map(([key]) => key));
    this.runtime.batch(() => {
      for (const key of Array.from(this.#values.keys())) {
        if (!nextKeys.has(key)) this.#deleteInternal(key);
      }
      for (const [key, value] of nextEntries) {
        const typedKey = key as keyof T & string;
        this.#setInternal(typedKey, value as T[typeof typedKey]);
      }
    });
  }

  /** Release cells for deleted keys that no observer still references. */
  prune(): number {
    this.assertActive();
    return this.#cells.pruneStale((key) => this.#values.has(key));
  }

  #cell(key: string): Signal<unknown> {
    return this.#cells.getOrCreate(key, () =>
      internalRuntimeOf(this.runtime).signal(
        this.#values.has(key) ? this.#values.get(key) : ABSENT,
        { debugName: `${this.debugName}.${key}` }
      )
    );
  }

  #bumpStructure(): void {
    this.#structure.value = this.#structure.peek() + 1;
  }
}

/** Explicit array with index-level dependencies and separate length tracking. */
export class ObservableArray<T> extends ObservableCollectionBase {
  #values: T[];
  #cells = new ReactiveCellPool<number, T | typeof ABSENT>(
    (node) => this.own(node),
    (node) => this.release(node)
  );
  #structure: Signal<number>;
  #revision: Signal<number>;

  constructor(
    initial: Iterable<T> = [],
    runtime: IRuntime = defaultRuntime,
    options: IObservableCollectionOptions = {}
  ) {
    const initialValues = materializeIterable(initial, true);
    super(runtime, options, 'ObservableArray');
    this.#values = initialValues;
    this.#structure = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.structure`
      })
    );
    this.#revision = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.revision`
      })
    );
  }

  get length(): number {
    this.assertActive();
    void this.#structure.value;
    return this.#values.length;
  }

  at(index: number): T | undefined {
    this.assertActive();
    assertIntegerIndex(index);
    if (index < 0) void this.#structure.value;
    const normalized = index < 0 ? this.#values.length + index : index;
    if (normalized < 0 || normalized >= this.#values.length) {
      void this.#structure.value;
      return undefined;
    }
    if (!isTrackingIn(this.runtime)) {
      return this.#values[normalized];
    }
    const value = this.#cell(normalized).value;
    return value === ABSENT ? undefined : value;
  }

  snapshot(): readonly T[] {
    this.assertActive();
    if (isTrackingIn(this.runtime)) void this.#revision.value;
    return freezeArray(this.#values);
  }

  peek(): readonly T[] {
    this.assertActive();
    return freezeArray(this.#values);
  }

  set(index: number, value: T): void {
    this.assertMutation(`set(${index})`);
    assertIntegerIndex(index);
    if (index < 0 || index >= this.#values.length) {
      throw createStoreIndexedRangeError(
        StoreIndexedErrorCode.indexOutOfRange,
        StoreIndexedErrorText.arrayIndex
      );
    }
    if (Object.is(this.#values[index], value)) return;
    this.#values[index] = value;
    const cell = this.#cells.get(index);
    if (cell) cell.value = value;
    this.#revision.value = this.#revision.peek() + 1;
  }

  push(...values: readonly T[]): number {
    this.assertMutation('push');
    if (values.length === 0) return this.#values.length;
    this.runtime.batch(() => {
      const start = this.#values.length;
      this.#values.push(...values);
      for (let offset = 0; offset < values.length; offset++) {
        const cell = this.#cells.get(start + offset);
        if (cell) cell.value = values[offset];
      }
      this.#bumpStructure();
      this.#revision.value = this.#revision.peek() + 1;
    });
    return this.#values.length;
  }

  pop(): T | undefined {
    this.assertMutation('pop');
    if (this.#values.length === 0) return undefined;
    const index = this.#values.length - 1;
    let removed: T | undefined;
    this.runtime.batch(() => {
      removed = this.#values.pop();
      const cell = this.#cells.get(index);
      if (cell) cell.value = ABSENT;
      this.#bumpStructure();
      this.#revision.value = this.#revision.peek() + 1;
    });
    return removed;
  }

  splice(start: number, deleteCount?: number, ...items: readonly T[]): readonly T[] {
    this.assertMutation('splice');
    const next = [...this.#values];
    const removed =
      deleteCount === undefined ? next.splice(start) : next.splice(start, deleteCount, ...items);
    this.#replaceInternal(next);
    return Object.freeze(removed);
  }

  replace(values: Iterable<T>): void {
    this.assertMutation('replace');
    this.#replaceInternal(materializeIterable(values, true));
  }

  clear(): void {
    this.replace([]);
  }

  /** Release unobserved cells left behind by removals/high churn. */
  prune(): number {
    this.assertActive();
    // Index identity is less meaningful than object/map key identity once
    // splice/pop have run — any dormant cell is fair to reclaim, not just
    // ones past the current bounds.
    return this.#cells.pruneStale(() => false);
  }

  #cell(index: number): Signal<T | typeof ABSENT> {
    return this.#cells.getOrCreate(index, () =>
      internalRuntimeOf(this.runtime).signal(
        index < this.#values.length ? this.#values[index] : ABSENT,
        { debugName: `${this.debugName}[${index}]` }
      )
    );
  }

  #replaceInternal(next: T[]): void {
    const previous = this.#values;
    const previousLength = previous.length;
    this.runtime.batch(() => {
      this.#values = next;
      // Walk the materialized cells, not the full index range: a 100k-item
      // array with 5 tracked indices doesn't need 100k iterations to update
      // them. Untracked indices have no cell to notify — nothing observes a
      // value change there until something reads it and materializes one,
      // at which point it picks up `next` directly (see `#cell()`).
      for (const [index, cell] of this.#cells) {
        const value = index < next.length ? next[index] : ABSENT;
        cell.value = value;
      }
      if (previousLength !== next.length) this.#bumpStructure();
      if (
        previousLength !== next.length ||
        previous.some((value, i) => !Object.is(value, next[i]))
      ) {
        this.#revision.value = this.#revision.peek() + 1;
      }
    });
  }

  #bumpStructure(): void {
    this.#structure.value = this.#structure.peek() + 1;
  }
}

/** Per-key lookup tracking plus a separate dependency for iteration and size. */
export class ObservableMap<K, V> extends ObservableCollectionBase {
  #values = new Map<K, V>();
  #cells = new ReactiveCellPool<K, V | typeof ABSENT>(
    (node) => this.own(node),
    (node) => this.release(node)
  );
  #structure: Signal<number>;
  #iteration: Signal<number>;

  constructor(
    initial: ReadonlyMap<K, V> | Iterable<readonly [K, V]> = [],
    runtime: IRuntime = defaultRuntime,
    options: IObservableCollectionOptions = {}
  ) {
    const initialEntries = materializeIterable(initial);
    super(runtime, options, 'ObservableMap');
    try {
      for (const [key, value] of initialEntries) this.#values.set(key, value);
    } catch (error) {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.collectionInput,
        { cause: error }
      );
    }
    this.#structure = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.structure`
      })
    );
    this.#iteration = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.iteration`
      })
    );
  }

  get size(): number {
    this.assertActive();
    void this.#structure.value;
    return this.#values.size;
  }

  get(key: K): V | undefined {
    this.assertActive();
    if (!isTrackingIn(this.runtime)) return this.#values.get(key);
    const value = this.#cell(key).value;
    return value === ABSENT ? undefined : value;
  }

  // 同 ObservableObject：非追踪读不建 cell，否则未被观察的 cell 永不回收。
  peek(key: K): V | undefined {
    this.assertActive();
    return this.#values.get(key);
  }

  has(key: K): boolean {
    this.assertActive();
    if (!isTrackingIn(this.runtime)) return this.#values.has(key);
    // Membership is a per-key dependency; changing an unrelated key must not
    // invalidate observers that only ask about this key.
    return this.#cell(key).value !== ABSENT;
  }

  set(key: K, value: V): this {
    this.assertMutation('set');
    const existed = this.#values.has(key);
    if (existed && Object.is(this.#values.get(key), value)) return this;
    this.runtime.batch(() => {
      this.#values.set(key, value);
      const cell = this.#cells.get(key);
      if (cell) cell.value = value;
      if (!existed) this.#bumpStructure();
      this.#bumpIteration();
    });
    return this;
  }

  delete(key: K): boolean {
    this.assertMutation('delete');
    if (!this.#values.has(key)) return false;
    this.runtime.batch(() => {
      this.#values.delete(key);
      const cell = this.#cells.get(key);
      if (cell) cell.value = ABSENT;
      this.#bumpStructure();
      this.#bumpIteration();
    });
    this.#cells.tombstone(key);
    return true;
  }

  clear(): void {
    this.assertMutation('clear');
    if (this.#values.size === 0) return;
    // Calling delete() per key walked the full key set even when only a
    // handful of entries ever got a tracked cell, and bumped structure/
    // iteration once per key instead of once for the whole clear. Only the
    // materialized cells need individual notification; everything else has
    // no observer to tell.
    this.runtime.batch(() => {
      this.#values.clear();
      for (const [key, cell] of this.#cells) {
        cell.value = ABSENT;
        this.#cells.tombstone(key);
      }
      this.#bumpStructure();
      this.#bumpIteration();
    });
  }

  /**
   * Atomically swap the whole map for `next`. Fires at most one structural (`#structure`) and one
   * iteration (`#iteration`) notification for the entire swap, unlike `clear()` + per-entry `set()`
   * which would fire one per key.
   */
  replace(next: ReadonlyMap<K, V> | Iterable<readonly [K, V]>): void {
    this.assertMutation('replace');
    const entries = materializeIterable(next);
    let materialized: Map<K, V>;
    try {
      materialized = new Map(entries);
    } catch (error) {
      throw createStoreIndexedTypeError(
        StoreIndexedErrorCode.invalidOption,
        StoreIndexedErrorText.collectionInput,
        { cause: error }
      );
    }
    this.#replaceInternal(materialized);
  }

  keys(): readonly K[] {
    this.assertActive();
    void this.#structure.value;
    return [...this.#values.keys()];
  }

  valuesArray(): readonly V[] {
    this.assertActive();
    void this.#iteration.value;
    return Object.freeze([...this.#values.values()]);
  }

  entries(): readonly (readonly [K, V])[] {
    this.assertActive();
    void this.#iteration.value;
    return Object.freeze(
      [...this.#values.entries()].map(([key, value]) => Object.freeze([key, value] as const))
    );
  }

  snapshot(): ReadonlyMap<K, V> {
    this.assertActive();
    void this.#iteration.value;
    return new Map(this.#values);
  }

  /** Release cells for deleted keys that no observer still references. */
  prune(): number {
    this.assertActive();
    return this.#cells.pruneStale((key) => this.#values.has(key));
  }

  #cell(key: K): Signal<V | typeof ABSENT> {
    return this.#cells.getOrCreate(key, () =>
      internalRuntimeOf(this.runtime).signal(
        this.#values.has(key) ? (this.#values.get(key) as V) : ABSENT,
        { debugName: `${this.debugName}.key` }
      )
    );
  }

  #replaceInternal(next: Map<K, V>): void {
    const previous = this.#values;
    this.runtime.batch(() => {
      this.#values = next;
      // Walk the materialized cells, not every key of `next`: an untracked
      // key has no cell to notify — it picks up `next` directly on first
      // read (see `#cell()`).
      for (const [key, cell] of this.#cells) {
        cell.value = next.has(key) ? (next.get(key) as V) : ABSENT;
      }
      const sameSize = previous.size === next.size;
      let structuralChange = !sameSize;
      let contentChange = !sameSize;
      if (sameSize) {
        for (const [key, value] of previous) {
          if (!next.has(key)) {
            structuralChange = true;
            contentChange = true;
            break;
          }
          if (!Object.is(value, next.get(key))) contentChange = true;
        }
      }
      if (structuralChange) this.#bumpStructure();
      if (structuralChange || contentChange) this.#bumpIteration();
    });
  }

  #bumpStructure(): void {
    this.#structure.value = this.#structure.peek() + 1;
  }

  #bumpIteration(): void {
    this.#iteration.value = this.#iteration.peek() + 1;
  }
}

/** Set counterpart of ObservableMap with per-value membership tracking. */
export class ObservableSet<T> extends ObservableCollectionBase {
  #values = new Set<T>();
  #cells = new ReactiveCellPool<T, boolean>(
    (node) => this.own(node),
    (node) => this.release(node)
  );
  #structure: Signal<number>;

  constructor(
    initial: Iterable<T> = [],
    runtime: IRuntime = defaultRuntime,
    options: IObservableCollectionOptions = {}
  ) {
    const initialValues = materializeIterable(initial, true);
    super(runtime, options, 'ObservableSet');
    for (const value of initialValues) this.#values.add(value);
    this.#structure = this.own(
      internalRuntimeOf(runtime).signal(0, {
        debugName: `${this.debugName}.structure`
      })
    );
  }

  get size(): number {
    this.assertActive();
    void this.#structure.value;
    return this.#values.size;
  }

  has(value: T): boolean {
    this.assertActive();
    if (!isTrackingIn(this.runtime)) return this.#values.has(value);
    return this.#cell(value).value;
  }

  add(value: T): this {
    this.assertMutation('add');
    if (this.#values.has(value)) return this;
    this.runtime.batch(() => {
      this.#values.add(value);
      const cell = this.#cells.get(value);
      if (cell) cell.value = true;
      this.#bumpStructure();
    });
    return this;
  }

  delete(value: T): boolean {
    this.assertMutation('delete');
    if (!this.#values.has(value)) return false;
    this.runtime.batch(() => this.#deleteInternal(value));
    return true;
  }

  clear(): void {
    this.assertMutation('clear');
    if (this.#values.size === 0) return;
    this.runtime.batch(() => {
      for (const value of Array.from(this.#values)) this.#deleteInternal(value);
    });
  }

  #deleteInternal(value: T): void {
    this.#values.delete(value);
    const cell = this.#cells.get(value);
    if (cell) cell.value = false;
    this.#bumpStructure();
    this.#cells.tombstone(value);
  }

  /**
   * Atomically swap the whole set for `next`. Fires at most one structural (`#structure`)
   * notification for the entire swap, unlike `clear()` + per-value `add()` which would fire one per
   * value.
   */
  replace(next: Iterable<T>): void {
    this.assertMutation('replace');
    this.#replaceInternal(new Set(materializeIterable(next, true)));
  }

  valuesArray(): readonly T[] {
    this.assertActive();
    void this.#structure.value;
    return Object.freeze([...this.#values]);
  }

  snapshot(): ReadonlySet<T> {
    this.assertActive();
    void this.#structure.value;
    return new Set(this.#values);
  }

  /** Release cells for deleted values that no observer still references. */
  prune(): number {
    this.assertActive();
    return this.#cells.pruneStale((value) => this.#values.has(value));
  }

  #cell(value: T): Signal<boolean> {
    return this.#cells.getOrCreate(value, () =>
      internalRuntimeOf(this.runtime).signal(this.#values.has(value), {
        debugName: `${this.debugName}.member`
      })
    );
  }

  #replaceInternal(next: Set<T>): void {
    const previous = this.#values;
    this.runtime.batch(() => {
      this.#values = next;
      // Walk the materialized cells, not every value of `next`: an
      // untracked value has no cell to notify — it picks up `next` directly
      // on first read (see `#cell()`).
      for (const [value, cell] of this.#cells) {
        cell.value = next.has(value);
      }
      const changed =
        previous.size !== next.size || [...previous].some((value) => !next.has(value));
      if (changed) this.#bumpStructure();
    });
  }

  #bumpStructure(): void {
    this.#structure.value = this.#structure.peek() + 1;
  }
}

export function observableObject<T extends Record<string, unknown>>(
  initial: T,
  options: IObservableCollectionOptions = {},
  runtime: IRuntime = defaultRuntime
): ObservableObject<T> {
  return new ObservableObject(initial, runtime, options);
}

export function observableArray<T>(
  initial: Iterable<T> = [],
  options: IObservableCollectionOptions = {},
  runtime: IRuntime = defaultRuntime
): ObservableArray<T> {
  return new ObservableArray(initial, runtime, options);
}

export function observableMap<K, V>(
  initial: ReadonlyMap<K, V> | Iterable<readonly [K, V]> = [],
  options: IObservableCollectionOptions = {},
  runtime: IRuntime = defaultRuntime
): ObservableMap<K, V> {
  return new ObservableMap(initial, runtime, options);
}

export function observableSet<T>(
  initial: Iterable<T> = [],
  options: IObservableCollectionOptions = {},
  runtime: IRuntime = defaultRuntime
): ObservableSet<T> {
  return new ObservableSet(initial, runtime, options);
}

function freezeArray<T>(values: Iterable<T>): readonly T[] {
  return Object.freeze([...values]);
}

function assertIntegerIndex(index: number): void {
  if (!Number.isInteger(index)) {
    throw createStoreIndexedTypeError(
      StoreIndexedErrorCode.invalidIndex,
      StoreIndexedErrorText.arrayInteger
    );
  }
}
