import {
  StorageContractError,
  StorageContractErrorCode,
  type ILockKey,
  type IStorageKey
} from '@migaia/storage-contract'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import type { ICollectionsCodecValue } from '@migaia/serialize/codecs/collections-json'
import { utf8ByteLength } from '@migaia/utils/bytes'
import { StorageErrorText } from '../error-text.ts'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.ts'

/** Optional namespace-local limits preserve the existing unbounded default. */
export type IMemoryCapacityOptions = {
  readonly maxEntries?: number
  readonly maxBytes?: number
  readonly eviction?: 'lru' | 'lfu'
}
/** Canonical policy names belong to the native capacity index and its option admission. */
const MemoryEviction = { lru: 'lru', lfu: 'lfu' } as const
/** Captured capacity descriptors never retain caller getters. */
export type IMemoryCapacity = Readonly<{
  maxEntries?: number
  maxBytes?: number
  eviction: 'lru' | 'lfu'
}>
/** Index rows borrow the native entry's already owned key without duplicating its encoded bytes. */
export type IMemoryCapacityEntry = {
  readonly id: string
  readonly channel: string
  readonly encoded: string
  readonly key: IStorageKey
  readonly bytes: number
  readonly lock?: ILockKey
}
/** A native deletion has no byte count; all other fields remain exact physical identity facts. */
export type IMemoryCapacityChange = Omit<IMemoryCapacityEntry, 'bytes'> & {
  readonly bytes?: number
}
/** The same linked policy structure supports LRU and LFU without sorted history or table scans. */
type ICapacityBucket = {
  readonly frequency: number
  previous?: ICapacityBucket
  next?: ICapacityBucket
  first?: ICapacityNode
  last?: ICapacityNode
}
/** One physical entry owns one node; bucket links also encode deterministic least-recent ties. */
type ICapacityNode = IMemoryCapacityEntry & {
  bytes: number
  bucket: ICapacityBucket
  previous?: ICapacityNode
  next?: ICapacityNode
}

/** Captures every supported option once, before the native controller or namespace exists. */
export function snapshotMemoryCapacity(options: {
  readonly capacity?: IMemoryCapacityOptions
}): IMemoryCapacity | undefined {
  try {
    /** Explicit omission keeps the original no-index and no-accounting path. */
    const input = options.capacity
    if (input === undefined) return undefined
    if (typeof input !== 'object' || input === null || Array.isArray(input))
      throw new TypeError(StorageErrorText.memoryCapacityArgument)
    /** All three fields detach before validation so caller mutations cannot alter later namespaces. */
    const maxEntries = input.maxEntries
    /** Bytes are encoded only when this limit is present. */
    const maxBytes = input.maxBytes
    /** LRU is the sole default; no policy name is inferred from other options. */
    const eviction = input.eviction ?? MemoryEviction.lru
    for (const limit of [maxEntries, maxBytes])
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit <= 0))
        throw new TypeError(StorageErrorText.memoryCapacityArgument)
    if (eviction !== MemoryEviction.lru && eviction !== MemoryEviction.lfu)
      throw new TypeError(StorageErrorText.memoryCapacityArgument)
    return { maxEntries, maxBytes, eviction }
  } catch (cause) {
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend: STORAGE_MEMORY_BACKEND, cause },
      StorageErrorText.memoryCapacityArgument
    )
  }
}

/** The existing serialize owner supplies actual canonical bytes, without a memory-specific codec. */
const capacityCodec = /* @__PURE__ */ defineCollectionsJsonCodec({ version: 1 })

/** Only explicit maxBytes asks an already detached record or payload to enter the codec domain. */
export function memoryCapacityValueBytes(value: unknown): number {
  try {
    return utf8ByteLength(capacityCodec.encode(value as ICollectionsCodecValue))
  } catch (cause) {
    throw new StorageContractError(
      StorageContractErrorCode.unsupported,
      { backend: STORAGE_MEMORY_BACKEND, cause },
      StorageErrorText.memoryCapacityEncoding
    )
  }
}

/** One native policy owner exposes mutation accounting and bounded reversible planning. */
type IMemoryCapacityIndex = {
  touch(id: string): void
  put(entry: IMemoryCapacityEntry): void
  remove(id: string): void
  clear(): void
  preview(changes: readonly IMemoryCapacityChange[]): readonly IMemoryCapacityEntry[]
}

/**
 * Creates only native policy metadata. Temporary planning uses a bounded inverse log over touched
 * linked nodes; it never clones all entries, changes data, waits or owns a resource lifetime.
 */

