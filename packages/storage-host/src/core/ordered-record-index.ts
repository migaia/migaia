/** Callers retain one independent canonical byte key for each live entry. */
export type IOrderedRecordLeaf<T> = Readonly<{
  key: Uint8Array
  value: T
  previous: IOrderedRecordLeaf<T> | undefined
  next: IOrderedRecordLeaf<T> | undefined
}>
/** Native bounds already use the canonical order; this structure never encodes a business key. */
export type IOrderedRecordRange = Readonly<{
  lower?: Uint8Array
  upper?: Uint8Array
  lowerOpen?: boolean
  upperOpen?: boolean
}>
/** Physical record owners and private drafts each retain their own index instance. */
export type IOrderedRecordIndex<T> = Readonly<{
  size: number
  first: IOrderedRecordLeaf<T> | undefined
  last: IOrderedRecordLeaf<T> | undefined
  get(key: Uint8Array): IOrderedRecordLeaf<T> | undefined
  set(key: Uint8Array, value: T): IOrderedRecordLeaf<T>
  delete(key: Uint8Array): boolean
  lowerBound(key: Uint8Array, inclusive?: boolean): IOrderedRecordLeaf<T> | undefined
  range(bounds?: IOrderedRecordRange): IterableIterator<IOrderedRecordLeaf<T>>
  clear(): void
}>
/** Only this owner changes adjacency and the current entry attached to a leaf. */
type ILeaf<T> = {
  key: Uint8Array
  value: T
  previous: ILeaf<T> | undefined
  next: ILeaf<T> | undefined
}
/** A compressed edge references a slice of one complete live descendant encoding. */
type INode<T> = {
  key: Uint8Array
  start: number
  end: number
  leaf: ILeaf<T> | undefined
  first: ILeaf<T> | undefined
  last: ILeaf<T> | undefined
  children: (INode<T> | undefined)[] | undefined
  bitmap: Uint32Array | undefined
  count: number
}
/** One bytewise comparison is shared by native range merge and this compressed index. */
export function compareRecordIndexKeys(left: Uint8Array, right: Uint8Array): number {
  /** Only bytes that can differ contribute to the comparison. */
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index++)
    if (left[index] !== right[index]) return left[index]! - right[index]!
  return left.length - right.length
}
/** Construct an edge without copying or concatenating any encoded prefix. */
function node<T>(key: Uint8Array, start: number, end: number, leaf?: ILeaf<T>): INode<T> {
  return {
    key,
    start,
    end,
    leaf,
    first: leaf,
    last: leaf,
    children: undefined,
    bitmap: undefined,
    count: 0
  }
}
/** Direct slots and eight fixed words admit a child without sorting siblings. */
function putChild<T>(parent: INode<T>, slot: number, child: INode<T>): void {
  parent.children ??= Array.from({ length: 256 }, () => undefined)
  parent.bitmap ??= new Uint32Array(8)
  if (parent.children[slot] === undefined) parent.count++
  parent.children[slot] = child
  parent.bitmap[slot >>> 5] = (parent.bitmap[slot >>> 5]! | (1 << (slot & 31))) >>> 0
}
/** Removing one slot updates only its fixed word and child count. */
function removeChild<T>(parent: INode<T>, slot: number): void {
  parent.children![slot] = undefined
  parent.bitmap![slot >>> 5] = (parent.bitmap![slot >>> 5]! & ~(1 << (slot & 31))) >>> 0
  parent.count--
  if (parent.count === 0) {
    parent.children = undefined
    parent.bitmap = undefined
  }
}
/** Find the first occupied byte slot at or above a bound using the fixed alphabet bitmap. */
function nextChild<T>(parent: INode<T>, from: number): INode<T> | undefined {
  if (!parent.bitmap || from > 255) return undefined
  /** The first word discards smaller sibling slots before scanning the remaining seven words. */
  let word = from >>> 5
  let bits = (parent.bitmap[word]! & (0xffffffff << (from & 31))) >>> 0
  while (word < 8) {
    if (bits !== 0) return parent.children![(word << 5) + 31 - Math.clz32(bits & -bits)]
    word++
    bits = parent.bitmap[word] ?? 0
  }
  return undefined
}
/** Find the last occupied byte slot at or below a bound without comparison sorting. */
function previousChild<T>(parent: INode<T>, from: number): INode<T> | undefined {
  if (!parent.bitmap || from < 0) return undefined
  /** The first word discards larger sibling slots before scanning the remaining fixed words. */
  let word = from >>> 5
  let bits = (parent.bitmap[word]! & (0xffffffff >>> (31 - (from & 31)))) >>> 0
  while (word >= 0) {
    if (bits !== 0) return parent.children![(word << 5) + 31 - Math.clz32(bits)]
    word--
    bits = parent.bitmap[word] ?? 0
  }
  return undefined
}
/** Extrema and edge representatives change on exactly the modified ancestor path. */
function refresh<T>(current: INode<T>, root: INode<T>): void {
  current.first = current.leaf ?? nextChild(current, 0)?.first
  current.last = previousChild(current, 255)?.last ?? current.leaf
  if (current !== root && current.first) current.key = current.first.key
}
/** Build the single package-private compressed radix implementation for one mutable data owner. */

