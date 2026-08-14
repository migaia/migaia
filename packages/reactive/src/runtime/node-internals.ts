import type { IObserver } from '../runtime/types';

const sets = new WeakMap<object, Set<IObserver>>();
const depSets = new WeakMap<object, Set<object>>();
const versionMaps = new WeakMap<object, Map<object, number>>();
const versions = new WeakMap<object, { value: number }>();
const setViewSources = new WeakMap<object, Set<unknown>>();
const mapViewSources = new WeakMap<object, Map<unknown, unknown>>();
const setSourceOf = <T>(view: object): Set<T> => setViewSources.get(view) as Set<T>;
const mapSourceOf = <K, V>(view: object): Map<K, V> => mapViewSources.get(view) as Map<K, V>;

class ReadonlySetView<T> implements ReadonlySet<T> {
  readonly [Symbol.toStringTag] = 'Set';
  constructor(source: Set<T>) {
    setViewSources.set(this, source as Set<unknown>);
  }
  get size(): number {
    return setSourceOf<T>(this).size;
  }
  has(value: T): boolean {
    return setSourceOf<T>(this).has(value);
  }
  entries(): SetIterator<[T, T]> {
    return setSourceOf<T>(this).entries();
  }
  keys(): SetIterator<T> {
    return setSourceOf<T>(this).keys();
  }
  values(): SetIterator<T> {
    return setSourceOf<T>(this).values();
  }
  forEach(callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
    setSourceOf<T>(this).forEach((value) => callbackfn.call(thisArg, value, value, this));
  }
  [Symbol.iterator](): SetIterator<T> {
    return setSourceOf<T>(this)[Symbol.iterator]();
  }
}

class ReadonlyMapView<K, V> implements ReadonlyMap<K, V> {
  readonly [Symbol.toStringTag] = 'Map';
  constructor(source: Map<K, V>) {
    mapViewSources.set(this, source as Map<unknown, unknown>);
  }
  get size(): number {
    return mapSourceOf<K, V>(this).size;
  }
  has(key: K): boolean {
    return mapSourceOf<K, V>(this).has(key);
  }
  get(key: K): V | undefined {
    return mapSourceOf<K, V>(this).get(key);
  }
  entries(): MapIterator<[K, V]> {
    return mapSourceOf<K, V>(this).entries();
  }
  keys(): MapIterator<K> {
    return mapSourceOf<K, V>(this).keys();
  }
  values(): MapIterator<V> {
    return mapSourceOf<K, V>(this).values();
  }
  forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
    mapSourceOf<K, V>(this).forEach((value, key) => callbackfn.call(thisArg, value, key, this));
  }
  [Symbol.iterator](): MapIterator<[K, V]> {
    return mapSourceOf<K, V>(this)[Symbol.iterator]();
  }
}

export function registerVersion(node: object, initial: number): void {
  versions.set(node, { value: initial });
}

export function setVersion(node: object, value: number): void {
  const state = versions.get(node);
  if (state) state.value = value;
  else (node as { version: number }).version = value;
}

export function readVersion(node: object, fallback: number): number {
  return versions.get(node)?.value ?? fallback;
}

/** Register a built-in node's mutable edge set without exposing that set. */
export function registerSubs(node: object, subs: Set<IObserver>): ReadonlySet<IObserver> {
  sets.set(node, subs);
  return new ReadonlySetView(subs);
}

export function mutableSubs(node: object, fallback: ReadonlySet<IObserver>): Set<IObserver> {
  return sets.get(node) ?? (fallback as Set<IObserver>);
}

export function registerDeps<T extends object>(node: object, deps: Set<T>): ReadonlySet<T> {
  depSets.set(node, deps as Set<object>);
  return new ReadonlySetView(deps);
}

export function mutableDeps<T extends object>(node: object, fallback: ReadonlySet<T>): Set<T> {
  return (depSets.get(node) as Set<T> | undefined) ?? (fallback as Set<T>);
}

export function registerDepVersions<T extends object>(
  node: object,
  versions: Map<T, number>
): ReadonlyMap<T, number> {
  versionMaps.set(node, versions as Map<object, number>);
  return new ReadonlyMapView(versions);
}

export function mutableDepVersions<T extends object>(
  node: object,
  fallback: ReadonlyMap<T, number>
): Map<T, number> {
  return (versionMaps.get(node) as Map<T, number> | undefined) ?? (fallback as Map<T, number>);
}