/** One physical capacity index owns its linked policy rows and bounded preview inverse log. */
type IMemoryCapacityContext = {
  /** Original options is captured before native construction begins. */
  readonly options: IMemoryCapacity

  /** Hash membership is the sole physical-entry count and direct policy lookup. */
  nodes: Map<string, ICapacityNode>

  /** The first nonempty bucket is minFreq; each bucket retains least-recent order internally. */
  first: ICapacityBucket | undefined

  /** Byte count advances only alongside native physical puts and removals. */
  bytes: number

  /** Planning remembers only actually changed node/bucket links, then restores those exact facts. */
  inverse: Map<ICapacityBucket | ICapacityNode, object> | undefined

  /** Hash changes have the same bounded inverse ownership as their linked nodes. */
  previousNodes: Map<string, ICapacityNode | undefined> | undefined
}
/** Create the original linked capacity owner with bounded reversible preview state. */
export function createMemoryCapacityIndex(options: IMemoryCapacity): IMemoryCapacityIndex {
  /** Initialize native facts in original construction order before publishing any port. */
  const capacityState = { options } as IMemoryCapacityContext

  /** Hash membership is the sole physical-entry count and direct policy lookup. */
  capacityState.nodes = new Map<string, ICapacityNode>()

  /** Byte count advances only alongside native physical puts and removals. */
  capacityState.bytes = 0
  return createCapacityMethods(capacityState)
}

/** Capture each object before its first mutation in one synchronous preview. */
function remember(
  capacityState: IMemoryCapacityContext,
  value: ICapacityBucket | ICapacityNode
): void {
  if (capacityState.inverse !== undefined && !capacityState.inverse.has(value))
    capacityState.inverse.set(value, { ...value })
}

/** Capture original hash membership once, including rows newly introduced by a preview. */
function rememberId(capacityState: IMemoryCapacityContext, id: string): void {
  if (capacityState.previousNodes !== undefined && !capacityState.previousNodes.has(id))
    capacityState.previousNodes.set(id, capacityState.nodes.get(id))
}

/** Remove a policy bucket only when its final member has left. */
function unlinkBucket(capacityState: IMemoryCapacityContext, bucket: ICapacityBucket): void {
  if (bucket.first !== undefined) return
  if (bucket.previous !== undefined) {
    remember(capacityState, bucket.previous)
    bucket.previous.next = bucket.next
  } else capacityState.first = bucket.next
  if (bucket.next !== undefined) {
    remember(capacityState, bucket.next)
    bucket.next.previous = bucket.previous
  }
}

/** Detach one node while retaining the exact bucket until its replacement is known. */
function unlink(capacityState: IMemoryCapacityContext, node: ICapacityNode): void {
  remember(capacityState, node)
  remember(capacityState, node.bucket)
  if (node.previous !== undefined) {
    remember(capacityState, node.previous)
    node.previous.next = node.next
  } else node.bucket.first = node.next
  if (node.next !== undefined) {
    remember(capacityState, node.next)
    node.next.previous = node.previous
  } else node.bucket.last = node.previous
  node.previous = undefined
  node.next = undefined
}

/** Append one hit or write as the most recent member of its chosen frequency. */
function append(
  capacityState: IMemoryCapacityContext,
  bucket: ICapacityBucket,
  node: ICapacityNode
): void {
  remember(capacityState, bucket)
  remember(capacityState, node)
  node.bucket = bucket
  node.previous = bucket.last
  node.next = undefined
  if (bucket.last !== undefined) {
    remember(capacityState, bucket.last)
    bucket.last.next = node
  } else bucket.first = node
  bucket.last = node
}

/** A new physical entry joins minFreq one, without scanning frequency gaps. */
function initialBucket(capacityState: IMemoryCapacityContext): ICapacityBucket {
  if (capacityState.first?.frequency === 1) return capacityState.first
  /** At most one initial bucket is allocated per insertion before an empty one is unlinked. */
  const bucket: ICapacityBucket = { frequency: 1, next: capacityState.first }
  if (capacityState.first !== undefined) {
    remember(capacityState, capacityState.first)
    capacityState.first.previous = bucket
  }
  capacityState.first = bucket
  return bucket
}

/** Point hits update LRU or promote exactly one LFU bucket with constant link work. */
function touch(capacityState: IMemoryCapacityContext, id: string): void {
  /** Misses never manufacture policy history. */
  const node = capacityState.nodes.get(id)
  if (node === undefined) return
  /** An LRU hit stays in its one bucket; an LFU hit moves only to frequency plus one. */
  const previous = node.bucket
  if (capacityState.options.eviction === MemoryEviction.lru) {
    unlink(capacityState, node)
    append(capacityState, previous, node)
    return
  }
  /** Adjacent frequency is located directly even if the current bucket becomes empty. */
  let next = previous.next
  if (next?.frequency !== previous.frequency + 1) {
    next = { frequency: previous.frequency + 1, previous, next: previous.next }
    remember(capacityState, previous)
    if (previous.next !== undefined) {
      remember(capacityState, previous.next)
      previous.next.previous = next
    }
    previous.next = next
  }
  unlink(capacityState, node)
  append(capacityState, next, node)
  unlinkBucket(capacityState, previous)
}