/** One compressed record index owns only its original root and live leaf count. */
type IOrderedRecordContext<T> = {
  /** The root has no edge and cannot retain a deleted descendant key as a representative. */
  root: INode<T>

  /** Live leaf count changes independently from overwrite of an existing entry reference. */
  size: number
}
export function createOrderedRecordIndex<T>(): IOrderedRecordIndex<T> {
  /** Initialize native facts in original construction order before publishing any port. */
  const indexState = {} as IOrderedRecordContext<T>

  /** The root has no edge and cannot retain a deleted descendant key as a representative. */
  indexState.root = node<T>(new Uint8Array(), 0, 0)

  /** Live leaf count changes independently from overwrite of an existing entry reference. */
  indexState.size = 0
  return createOrderedRecordMethods(indexState)
}

/** Locate an exact leaf while retaining only its actual compressed ancestor path. */
function locate<T>(
  indexState: IOrderedRecordContext<T>,
  key: Uint8Array
): { current: INode<T>; path: INode<T>[] } | undefined {
  /** A single path also supplies bounded deletion repair. */
  const path = [indexState.root]
  /** Current depth is the matched prefix length in the independently held key. */
  let current = indexState.root
  let depth = 0
  while (depth < key.length) {
    /** The first unmatched byte selects one direct child slot. */
    const child = current.children?.[key[depth]!]
    if (!child) return undefined
    for (let index = child.start; index < child.end; index++) {
      if (depth >= key.length || key[depth] !== child.key[index]) return undefined
      depth++
    }
    current = child
    path.push(current)
  }
  return { current, path }
}

/** Seek only the boundary path; the closest higher sibling supplies its already known first leaf. */
function seek<T>(indexState: IOrderedRecordContext<T>, key: Uint8Array): ILeaf<T> | undefined {
  /** A candidate is the first leaf outside the current subtree and above the bound. */
  let candidate: ILeaf<T> | undefined
  /** Matched prefix depth advances through compressed edges without copying their bytes. */
  let depth = 0
  let current = indexState.root
  while (depth < key.length) {
    /** A nearer higher sibling always precedes any previously captured ancestor sibling. */
    const higher = nextChild(current, key[depth]! + 1)
    if (higher) candidate = higher.first
    /** Exact byte slot may still diverge inside its compressed edge. */
    const child = current.children?.[key[depth]!]
    if (!child) return candidate
    for (let index = child.start; index < child.end; index++) {
      if (depth === key.length) return child.first
      if (child.key[index] !== key[depth])
        return child.key[index]! > key[depth]! ? child.first : candidate
      depth++
    }
    current = child
  }
  return current.first
}

/** The same seek path serves inclusive and exclusive native lower bounds. */
function lowerBound<T>(
  indexState: IOrderedRecordContext<T>,
  key: Uint8Array,
  inclusive = true
): ILeaf<T> | undefined {
  /** An exclusive exact hit advances through the leaf's constant-time adjacency link. */
  const result = seek(indexState, key)
  return !inclusive && result && compareRecordIndexKeys(result.key, key) === 0
    ? result.next
    : result
}
/** Publish index ports over the same explicit radix state. */
function createOrderedRecordMethods<T>(
  indexState: IOrderedRecordContext<T>
): IOrderedRecordIndex<T> {
  return {
    get size() {
      return indexState.size
    },
    get first() {
      return indexState.root.first
    },
    get last() {
      return indexState.root.last
    },
    get: (key: Uint8Array) => locate(indexState, key)?.current.leaf,
    set: (key: Uint8Array, value: T) => orderedRecordSet(indexState, key, value),
    delete: (key: Uint8Array) => orderedRecordDelete(indexState, key),
    lowerBound: (key: Uint8Array, inclusive = true) => lowerBound(indexState, key, inclusive),
    range: (bounds?: IOrderedRecordRange) => orderedRecordRange(indexState, bounds),
    clear: () => orderedRecordClear(indexState)
  }
}

