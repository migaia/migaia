import type { IObserver } from '../runtime/types.js'
import { forwardCollectionCallback } from './receiver.js'
import { createReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'

const sets = new WeakMap<object, Set<IObserver>>()
/** Unobserved notifications share one private empty result without retaining any graph node. */
const EMPTY_SUBSCRIBERS: readonly IObserver[] = []
/**
 * Cached entry snapshots are invalidated by the canonical tracker before any edge mutation
 * callback.
 */
const subscriberSnapshots = new WeakMap<object, readonly IObserver[]>()
const depSets = new WeakMap<object, Set<object>>()
const versionMaps = new WeakMap<object, Map<object, number>>()
const versions = new WeakMap<object, { value: number }>()
const setViewSources = new WeakMap<object, Set<unknown>>()
const mapViewSources = new WeakMap<object, Map<unknown, unknown>>()
const setSourceOf = <T>(view: object): Set<T> => setViewSources.get(view) as Set<T>
const mapSourceOf = <K, V>(view: object): Map<K, V> => mapViewSources.get(view) as Map<K, V>

class ReadonlySetView<T> implements ReadonlySet<T> {
  readonly [Symbol.toStringTag] = 'Set'
  constructor(source: Set<T>) {
    setViewSources.set(this, source as Set<unknown>)
  }
  get size(): number {
    return setSourceOf<T>(this).size
  }
  has(value: T): boolean {
    return setSourceOf<T>(this).has(value)
  }
  entries(): SetIterator<[T, T]> {
    return setSourceOf<T>(this).entries()
  }
  keys(): SetIterator<T> {
    return setSourceOf<T>(this).keys()
  }
  values(): SetIterator<T> {
    return setSourceOf<T>(this).values()
  }
  forEach(callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
    setSourceOf<T>(this).forEach((value, value2) =>
      forwardCollectionCallback(callbackfn as (...args: unknown[]) => void, thisArg, [
        value,
        value2,
        this
      ])
    )
  }
  [Symbol.iterator](): SetIterator<T> {
    return setSourceOf<T>(this)[Symbol.iterator]()
  }
}

class ReadonlyMapView<K, V> implements ReadonlyMap<K, V> {
  readonly [Symbol.toStringTag] = 'Map'
  constructor(source: Map<K, V>) {
    mapViewSources.set(this, source as Map<unknown, unknown>)
  }
  get size(): number {
    return mapSourceOf<K, V>(this).size
  }
  has(key: K): boolean {
    return mapSourceOf<K, V>(this).has(key)
  }
  get(key: K): V | undefined {
    return mapSourceOf<K, V>(this).get(key)
  }
  entries(): MapIterator<[K, V]> {
    return mapSourceOf<K, V>(this).entries()
  }
  keys(): MapIterator<K> {
    return mapSourceOf<K, V>(this).keys()
  }
  values(): MapIterator<V> {
    return mapSourceOf<K, V>(this).values()
  }
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    mapSourceOf<K, V>(this).forEach((value, key) =>
      forwardCollectionCallback(callbackfn as (...args: unknown[]) => void, thisArg, [
        value,
        key,
        this
      ])
    )
  }
  [Symbol.iterator](): MapIterator<[K, V]> {
    return mapSourceOf<K, V>(this)[Symbol.iterator]()
  }
}

/** Registers the canonical version slot used by custom sources before they enter the graph. */
export function registerVersion(node: object, initial: number): void {
  versions.set(node, { value: initial })
}

/** Runtime source publication updates only registered slots; built-in nodes own their versions. */
export function setVersion(node: object, value: number): void {
  versions.get(node)!.value = value
}

/** Reads a bound source's version without falling back to writable node properties. */
export function readVersion(node: object): number {
  return versions.get(node)!.value
}

/** A new extension binding must not replace bookkeeping retained by live graph edges. */
export function assertGraphNodeUnregistered(node: object): void {
  if (sets.has(node) || depSets.has(node)) {
    throw createReactiveError(
      ReactiveErrorCode.graphNodeRegistered,
      ReactiveErrorText.graphNodeAlreadyRegistered
    )
  }
}

/** Register a built-in node's mutable edge set without exposing that set. */
export function registerSubs(node: object, subs: Set<IObserver>): ReadonlySet<IObserver> {
  sets.set(node, subs)
  return new ReadonlySetView(subs)
}

/** Returns the current entry snapshot; stable topology performs no per-notification allocation. */
export function snapshotSubs(node: object, fallback: ReadonlySet<IObserver>): readonly IObserver[] {
  /** Extensions can synchronously reconnect during markDirty, so the live set must not escape here. */
  const source = mutableSubs(node, fallback)
  if (source.size === 0) return EMPTY_SUBSCRIBERS
  /** Cache the native Set snapshot, bypassing readonly-view iteration in the kernel. */
  let snapshot = subscriberSnapshots.get(node)
  if (snapshot === undefined) {
    snapshot = Array.from(source)
    subscriberSnapshots.set(node, snapshot)
  }
  return snapshot
}

/** Drops retained observers before changed membership can invoke lifecycle or diagnostic callbacks. */
export function invalidateSubsSnapshot(node: object): void {
  subscriberSnapshots.delete(node)
}

export function mutableSubs(node: object, fallback: ReadonlySet<IObserver>): Set<IObserver> {
  return sets.get(node) ?? (fallback as Set<IObserver>)
}

export function registerDeps<T extends object>(node: object, deps: Set<T>): ReadonlySet<T> {
  depSets.set(node, deps as Set<object>)
  return new ReadonlySetView(deps)
}

export function mutableDeps<T extends object>(node: object, fallback: ReadonlySet<T>): Set<T> {
  return (depSets.get(node) as Set<T> | undefined) ?? (fallback as Set<T>)
}

export function registerDepVersions<T extends object>(
  node: object,
  versions: Map<T, number>
): ReadonlyMap<T, number> {
  versionMaps.set(node, versions as Map<object, number>)
  return new ReadonlyMapView(versions)
}

export function mutableDepVersions<T extends object>(
  node: object,
  fallback: ReadonlyMap<T, number>
): Map<T, number> {
  return (versionMaps.get(node) as Map<T, number> | undefined) ?? (fallback as Map<T, number>)
}
