import {
  TopologyInvalidReason,
  type ITopologyDependency,
  type ITopologyInvalidReason
} from './topology.js'
import { attachSecondaryErrors } from '@migaia/utils/error'

/** Getter metadata reaches caller-owned policy while the pure boundary retains the original cause. */
export type ITopologySnapshotFailure = (
  reason: ITopologyInvalidReason,
  nodeId?: string,
  failure?: { readonly cause: unknown }
) => never

/** Preserves captured getter failures without replacing a caller adapter's native error identity. */
export function retainTopologyFailure(
  onInvalid: ITopologySnapshotFailure
): ITopologySnapshotFailure {
  return (...args) => {
    /** Failure presence is distinct from its payload, which may intentionally be undefined. */
    const failure = args[2]
    try {
      return onInvalid(...args)
    } catch (primary) {
      if (failure === undefined || primary === failure.cause) throw primary
      throw attachSecondaryErrors(primary, [failure.cause])
    }
  }
}

/** Structural records include callable objects, as accepted by both existing topology entries. */
export const isTopologyRecord = (value: unknown): value is Record<string, unknown> =>
  (typeof value === 'object' && value !== null) || typeof value === 'function'

/** Admits one stable nonempty ID without coupling pure topology to package error constructors. */
export function admitTopologyId(value: unknown, onInvalid: ITopologySnapshotFailure): string {
  if (typeof value !== 'string' || value.length === 0)
    onInvalid(TopologyInvalidReason.invalidNode, typeof value === 'string' ? value : undefined)
  return value
}

/** Captures array membership first, then reads each edge's provider/required fields once. */
export function snapshotTopologyDependencies(
  value: unknown,
  nodeId: string,
  onInvalid: ITopologySnapshotFailure
): readonly ITopologyDependency[] {
  if (!Array.isArray(value)) onInvalid(TopologyInvalidReason.invalidNode, nodeId)
  /** A stable membership snapshot prevents edge accessors from rewriting later input entries. */
  let candidates: unknown[]
  try {
    candidates = value.slice()
  } catch (cause) {
    onInvalid(TopologyInvalidReason.invalidNode, nodeId, { cause })
  }
  /** Provider uniqueness is part of edge admission in every topology consumer. */
  const providers = new Set<string>()
  /** Only immutable scalar edge facts escape into indexes and lifecycle definitions. */
  const snapshots: ITopologyDependency[] = []
  for (const candidate of candidates) {
    if (!isTopologyRecord(candidate)) onInvalid(TopologyInvalidReason.invalidNode, nodeId)
    /** Capture both accessors before checking either value, preserving the existing edge protocol. */
    let provider: unknown
    /** Required remains a boolean; static Graph separately restricts its own definitions to true. */
    let required: unknown
    try {
      provider = candidate.provider
      required = candidate.required
    } catch (cause) {
      onInvalid(TopologyInvalidReason.invalidNode, nodeId, { cause })
    }
    if (typeof provider !== 'string' || provider.length === 0 || typeof required !== 'boolean')
      onInvalid(TopologyInvalidReason.invalidNode, nodeId)
    if (providers.has(provider)) onInvalid(TopologyInvalidReason.duplicateEdge, nodeId)
    providers.add(provider)
    snapshots.push(Object.freeze({ provider, required }))
  }
  return Object.freeze(snapshots)
}

/** Captures an incremental node once; registration ordinals remain owned by the index. */
export function snapshotTopologyIndexNode(
  candidate: unknown,
  onInvalid: ITopologySnapshotFailure
): Readonly<{ id: string; dependencies: readonly ITopologyDependency[] }> {
  if (!isTopologyRecord(candidate)) onInvalid(TopologyInvalidReason.invalidNode)
  /** Public node identity read once before any index mutation. */
  let id: unknown
  /** Caller edge list read once in the same admission boundary. */
  let dependencies: unknown
  try {
    id = candidate.id
    dependencies = candidate.dependencies
  } catch (cause) {
    onInvalid(TopologyInvalidReason.invalidNode, undefined, { cause })
  }
  /** Stable admitted identity for all subsequent diagnostics. */
  const nodeId = admitTopologyId(id, onInvalid)
  return Object.freeze({
    id: nodeId,
    dependencies: snapshotTopologyDependencies(dependencies, nodeId, onInvalid)
  })
}

/** Creates a mutation-incapable map facade over an immutable entry snapshot. */
export function createTopologyReadonlyMap<K, V>(
  entries: readonly (readonly [K, V])[]
): ReadonlyMap<K, V> {
  /** Private lookup hidden behind the frozen facade. */
  const lookup = new Map(entries)
  /** Read-only map implementation returned to callers. */
  const facade = {
    get: (key: K): V | undefined => lookup.get(key),
    has: (key: K): boolean => lookup.has(key),
    get size(): number {
      return lookup.size
    },
    entries: (): MapIterator<[K, V]> => lookup.entries(),
    keys: (): MapIterator<K> => lookup.keys(),
    values: (): MapIterator<V> => lookup.values(),
    forEach: (
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown
    ): void => {
      for (const [key, value] of lookup) Reflect.apply(callback, thisArg, [value, key, facade])
    },
    [Symbol.iterator]: (): MapIterator<[K, V]> => lookup[Symbol.iterator]()
  } as ReadonlyMap<K, V>
  return Object.freeze(facade)
}