/** Explicit removal and eviction maintain the same membership and byte owner. */
function remove(capacityState: IMemoryCapacityContext, id: string): void {
  /** An absent native identity has no policy side effect. */
  const node = capacityState.nodes.get(id)
  if (node === undefined) return
  rememberId(capacityState, id)
  unlink(capacityState, node)
  unlinkBucket(capacityState, node.bucket)
  capacityState.nodes.delete(id)
  capacityState.bytes -= node.bytes
}

/** A put counts one physical entry and treats overwrite as a policy hit. */
function put(capacityState: IMemoryCapacityContext, entry: IMemoryCapacityEntry): void {
  /** Existing native identity retains its key and bucket node. */
  const existing = capacityState.nodes.get(entry.id)
  if (existing !== undefined) {
    remember(capacityState, existing)
    capacityState.bytes += entry.bytes - existing.bytes
    existing.bytes = entry.bytes
    touch(capacityState, entry.id)
    return
  }
  rememberId(capacityState, entry.id)
  /** Initial links contain no borrowed values or native handles. */
  const node: ICapacityNode = { ...entry, bucket: initialBucket(capacityState) }
  capacityState.nodes.set(entry.id, node)
  append(capacityState, node.bucket, node)
  capacityState.bytes += entry.bytes
}

/** Native final turns and previews share one exact predicate, including oversized entries. */
function overLimit(capacityState: IMemoryCapacityContext): boolean {
  return (
    (capacityState.options.maxEntries !== undefined &&
      capacityState.nodes.size > capacityState.options.maxEntries) ||
    (capacityState.options.maxBytes !== undefined &&
      capacityState.bytes > capacityState.options.maxBytes)
  )
}
/** Publish native capacity methods over their original policy state. */
function createCapacityMethods(capacityState: IMemoryCapacityContext): IMemoryCapacityIndex {
  return {
    touch: (id: string) => touch(capacityState, id),
    put: (entry: IMemoryCapacityEntry) => put(capacityState, entry),
    remove: (id: string) => remove(capacityState, id),
    /** Metadata clearing is proportional only to the channel entries actually removed by its owner. */
    clear: () => memoryCapacityClear(capacityState),
    /**
     * Derive only actual victims from proposed native changes. Restore existing links before
     * returning so waiting, rejected writes and rolled-back transactions cannot leak eviction.
     */
    preview: (changes: readonly IMemoryCapacityChange[]) =>
      memoryCapacityPreview(capacityState, changes)
  }
}

/** Perform clear on this owner's original linked capacity state. */
function memoryCapacityClear(capacityState: IMemoryCapacityContext) {
  capacityState.nodes.clear()
  capacityState.first = undefined
  capacityState.bytes = 0
}
/** Perform preview on this owner's original linked capacity state. */
function memoryCapacityPreview(
  capacityState: IMemoryCapacityContext,
  changes: readonly IMemoryCapacityChange[]
): readonly IMemoryCapacityEntry[] {
  /** The index has no callback or await while this bounded inverse log is active. */
  const originalFirst = capacityState.first
  /** Scalar accounting restores alongside the exact old node objects. */
  const originalBytes = capacityState.bytes
  capacityState.inverse = new Map()
  capacityState.previousNodes = new Map()
  try {
    for (const change of changes)
      if (change.bytes === undefined) remove(capacityState, change.id)
      else put(capacityState, { ...change, bytes: change.bytes })
    /** Only removed victims are retained; no candidate array is materialized. */
    const victims: IMemoryCapacityEntry[] = []
    while (overLimit(capacityState)) {
      /** A nonempty over-budget index always has exactly one first linked candidate. */
      const victim = capacityState.first!.first!
      victims.push({
        id: victim.id,
        channel: victim.channel,
        encoded: victim.encoded,
        key: victim.key,
        bytes: victim.bytes,
        lock: victim.lock
      })
      remove(capacityState, victim.id)
    }
    return victims
  } finally {
    for (const [target, original] of capacityState.inverse) {
      /** Undefined links must be restored too, including properties absent from the old node. */
      Object.assign(target, { previous: undefined, next: undefined }, original)
    }
    for (const [id, original] of capacityState.previousNodes)
      if (original === undefined) capacityState.nodes.delete(id)
      else capacityState.nodes.set(id, original)
    capacityState.first = originalFirst
    capacityState.bytes = originalBytes
    capacityState.inverse = undefined
    capacityState.previousNodes = undefined
  }
}
