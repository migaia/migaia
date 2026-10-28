/** Compare immutable config branches with pair identity and deterministic first-visit paths. */
import { isPlainObject } from '../object.ts'
import type { IConfigDiffEntry } from '../config-owner.ts'
import { ownValue } from './config-owner-path.ts'

/** Leaf equality used by `diff()` and path-scoped watchers. */
function sameLeaf(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  return left instanceof Date && right instanceof Date && left.getTime() === right.getTime()
}

/** A first-visit path stays linked until a difference needs its public segment list. */
type IConfigDiffPath = Readonly<{ parent: IConfigDiffPath | undefined; key: string }>

/** One pair waiting for the original depth-first comparison. */
type IConfigDiffPair = Readonly<{
  left: unknown
  right: unknown
  path: IConfigDiffPath | undefined
}>

/** One admitted pair retains its own-key order while a child pair is compared. */
type IConfigDiffFrame = IConfigDiffPair & {
  readonly keys: readonly string[]
  index: number
}

/** Materialize only reported paths; equal cycles never copy a growing path prefix. */
function diffPath(root: readonly string[], path: IConfigDiffPath | undefined): readonly string[] {
  if (!path) return root
  /** Reverse linked segments once before appending the caller's original root path. */
  const segments: string[] = []
  for (let node: IConfigDiffPath | undefined = path; node; node = node.parent)
    segments.push(node.key)
  segments.reverse()
  return Object.freeze([...root, ...segments])
}

/**
 * Compare each container pair once, reporting differences at its first depth-first path. Work is
 * linear in the reachable pair graph and emitted path data, not the original node count:
 * differently shaped cycles can reach a Cartesian set of pairs while containing equal data. This
 * diff-specific complexity exception preserves that equality and first-path output contract.
 */
export function collectDiff(
  left: unknown,
  right: unknown,
  path: readonly string[],
  out: IConfigDiffEntry[]
): void {
  /** Pair identity belongs only to this comparison, never to a later diff or notification. */
  const compared = new WeakMap<object, WeakSet<object>>()
  /** Explicit frames preserve recursive key/read order without growing the JavaScript call stack. */
  const frames: IConfigDiffFrame[] = []
  /** The next child is visited before its parent's following key. */
  let pair: IConfigDiffPair | undefined = { left, right, path: undefined }
  while (pair || frames.length > 0) {
    if (pair) {
      /** The pending pair is consumed before its frame can descend again. */
      const current = pair
      pair = undefined
      if (sameLeaf(current.left, current.right)) continue
      if (
        !(
          (Array.isArray(current.left) && Array.isArray(current.right)) ||
          (isPlainObject(current.left) && isPlainObject(current.right))
        )
      ) {
        out.push(Object.freeze({ path: diffPath(path, current.path), kind: 'changed' }))
        continue
      }
      /** Both sides passed the same-kind container check. */
      const before = current.left as object
      /** Right identities are distinct per left node, preserving comparisons against other aliases. */
      const after = current.right as object
      /** Mark before descending so an equal back edge ends without reporting a false difference. */
      const matches = compared.get(before) ?? new WeakSet<object>()
      if (matches.has(after)) continue
      matches.add(after)
      compared.set(before, matches)
      frames.push({
        ...current,
        keys: [...new Set([...Object.keys(before), ...Object.keys(after)])],
        index: 0
      })
    }
    /** The top frame alone selects the next descriptor read, retaining left-key-first order. */
    const frame = frames[frames.length - 1]!
    /** An exhausted frame releases its own keys before its parent advances. */
    const key = frame.keys[frame.index]
    if (key === undefined) {
      frames.pop()
      continue
    }
    frame.index += 1
    /** Linking costs one edge; public arrays are allocated only for actual output entries. */
    const childPath: IConfigDiffPath = { parent: frame.path, key }
    /** Own data values retain their original before-then-after observation order. */
    const before = ownValue(frame.left, key)
    /** Read the next snapshot only after the corresponding previous value was observed. */
    const after = ownValue(frame.right, key)
    if (!before.found) out.push(Object.freeze({ path: diffPath(path, childPath), kind: 'added' }))
    else if (!after.found)
      out.push(Object.freeze({ path: diffPath(path, childPath), kind: 'removed' }))
    else pair = { left: before.value, right: after.value, path: childPath }
  }
}
