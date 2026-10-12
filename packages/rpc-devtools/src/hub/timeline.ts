import type { IRpcDevtoolsTimelineEvent, IRpcDevtoolsTimelineQuery } from './types.js'

/** Timeline queries consume each target's retained, sequence-ordered ring without copying it. */
export type IHubTimelineSource = Readonly<{
  name: string
  events: readonly (IRpcDevtoolsTimelineEvent | undefined)[]
  head: number
  count: number
}>

/** A comparator is selected once per query; the acceptance seam counts heap comparisons. */
type IHubTimelineComparator = (
  left: IRpcDevtoolsTimelineEvent,
  right: IRpcDevtoolsTimelineEvent
) => number

/** One cursor per selected target carries the next retained event through the merge heap. */
type IHubTimelineCursor = {
  source: IHubTimelineSource
  position: number
  event: IRpcDevtoolsTimelineEvent
}

/** Compare aligned time, then target name and sequence, independently of target arrival order. */
export function compareTimelineEvents(
  left: IRpcDevtoolsTimelineEvent,
  right: IRpcDevtoolsTimelineEvent
): number {
  if (left.alignedAt !== right.alignedAt) return left.alignedAt - right.alignedAt
  if (left.target !== right.target) return left.target < right.target ? -1 : 1
  return left.event.seq - right.event.seq
}

/** Select a retained event using the service's strings and inclusive aligned-time boundaries. */
function matchesTimelineQuery(
  event: IRpcDevtoolsTimelineEvent,
  query: IRpcDevtoolsTimelineQuery | undefined
): boolean {
  if (query === undefined) return true
  if (query.stages !== undefined && !query.stages.includes(event.event.stage)) return false
  if (query.trace !== undefined && query.trace !== event.trace) return false
  if (query.method !== undefined && query.method !== event.event.method) return false
  if (query.from !== undefined && event.alignedAt < query.from) return false
  if (query.to !== undefined && event.alignedAt > query.to) return false
  return true
}

/** Find the next matching ring position; filtering preserves the target's sequence order. */
function nextTimelinePosition(
  source: IHubTimelineSource,
  position: number,
  query: IRpcDevtoolsTimelineQuery | undefined
): number {
  while (position < source.count) {
    /** The physical ring slot exposes the wrapper created once during ingestion. */
    const event = source.events[(source.head + position) % source.events.length]
    if (event !== undefined && matchesTimelineQuery(event, query)) return position
    position++
  }
  return source.count
}

/** Restore the min-heap after insertion without creating an event wrapper or callback. */
function siftTimelineUp(
  heap: IHubTimelineCursor[],
  position: number,
  compare: IHubTimelineComparator
): void {
  /** The inserted cursor is moved as one reference while ancestors fill its old slot. */
  const cursor = heap[position]!
  while (position > 0) {
    /** Integer parent indexing keeps the query's merge state bounded by target count. */
    const parent = (position - 1) >>> 1
    /** The ancestor already belongs to the heap and retains its target cursor. */
    const ancestor = heap[parent]!
    if (compare(cursor.event, ancestor.event) >= 0) break
    heap[position] = ancestor
    position = parent
  }
  heap[position] = cursor
}

/** Restore the min-heap after advancing or removing its smallest target cursor. */
function siftTimelineDown(heap: IHubTimelineCursor[], compare: IHubTimelineComparator): void {
  /** The replacement cursor moves downward through the smaller child at each level. */
  const cursor = heap[0]!
  /** The root is the only potentially unordered position after consuming one event. */
  let position = 0
  while (true) {
    /** A binary heap has no children once the left slot exceeds its retained cursor count. */
    let child = position * 2 + 1
    if (child >= heap.length) break
    /** The right child is consulted only when the complete heap level contains it. */
    const right = child + 1
    if (right < heap.length && compare(heap[right]!.event, heap[child]!.event) < 0) child = right
    if (compare(cursor.event, heap[child]!.event) <= 0) break
    heap[position] = heap[child]!
    position = child
  }
  heap[position] = cursor
}

/**
 * Merge sequence-ordered target rings in O(n log k), returning their stored event references.
 * Target clocks preserve per-target time order; alignment subtracts one offset for the whole ring.
 * For A3's three targets, each consumed event needs at most two sift comparisons, plus setup.
 */
export function mergeTimeline(
  targets: Iterable<IHubTimelineSource>,
  query?: IRpcDevtoolsTimelineQuery,
  compare: IHubTimelineComparator = compareTimelineEvents
): IRpcDevtoolsTimelineEvent[] {
  /** The public query owns its result array; SC9 permits its elements as retained references. */
  const result: IRpcDevtoolsTimelineEvent[] = []
  /** The public hub validates limits; absence permits the entire retained timeline. */
  const limit = query?.limit ?? Infinity
  if (limit === 0) return result
  /** Only one cursor per selected, nonempty target is held by the query. */
  const heap: IHubTimelineCursor[] = []
  for (const source of targets) {
    if (query?.targets !== undefined && !query.targets.includes(source.name)) continue
    /** Filters advance within the original ring rather than constructing intermediate arrays. */
    const position = nextTimelinePosition(source, 0, query)
    if (position === source.count) continue
    heap.push({
      source,
      position,
      event: source.events[(source.head + position) % source.events.length]!
    })
    siftTimelineUp(heap, heap.length - 1, compare)
  }
  while (heap.length > 0 && result.length < limit) {
    /** The smallest current event belongs to this target's single reusable query cursor. */
    const cursor = heap[0]!
    result.push(cursor.event)
    if (result.length === limit) break
    cursor.position = nextTimelinePosition(cursor.source, cursor.position + 1, query)
    if (cursor.position < cursor.source.count) {
      cursor.event =
        cursor.source.events[(cursor.source.head + cursor.position) % cursor.source.events.length]!
    } else {
      /** The last retained cursor replaces an exhausted root before its heap path is restored. */
      const replacement = heap.pop()!
      if (heap.length === 0) break
      heap[0] = replacement
    }
    siftTimelineDown(heap, compare)
  }
  return result
}
