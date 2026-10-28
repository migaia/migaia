/**
 * Owns stable integer-key ordering for topology projections and requested subsets. Uses bounded
 * byte buckets; never scans unrelated nodes or executes comparison sorting.
 */
import type { IStoredTopologyNode } from './topology-store.ts'

/** Orders captured nodes by their immutable registration position in linear subset work. */
export function registrationTopologyNodes(
  nodes: Iterable<IStoredTopologyNode>
): IStoredTopologyNode[] {
  return bucketTopologyNodes(Array.from(nodes), (node) => node.ordinal)
}

/** Orders captured nodes by level, retaining registration order within each level. */
export function orderTopologyNodes(nodes: Iterable<IStoredTopologyNode>): IStoredTopologyNode[] {
  return bucketTopologyNodes(registrationTopologyNodes(nodes), (node) => node.level)
}

/**
 * Performs stable least-significant-byte placement over nonnegative topology integer facts. Seven
 * byte passes cover 56 bits. Registration increments saturate at 2^53 in JavaScript, so even that
 * terminal counter value fits; levels cannot exceed the number of present nodes. Both loop bounds
 * are compile-time constants, independent of subset size or removed ordinals.
 */
function bucketTopologyNodes(
  nodes: IStoredTopologyNode[],
  readKey: (node: IStoredTopologyNode) => number
): IStoredTopologyNode[] {
  if (nodes.length < 2) return nodes
  /** Largest key skips byte passes whose digits would all be zero. */
  let maximum = 0
  for (const node of nodes) maximum = Math.max(maximum, readKey(node))
  /** Current stable sequence, replaced only after a complete byte placement. */
  let ordered = nodes
  /** Byte weight stays exact because every factor is a power of two. */
  let factor = 1
  // Seven passes and 256 buckets follow the 56-bit key bound documented above.
  for (let pass = 0; pass < 7 && factor <= maximum; pass += 1) {
    /** One bucket for each possible unsigned byte; missing buckets allocate no list. */
    const buckets: IStoredTopologyNode[][] = []
    for (const node of ordered) {
      /** Fixed-width digit read preserves the complete integer ordering. */
      const digit = Math.floor(readKey(node) / factor) % 256
      ;(buckets[digit] ??= []).push(node)
    }
    /** Flatten once per byte while retaining the previous order inside each bucket. */
    const next: IStoredTopologyNode[] = []
    // The 256 possible unsigned-byte values are a compile-time bound.
    for (let digit = 0; digit < 256; digit += 1) {
      /** Populated bucket contains only this pass's selected subset. */
      const bucket = buckets[digit]
      if (bucket) for (const node of bucket) next.push(node)
    }
    ordered = next
    factor *= 256
  }
  return ordered
}
