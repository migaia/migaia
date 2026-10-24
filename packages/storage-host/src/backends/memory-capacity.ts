import {
  StorageContractError,
  StorageContractErrorCode,
  type ILockKey,
  type IStorageKey
} from '@migaia/storage-contract'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import type { ICollectionsCodecValue } from '@migaia/serialize/codecs/collections-json'
import { utf8ByteLength } from '@migaia/utils/bytes'
import { StorageErrorText } from '../error-text.js'
import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'

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

/**
 * Creates only native policy metadata. Temporary planning uses a bounded inverse log over touched
 * linked nodes; it never clones all entries, changes data, waits or owns a resource lifetime.
 */
export function createMemoryCapacityIndex(options: IMemoryCapacity) {
  /** Hash membership is the sole physical-entry count and direct policy lookup. */
  const nodes = new Map<string, ICapacityNode>()
  /** The first nonempty bucket is minFreq; each bucket retains least-recent order internally. */
  let first: ICapacityBucket | undefined
  /** Byte count advances only alongside native physical puts and removals. */
  let bytes = 0
  /** Planning remembers only actually changed node/bucket links, then restores those exact facts. */
  let inverse: Map<ICapacityBucket | ICapacityNode, object> | undefined
  /** Hash changes have the same bounded inverse ownership as their linked nodes. */
  let previousNodes: Map<string, ICapacityNode | undefined> | undefined

  /** Capture each object before its first mutation in one synchronous preview. */
  const remember = (value: ICapacityBucket | ICapacityNode): void => {
    if (inverse !== undefined && !inverse.has(value)) inverse.set(value, { ...value })
  }
  /** Capture original hash membership once, including rows newly introduced by a preview. */
  const rememberId = (id: string): void => {
    if (previousNodes !== undefined && !previousNodes.has(id)) previousNodes.set(id, nodes.get(id))
  }
  /** Remove a policy bucket only when its final member has left. */
  const unlinkBucket = (bucket: ICapacityBucket): void => {
    if (bucket.first !== undefined) return
    if (bucket.previous !== undefined) {
      remember(bucket.previous)
      bucket.previous.next = bucket.next
    } else first = bucket.next
    if (bucket.next !== undefined) {
      remember(bucket.next)
      bucket.next.previous = bucket.previous
    }
  }
  /** Detach one node while retaining the exact bucket until its replacement is known. */
  const unlink = (node: ICapacityNode): void => {
    remember(node)
    remember(node.bucket)
    if (node.previous !== undefined) {
      remember(node.previous)
      node.previous.next = node.next
    } else node.bucket.first = node.next
    if (node.next !== undefined) {
      remember(node.next)
      node.next.previous = node.previous
    } else node.bucket.last = node.previous
    node.previous = undefined
    node.next = undefined
  }
  /** Append one hit or write as the most recent member of its chosen frequency. */
  const append = (bucket: ICapacityBucket, node: ICapacityNode): void => {
    remember(bucket)
    remember(node)
    node.bucket = bucket
    node.previous = bucket.last
    node.next = undefined
    if (bucket.last !== undefined) {
      remember(bucket.last)
      bucket.last.next = node
    } else bucket.first = node
    bucket.last = node
  }
  /** A new physical entry joins minFreq one, without scanning frequency gaps. */
  const initialBucket = (): ICapacityBucket => {
    if (first?.frequency === 1) return first
    /** At most one initial bucket is allocated per insertion before an empty one is unlinked. */
    const bucket: ICapacityBucket = { frequency: 1, next: first }
    if (first !== undefined) {
      remember(first)
      first.previous = bucket
    }
    first = bucket
    return bucket
  }
  /** Point hits update LRU or promote exactly one LFU bucket with constant link work. */
  const touch = (id: string): void => {
    /** Misses never manufacture policy history. */
    const node = nodes.get(id)
    if (node === undefined) return
    /** An LRU hit stays in its one bucket; an LFU hit moves only to frequency plus one. */
    const previous = node.bucket
    if (options.eviction === MemoryEviction.lru) {
      unlink(node)
      append(previous, node)
      return
    }
    /** Adjacent frequency is located directly even if the current bucket becomes empty. */
    let next = previous.next
    if (next?.frequency !== previous.frequency + 1) {
      next = { frequency: previous.frequency + 1, previous, next: previous.next }
      remember(previous)
      if (previous.next !== undefined) {
        remember(previous.next)
        previous.next.previous = next
      }
      previous.next = next
    }
    unlink(node)
    append(next, node)
    unlinkBucket(previous)
  }
  /** Explicit removal and eviction maintain the same membership and byte owner. */
  const remove = (id: string): void => {
    /** An absent native identity has no policy side effect. */
    const node = nodes.get(id)
    if (node === undefined) return
    rememberId(id)
    unlink(node)
    unlinkBucket(node.bucket)
    nodes.delete(id)
    bytes -= node.bytes
  }
  /** A put counts one physical entry and treats overwrite as a policy hit. */
  const put = (entry: IMemoryCapacityEntry): void => {
    /** Existing native identity retains its key and bucket node. */
    const existing = nodes.get(entry.id)
    if (existing !== undefined) {
      remember(existing)
      bytes += entry.bytes - existing.bytes
      existing.bytes = entry.bytes
      touch(entry.id)
      return
    }
    rememberId(entry.id)
    /** Initial links contain no borrowed values or native handles. */
    const node: ICapacityNode = { ...entry, bucket: initialBucket() }
    nodes.set(entry.id, node)
    append(node.bucket, node)
    bytes += entry.bytes
  }
  /** Native final turns and previews share one exact predicate, including oversized entries. */
  const overLimit = (): boolean =>
    (options.maxEntries !== undefined && nodes.size > options.maxEntries) ||
    (options.maxBytes !== undefined && bytes > options.maxBytes)

  return {
    touch,
    put,
    remove,
    /** Metadata clearing is proportional only to the channel entries actually removed by its owner. */
    clear: () => {
      nodes.clear()
      first = undefined
      bytes = 0
    },
    /**
     * Derive only actual victims from proposed native changes. Restore existing links before
     * returning so waiting, rejected writes and rolled-back transactions cannot leak eviction.
     */
    preview: (changes: readonly IMemoryCapacityChange[]): readonly IMemoryCapacityEntry[] => {
      /** The index has no callback or await while this bounded inverse log is active. */
      const originalFirst = first
      /** Scalar accounting restores alongside the exact old node objects. */
      const originalBytes = bytes
      inverse = new Map()
      previousNodes = new Map()
      try {
        for (const change of changes)
          if (change.bytes === undefined) remove(change.id)
          else put({ ...change, bytes: change.bytes })
        /** Only removed victims are retained; no candidate array is materialized. */
        const victims: IMemoryCapacityEntry[] = []
        while (overLimit()) {
          /** A nonempty over-budget index always has exactly one first linked candidate. */
          const victim = first!.first!
          victims.push({
            id: victim.id,
            channel: victim.channel,
            encoded: victim.encoded,
            key: victim.key,
            bytes: victim.bytes,
            lock: victim.lock
          })
          remove(victim.id)
        }
        return victims
      } finally {
        for (const [target, original] of inverse) {
          /** Undefined links must be restored too, including properties absent from the old node. */
          Object.assign(target, { previous: undefined, next: undefined }, original)
        }
        for (const [id, original] of previousNodes)
          if (original === undefined) nodes.delete(id)
          else nodes.set(id, original)
        first = originalFirst
        bytes = originalBytes
        inverse = undefined
        previousNodes = undefined
      }
    }
  }
}