/** Perform set on this owner's original compressed radix state. */
function orderedRecordSet<T>(
  indexState: IOrderedRecordContext<T>,
  key: Uint8Array,
  value: T
): ILeaf<T> {
  /** Overwriting one entry never changes structure, adjacency or its already held key bytes. */
  const existing = locate(indexState, key)?.current.leaf
  if (existing) {
    existing.value = value
    return existing
  }
  /** Neighbors are captured before adding the new leaf to the tree. */
  const after = seek(indexState, key)
  const before = after?.previous ?? (after ? undefined : indexState.root.last)
  /** One real live leaf retains one canonical key and one entry reference. */
  const leaf: ILeaf<T> = { key, value, previous: before, next: after }
  if (before) before.next = leaf
  if (after) after.previous = leaf
  /** The changed path is repaired in reverse after at most one compressed edge split. */
  const path = [indexState.root]
  let current = indexState.root
  let depth = 0
  while (depth < key.length) {
    /** Direct slot selection needs no sibling enumeration. */
    const slot = key[depth]!
    const child = current.children?.[slot]
    if (!child) {
      putChild(current, slot, node(key, depth, key.length, leaf))
      break
    }
    /** Compare each matched edge byte once before locating its first difference. */
    let index = child.start
    while (index < child.end && depth < key.length && child.key[index] === key[depth]) {
      index++
      depth++
    }
    if (index !== child.end) {
      /**
       * The branch edge shares its live representative until reverse-path repair chooses its first
       * leaf.
       */
      const branch = node<T>(child.key, child.start, index)
      putChild(current, slot, branch)
      child.start = index
      putChild(branch, child.key[index]!, child)
      if (depth === key.length) branch.leaf = leaf
      else putChild(branch, key[depth]!, node(key, depth, key.length, leaf))
      path.push(branch)
      break
    }
    current = child
    path.push(current)
  }
  if (depth === key.length && !path[path.length - 1]!.leaf) path[path.length - 1]!.leaf = leaf
  indexState.size++
  for (let index = path.length - 1; index >= 0; index--) refresh(path[index]!, indexState.root)
  return leaf
}
/** Perform delete on this owner's original compressed radix state. */
function orderedRecordDelete<T>(indexState: IOrderedRecordContext<T>, key: Uint8Array): boolean {
  /** Only exact membership may unlink a native entry. */
  const found = locate(indexState, key)
  const leaf = found?.current.leaf
  if (!found || !leaf) return false
  if (leaf.previous) leaf.previous.next = leaf.next
  if (leaf.next) leaf.next.previous = leaf.previous
  leaf.previous = undefined
  leaf.next = undefined
  found.current.leaf = undefined
  indexState.size--
  for (let index = found.path.length - 1; index > 0; index--) {
    /** Every potential representative of the deleted leaf lies on this one ancestor path. */
    const current = found.path[index]!
    const parent = found.path[index - 1]!
    const slot = current.key[current.start]!
    if (!current.leaf && current.count === 0) removeChild(parent, slot)
    else if (!current.leaf && current.count === 1) {
      /** Merge adjacent single-branch edges by widening the live child's referenced interval. */
      const child = nextChild(current, 0)!
      child.start = current.start
      putChild(parent, slot, child)
      refresh(child, indexState.root)
    } else refresh(current, indexState.root)
  }
  refresh(indexState.root, indexState.root)
  return true
}
/** Perform range on this owner's original compressed radix state. */
function* orderedRecordRange<T>(
  indexState: IOrderedRecordContext<T>,
  bounds?: IOrderedRecordRange
): IterableIterator<ILeaf<T>> {
  /** Range localization never walks leaves preceding its lower byte boundary. */
  let current =
    bounds?.lower === undefined
      ? indexState.root.first
      : lowerBound(indexState, bounds.lower, !bounds.lowerOpen)
  while (current) {
    if (bounds?.upper !== undefined) {
      /** Each candidate contributes at most its own actual key bytes to the upper-bound check. */
      const comparison = compareRecordIndexKeys(current.key, bounds.upper)
      if (comparison > 0 || (comparison === 0 && bounds.upperOpen)) return
    }
    yield current
    current = current.next
  }
}
/** Perform clear on this owner's original compressed radix state. */
function orderedRecordClear<T>(indexState: IOrderedRecordContext<T>): void {
  /** Detach existing leaf links before releasing all edge and entry references at the root. */
  let current = indexState.root.first
  while (current) {
    const next = current.next
    current.previous = undefined
    current.next = undefined
    current = next
  }
  indexState.root.leaf = undefined
  indexState.root.first = undefined
  indexState.root.last = undefined
  indexState.root.children = undefined
  indexState.root.bitmap = undefined
  indexState.root.count = 0
  indexState.size = 0
}
