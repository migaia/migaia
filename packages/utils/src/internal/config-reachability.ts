/** Copy-on-write root reachability and shared-node seeding; no cloning or publication policy. */
import { hasBuiltinBrand } from './config-state.ts'

/** Repoints direct old-root edges held by cloned callable prototype objects. */
export function rebaseCallablePrototypeRoots(
  root: Record<PropertyKey, unknown>,
  oldRoot: object
): void {
  /** Several callable properties may share one prototype; inspect each owned prototype once. */
  const visited = new WeakSet<object>()
  for (const key of Reflect.ownKeys(root)) {
    /** This edge value is captured once before deletion, rebasing or graph projection. */
    const value = root[key]
    if (typeof value !== 'function') continue
    /** Only the callable prototype owns the root edges considered by this rebasing pass. */
    const prototype = Object.getPrototypeOf(value)
    if (prototype === null || visited.has(prototype)) continue
    visited.add(prototype)
    for (const prototypeKey of Reflect.ownKeys(prototype)) {
      /** Inspect the current data descriptor without invoking an accessor or losing its flags. */
      const descriptor = Object.getOwnPropertyDescriptor(prototype, prototypeKey)
      if (descriptor && 'value' in descriptor && descriptor.value === oldRoot)
        Object.defineProperty(prototype, prototypeKey, { ...descriptor, value: root })
    }
  }
}

/** Index the existing reachability grammar once, in O(nodes + edges), including cycles. */
export class ConfigRootReachability {
  /** A reverse edge is retained only when the original root search follows that edge kind. */
  #parents = new Map<object, object[]>()
  /** Every node is inspected once while collecting the union of clone-sharing edges. */
  #visited = new Set<object>()
  /** Nodes with a path to the replaced root must be cloned rather than reused. */
  #reaching = new Set<object>()

  /** Collect edges, then propagate root reachability once through reverse adjacency. */
  constructor(root: object) {
    this.#collect(root)
    /** A cursor queue visits each reaching node at most once. */
    const pending: object[] = [root]
    this.#reaching.add(root)
    for (let cursor = 0; cursor < pending.length; cursor++) {
      for (const parent of this.#parents.get(pending[cursor]!) ?? []) {
        if (this.#reaching.has(parent)) continue
        this.#reaching.add(parent)
        pending.push(parent)
      }
    }
  }

  /** Primitive values never participate in graph identity. */
  has(value: unknown): boolean {
    return (
      value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      this.#reaching.has(value)
    )
  }

  /** Collect candidate nodes once while marking the original search's exact semantic edges. */
  #collect(value: unknown): void {
    if (
      value === null ||
      (typeof value !== 'object' && typeof value !== 'function') ||
      this.#visited.has(value)
    )
      return
    this.#visited.add(value)
    /** Maps and sets expose only entries to root reachability, but sharing also visits own data. */
    const map = value instanceof Map && hasBuiltinBrand(value, 'map')
    /** Preserve the original brand-checked collection distinction. */
    const set = !map && value instanceof Set && hasBuiltinBrand(value, 'set')
    if (map) {
      for (const [key, entry] of Reflect.apply(Map.prototype.entries, value, []) as Iterable<
        readonly [unknown, unknown]
      >) {
        this.#edge(value, key, true)
        this.#edge(value, entry, true)
      }
    } else if (set) {
      for (const entry of Reflect.apply(Set.prototype.values, value, []) as Iterable<unknown>)
        this.#edge(value, entry, true)
    }
    for (const key of Reflect.ownKeys(value)) {
      /** Owned graphs contain data descriptors; absent/accessor descriptors are not traversal edges. */
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor && 'value' in descriptor) this.#edge(value, descriptor.value, !map && !set)
    }
    this.#edge(value, Object.getPrototypeOf(value), !map && !set)
  }

  /** Store one reverse edge while also discovering nodes reached only by the sharing traversal. */
  #edge(parent: object, child: unknown, searchable: boolean): void {
    if (child === null || (typeof child !== 'object' && typeof child !== 'function')) return
    if (searchable) {
      /** Append in original traversal order; reachability itself is identity based. */
      const parents = this.#parents.get(child) ?? []
      parents.push(parent)
      this.#parents.set(child, parents)
    }
    this.#collect(child)
  }
}

/** Seeds COW clone state with subgraphs that cannot reach the replaced root. */
export function primeSharedNodes(
  value: unknown,
  root: object,
  shared: WeakMap<object, object>,
  rootReachability: ConfigRootReachability,
  visited = new WeakSet<object>()
): void {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return
  /** Identity-based graph bookkeeping excludes primitives before following traversal edges. */
  const objectValue = value as object
  if (visited.has(objectValue) || (objectValue !== root && shared.has(objectValue))) return
  visited.add(objectValue)
  if (objectValue !== root && !rootReachability.has(objectValue)) {
    shared.set(objectValue, objectValue)
    return
  }
  if (objectValue instanceof Map && hasBuiltinBrand(objectValue, 'map')) {
    /** Native iteration preserves this collection edge order while retaining exact node identities. */
    const entries = Reflect.apply(Map.prototype.entries, objectValue, []) as Iterable<
      readonly [unknown, unknown]
    >
    for (const [key, entry] of entries) {
      primeSharedNodes(key, root, shared, rootReachability, visited)
      primeSharedNodes(entry, root, shared, rootReachability, visited)
    }
  } else if (objectValue instanceof Set && hasBuiltinBrand(objectValue, 'set')) {
    /** Native iteration preserves this collection edge order while retaining exact node identities. */
    const entries = Reflect.apply(Set.prototype.values, objectValue, []) as Iterable<unknown>
    for (const entry of entries) primeSharedNodes(entry, root, shared, rootReachability, visited)
  }
  for (const key of Reflect.ownKeys(objectValue)) {
    /** Inspect the current data descriptor without invoking an accessor or losing its flags. */
    const descriptor = Object.getOwnPropertyDescriptor(objectValue, key)
    if (descriptor && 'value' in descriptor)
      primeSharedNodes(descriptor.value, root, shared, rootReachability, visited)
  }
  primeSharedNodes(Object.getPrototypeOf(objectValue), root, shared, rootReachability, visited)
}
