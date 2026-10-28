/**
 * Owns canonical graph collections, source version slots and read-only views without scheduling
 * work.
 */
import type { IObserver } from '../runtime/types.ts'
import { forwardCollectionCallback } from './receiver.ts'
import { createReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'

/** Node identity owns writable subscriber membership without extending the node's public shape. */
const sets = new WeakMap<object, Set<IObserver>>()
/** Unobserved notifications share one private empty result without retaining any graph node. */
const EMPTY_SUBSCRIBERS: readonly IObserver[] = []
/**
 * Cached entry snapshots are invalidated by the canonical tracker before any edge mutation
 * callback.
 */
const subscriberSnapshots = new WeakMap<object, readonly IObserver[]>()
/** Observer identity owns mutable dependency membership until its graph lifecycle releases edges. */
const depSets = new WeakMap<object, Set<object>>()
/** Canonical dependency versions remain private while matching public read-only views stay live. */
const versionMaps = new WeakMap<object, Map<object, number>>()
/** Custom source publication advances these slots rather than assigning consumer-owned properties. */
const versions = new WeakMap<object, { value: number }>()
/** Read-only set instances retain backing collections only for the lifetime of each view. */
const setViewSources = new WeakMap<object, Set<unknown>>()
/** Read-only map instances retain backing collections without publishing mutation methods. */
const mapViewSources = new WeakMap<object, Map<unknown, unknown>>()
/**
 * Retrieves the registered backing set for internal view operations without exposing it to
 * callbacks.
 */
const setSourceOf = <T>(view: object): Set<T> => setViewSources.get(view) as Set<T>
/** Retrieves the registered backing map while keeping its authority out of the public view. */
const mapSourceOf = <K, V>(view: object): Map<K, V> => mapViewSources.get(view) as Map<K, V>

/** Live set protocol preserves native iteration and callback receivers while omitting mutation. */
class ReadonlySetView<T> implements ReadonlySet<T> {
  /** Native-compatible brand preserves read-only collection inspection behavior. */
  readonly [Symbol.toStringTag] = 'Set'
  /** Associates this view with exactly one canonical graph set. */
  constructor(source: Set<T>) {
    setViewSources.set(this, source as Set<unknown>)
  }
  /** Reports current membership without creating a snapshot. */
  get size(): number {
    return setSourceOf<T>(this).size
  }
  /** Performs native constant-time membership lookup against the canonical set. */
  has(value: T): boolean {
    return setSourceOf<T>(this).has(value)
  }
  /** Retains native live entry iteration and insertion order. */
  entries(): SetIterator<[T, T]> {
    return setSourceOf<T>(this).entries()
  }
  /** Retains the Set protocol's value-as-key iteration. */
  keys(): SetIterator<T> {
    return setSourceOf<T>(this).keys()
  }
  /** Iterates canonical values without exposing the writable set object. */
  values(): SetIterator<T> {
    return setSourceOf<T>(this).values()
  }
  /** Preserves the caller's receiver but supplies this read-only view as the callback's collection. */
  forEach(callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
    setSourceOf<T>(this).forEach((value, value2) =>
      forwardCollectionCallback(callbackfn as (...args: unknown[]) => void, thisArg, [
        value,
        value2,
        this
      ])
    )
  }
  /** Supports ordinary Set iteration through the canonical collection's native iterator. */
  [Symbol.iterator](): SetIterator<T> {
    return setSourceOf<T>(this)[Symbol.iterator]()
  }
}

/** Live map protocol keeps native lookup and iteration while withholding mutation authority. */
class ReadonlyMapView<K, V> implements ReadonlyMap<K, V> {
  /** Native-compatible brand keeps collection inspection consistent with the map protocol. */
  readonly [Symbol.toStringTag] = 'Map'
  /** Associates this view with one canonical committed-version map. */
  constructor(source: Map<K, V>) {
    mapViewSources.set(this, source as Map<unknown, unknown>)
  }
  /** Reports the backing map's current entry count without copying it. */
  get size(): number {
    return mapSourceOf<K, V>(this).size
  }
  /** Retains native constant-time key membership checks. */
  has(key: K): boolean {
    return mapSourceOf<K, V>(this).has(key)
  }
  /** Reads the current canonical value for one key without exposing the backing map. */
  get(key: K): V | undefined {
    return mapSourceOf<K, V>(this).get(key)
  }
  /** Retains native live entry iteration in committed insertion order. */
  entries(): MapIterator<[K, V]> {
    return mapSourceOf<K, V>(this).entries()
  }
  /** Iterates canonical keys without materializing an intermediate snapshot. */
  keys(): MapIterator<K> {
    return mapSourceOf<K, V>(this).keys()
  }
  /** Iterates canonical values through the backing map's native protocol. */
  values(): MapIterator<V> {
    return mapSourceOf<K, V>(this).values()
  }
  /** Preserves callback receiver semantics while substituting the read-only collection argument. */
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    mapSourceOf<K, V>(this).forEach((value, key) =>
      forwardCollectionCallback(callbackfn as (...args: unknown[]) => void, thisArg, [
        value,
        key,
        this
      ])
    )
  }
  /** Supports ordinary Map iteration without returning a mutable collection reference. */
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

/** Kernel-only lookup prefers registered authority and retains the existing built-in fallback. */
export function mutableSubs(node: object, fallback: ReadonlySet<IObserver>): Set<IObserver> {
  return sets.get(node) ?? (fallback as Set<IObserver>)
}

/** Registers canonical observer dependencies and returns a live view without mutation methods. */
export function registerDeps<T extends object>(node: object, deps: Set<T>): ReadonlySet<T> {
  depSets.set(node, deps as Set<object>)
  return new ReadonlySetView(deps)
}

/** Grants kernel mutation access to the registered dependency set, preserving the existing fallback. */
export function mutableDeps<T extends object>(node: object, fallback: ReadonlySet<T>): Set<T> {
  return (depSets.get(node) as Set<T> | undefined) ?? (fallback as Set<T>)
}

/** Registers the observer's committed versions and publishes only their live read-only protocol. */
export function registerDepVersions<T extends object>(
  node: object,
  versions: Map<T, number>
): ReadonlyMap<T, number> {
  versionMaps.set(node, versions as Map<object, number>)
  return new ReadonlyMapView(versions)
}

/** Resolves canonical writable versions for tracker commits without exposing them through views. */
export function mutableDepVersions<T extends object>(
  node: object,
  fallback: ReadonlyMap<T, number>
): Map<T, number> {
  return (versionMaps.get(node) as Map<T, number> | undefined) ?? (fallback as Map<T, number>)
}
