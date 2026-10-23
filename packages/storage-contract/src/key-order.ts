import { isUint8Array } from '@migaia/utils/bytes'
import { prefixStorageOrgKey } from './org.js'
import { snapshotStorageKey, assertStringStorageKey, KEY_DOMAIN_LIMITS } from './key.js'
import type { IBackendKind } from './capabilities.js'
import type { IStorageKey } from './context.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { StorageContractErrorText } from './error-text.js'

/** Tags preserve the canonical cross-type order; zero terminates a variable-length component. */
const OrderedKeyTag = { number: 1, date: 2, string: 3, bytes: 4, array: 5 } as const

/** Counts output once; child encodings are never repeatedly concatenated into parent arrays. */
function measureKey(key: IStorageKey): number {
  if (typeof key === 'number' || key instanceof Date) return 9
  if (typeof key === 'string') return 2 + key.length * 3
  if (Array.isArray(key)) {
    /** Array tag and terminator surround each complete child encoding. */
    let size = 2
    for (const child of key) size += measureKey(child)
    return size
  }
  return 2 + (key as ArrayBuffer).byteLength * 2
}

/** Writes an already admitted canonical snapshot; only the root variable terminator may be omitted. */
function encodeKeySnapshot(snapshot: IStorageKey, prefix: boolean): Uint8Array {
  /** Fixed-width numeric/date identities stay exact; variable roots can describe extensions. */
  const omitRootEnd = prefix && typeof snapshot !== 'number' && !(snapshot instanceof Date)
  /** One allocation holds the complete encoded tree. */
  const output = new Uint8Array(measureKey(snapshot) - (omitRootEnd ? 1 : 0))
  /** The numeric writer targets the same allocation and performs only constant-width writes. */
  const view = new DataView(output.buffer)
  /** One monotonic cursor is shared by every nested component. */
  let offset = 0
  /** Writes the sortable IEEE-754 transform without changing the source number. */
  const writeNumber = (value: number): void => {
    view.setFloat64(offset, value === 0 ? 0 : value, false)
    if (value < 0) {
      for (let index = 0; index < 8; index += 1) output[offset + index] ^= 255
    } else output[offset] ^= 128
    offset += 8
  }
  /** Appends a complete scalar or array in one depth-first traversal. */
  const write = (value: IStorageKey, omitEnd = false): void => {
    if (typeof value === 'number') {
      output[offset++] = OrderedKeyTag.number
      writeNumber(value)
      return
    }
    if (value instanceof Date) {
      output[offset++] = OrderedKeyTag.date
      writeNumber(value.getTime())
      return
    }
    if (typeof value === 'string') {
      output[offset++] = OrderedKeyTag.string
      for (let index = 0; index < value.length; index += 1) {
        /** UTF-16 ordering includes lone surrogate code units unchanged. */
        const unit = value.charCodeAt(index)
        output[offset++] = 1
        output[offset++] = unit >>> 8
        output[offset++] = unit & 255
      }
    } else if (Array.isArray(value)) {
      output[offset++] = OrderedKeyTag.array
      for (const child of value) write(child)
    } else {
      output[offset++] = OrderedKeyTag.bytes
      for (const byte of new Uint8Array(value as ArrayBuffer)) {
        output[offset++] = 1
        output[offset++] = byte
      }
    }
    if (!omitEnd) output[offset++] = 0
  }
  write(snapshot, omitRootEnd)
  return output
}

/**
 * Snapshots the existing key domain and writes its complete independent order-preserving bytes.
 * UTF-16, binary prefixes, nested keys and normalized signed zero retain canonical comparison.
 */
export function encodeOrderedStorageKey(
  key: unknown,
  backend: IBackendKind | undefined
): Uint8Array {
  return encodeKeySnapshot(snapshotStorageKey(key, backend), false)
}

/**
 * Read the exact existing ordered-key wire format for native backends that enumerate physical keys.
 * No alternate encoding is introduced. Bounds are checked before allocation and the original key
 * owner validates the resulting domain; malformed or noncanonical bytes throw INVALID_KEY.
 */
export function decodeOrderedStorageKey(
  encoded: Uint8Array,
  backend: IBackendKind | undefined
): IStorageKey {
  /** One reader cursor advances through the original self-delimiting scalar and tuple tags. */
  let offset = 0
  /** Original node and depth budgets bound hostile persisted wire input before recursion. */
  let nodes = 0
  /** Every malformed wire failure uses the existing key-domain family and original caller bytes. */
  const invalid = (): never => {
    throw new StorageContractError(
      StorageContractErrorCode.invalidKey,
      { backend },
      StorageContractErrorText.orderedKeyInvalid
    )
  }
  if (!isUint8Array(encoded)) invalid()
  /** Require remaining bytes before fixed-width reads or data-dependent allocations. */
  const requireBytes = (count: number): void => {
    if (offset + count > encoded.byteLength) invalid()
  }
  /** Parse one complete component using the same tag table as the canonical writer. */
  const read = (depth: number): IStorageKey => {
    if (++nodes > KEY_DOMAIN_LIMITS.maxNodes || depth > KEY_DOMAIN_LIMITS.maxDepth) invalid()
    requireBytes(1)
    const tag = encoded[offset++]
    if (tag === OrderedKeyTag.number || tag === OrderedKeyTag.date) {
      requireBytes(8)
      const bytes = encoded.slice(offset, offset + 8)
      offset += 8
      if (bytes[0]! & 128) bytes[0]! ^= 128
      else for (let index = 0; index < 8; index++) bytes[index]! ^= 255
      const value = new DataView(bytes.buffer).getFloat64(0, false)
      if (!Number.isFinite(value) || Object.is(value, -0)) invalid()
      if (tag === OrderedKeyTag.number) return value
      const date = new Date(value)
      if (date.getTime() !== value) invalid()
      return date
    }
    if (tag === OrderedKeyTag.string) {
      /** Bounded chunks avoid spread argument limits without normalizing UTF-16 surrogate units. */
      let result = ''
      const units: number[] = []
      for (;;) {
        requireBytes(1)
        const marker = encoded[offset++]
        if (marker === 0) break
        if (marker !== 1) invalid()
        requireBytes(2)
        units.push((encoded[offset++]! << 8) | encoded[offset++]!)
        if (units.length === 1024) {
          result += String.fromCharCode(...units)
          units.length = 0
        }
      }
      return result + String.fromCharCode(...units)
    }
    if (tag === OrderedKeyTag.bytes) {
      const bytes: number[] = []
      for (;;) {
        requireBytes(1)
        const marker = encoded[offset++]
        if (marker === 0) break
        if (marker !== 1 || bytes.length >= KEY_DOMAIN_LIMITS.maxBinaryBytes) invalid()
        requireBytes(1)
        bytes.push(encoded[offset++]!)
      }
      return new Uint8Array(bytes).buffer
    }
    if (tag === OrderedKeyTag.array) {
      const children: IStorageKey[] = []
      for (;;) {
        requireBytes(1)
        if (encoded[offset] === 0) {
          offset++
          break
        }
        children.push(read(depth + 1))
      }
      return children
    }
    return invalid()
  }
  const key = read(0)
  if (offset !== encoded.byteLength) invalid()
  return snapshotStorageKey(key, backend)
}
/** Converts already canonical bytes without another logical-key traversal or representation. */
export function storageKeyBytesIdentity(encoded: Uint8Array): string {
  return Array.from(encoded, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
/** One detached position retains the canonical identity and its first equivalent input position. */
export type IStorageBatchKey = {
  readonly key: IStorageKey
  readonly identity: string
  readonly firstIndex: number
}
/** One pure native-batch capture detaches keys in the caller's existing per-entry access order. */
export type IStorageBatchKeyCapture = (key: IStorageKey) => IStorageBatchKey
/**
 * Owns only this batch's temporary equality facts. Native authors choose when to reject a duplicate
 * from firstIndex, preserving their existing key/value/TTL getter order and original error owner.
 */
export function createStorageBatchKeyCapture(
  backend: IBackendKind | undefined
): IStorageBatchKeyCapture {
  /** Only this pure call owns the temporary equality index; no backend state is retained. */
  const firstPositions = new Map<string, number>()
  /** Successful captures retain caller order without reading any later input position. */
  let position = 0
  return (input) => {
    /** The original key owner validates and detaches this position exactly once. */
    const key = snapshotStorageKey(input, backend)
    /** The same private writer consumes only the detached snapshot. */
    const identity = storageKeyBytesIdentity(encodeKeySnapshot(key, false))
    /** Equal signed zero, dates, buffers and tuples share the original canonical identity. */
    const firstIndex = firstPositions.get(identity) ?? position
    if (firstIndex === position) firstPositions.set(identity, position)
    position++
    return Object.freeze({ key, identity, firstIndex })
  }
}
/**
 * Captures a native batch before I/O. Reads preserve duplicates; native removals use firstIndex,
 * while atomic writes reject equivalent keys when rejectDuplicates is requested.
 */
export function snapshotStorageBatchKeys(
  keys: readonly IStorageKey[],
  backend: IBackendKind | undefined,
  options?: { readonly rejectDuplicates?: boolean }
): readonly IStorageBatchKey[] {
  try {
    if (
      !Array.isArray(keys) ||
      (options !== undefined &&
        (typeof options !== 'object' || options === null || Array.isArray(options)))
    )
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend },
        StorageContractErrorText.batchKeys
      )
    /** Options and array length are captured once before any input key is traversed. */
    const rejectDuplicates = options?.rejectDuplicates
    if (rejectDuplicates !== undefined && typeof rejectDuplicates !== 'boolean')
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        { backend },
        StorageContractErrorText.batchKeys
      )
    /** Eager array capture and ordered native authors reuse the very same key/equality owner. */
    const capture = createStorageBatchKeyCapture(backend)
    /** Each returned position owns the detached snapshot used to derive its exact identity. */
    const result: IStorageBatchKey[] = []
    /** Caller mutation cannot extend the admitted operation while a key getter is evaluated. */
    const length = keys.length
    for (let index = 0; index < length; index++) {
      /** Only this position is read before its independent canonical capture. */
      const captured = capture(keys[index]!)
      if (captured.firstIndex !== index && rejectDuplicates)
        throw new StorageContractError(
          StorageContractErrorCode.invalidArgument,
          { backend },
          StorageContractErrorText.batchDuplicate
        )
      result.push(captured)
    }
    return Object.freeze(result)
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { backend, cause },
      StorageContractErrorText.batchKeys
    )
  }
}
/** Pure prefix projection supports native lower-bound cursors and canonical encoded range lookup. */
export type IStorageKeyPrefix = {
  readonly key: IStorageKey
  readonly lower: Uint8Array
  readonly upper: Uint8Array
  matches(key: IStorageKey): boolean
}
/**
 * Snapshots one typed prefix. Strings/buffers match content prefixes, arrays match complete leading
 * child keys, and numbers/Dates match exact normalized identities. The existing domain still
 * rejects empty arrays. Exposed bytes/key are independent of the private matcher; no index or store
 * permission is created, and only this input's bytes determine the exclusive upper bound.
 */
export function snapshotStorageKeyPrefix(
  prefix: unknown,
  backend: IBackendKind | undefined
): IStorageKeyPrefix {
  /** The original key owner admits and detaches all mutable logical segments exactly once. */
  const key = snapshotStorageKey(prefix, backend)
  /** The original writer deliberately omits only the root variable terminator, never a child end. */
  const encoded = encodeKeySnapshot(key, true)
  /** A shortest strict byte successor bounds every encoding that begins with this typed prefix. */
  let end = encoded.length
  while (end > 0 && encoded[end - 1] === 255) end--
  /** The canonical non-255 type tag guarantees a finite strict successor for every valid key. */
  const upper = encoded.slice(0, end)
  upper[end - 1]++
  return Object.freeze({
    key,
    lower: encoded.slice(),
    upper,
    /** Candidate validation/encoding stays with the same owner and never rereads the caller prefix. */
    matches(candidate: IStorageKey): boolean {
      /** Complete candidate bytes retain type identity and cannot cross prefix channels. */
      const bytes = encodeOrderedStorageKey(candidate, backend)
      if (bytes.length < encoded.length) return false
      for (let index = 0; index < encoded.length; index++)
        if (bytes[index] !== encoded[index]) return false
      return true
    }
  })
}

/** Explicit stack frames visit only still-shared suffixes rather than maximum-length padding. */
type IStorageByteRadixFrame = {
  readonly start: number
  readonly end: number
  readonly depth: number
}
/** Byte values occupy 1..256; bucket zero is reserved for a genuinely ended encoding. */
const STORAGE_BYTE_RADIX_BUCKETS = 257

/** Stable MSD buckets process each present suffix byte a constant number of times. */
export function sortStorageByteIdentities<T extends { readonly encoded: Uint8Array }>(
  entries: T[]
): void {
  if (entries.length < 2) return
  /** One shared scratch array serves every disjoint frame, without copying prefixes. */
  const scratch: T[] = []
  scratch.length = entries.length
  /** Fixed alphabet state is reused for every frame instead of retained per depth. */
  const counts = new Uint32Array(STORAGE_BYTE_RADIX_BUCKETS)
  /** Write positions are independently advanced while stable scattering fills the scratch region. */
  const positions = new Uint32Array(STORAGE_BYTE_RADIX_BUCKETS)
  /** LIFO suffix work avoids call-stack growth for long equal prefixes. */
  const frames: IStorageByteRadixFrame[] = [{ start: 0, end: entries.length, depth: 0 }]
  while (frames.length > 0) {
    /** Frames are disjoint at this depth and never include an already ended key. */
    const { start, end, depth } = frames.pop()!
    counts.fill(0)
    for (let index = start; index < end; index += 1) {
      /** Actual zero bytes stay ordinary content; only absence enters the terminator bucket. */
      const encoded = entries[index]!.encoded
      counts[depth < encoded.length ? encoded[depth]! + 1 : 0] += 1
    }
    /** Bucket boundaries use absolute array positions, independent of key length. */
    let boundary = start
    for (let bucket = 0; bucket < STORAGE_BYTE_RADIX_BUCKETS; bucket += 1) {
      positions[bucket] = boundary
      boundary += counts[bucket]!
    }
    for (let index = start; index < end; index += 1) {
      /** Stable movement retains the first snapshot when duplicate identities later collapse. */
      const entry = entries[index]!
      /** End-of-key has its own bucket and cannot be confused with embedded binary zero. */
      const bucket = depth < entry.encoded.length ? entry.encoded[depth]! + 1 : 0
      scratch[positions[bucket]!] = entry
      positions[bucket] += 1
    }
    for (let index = start; index < end; index += 1) entries[index] = scratch[index]!
    boundary = start + counts[0]!
    for (let bucket = 1; bucket < STORAGE_BYTE_RADIX_BUCKETS; bucket += 1) {
      /** Singleton and terminated ranges need no further byte inspection. */
      const size = counts[bucket]!
      if (size > 1) frames.push({ start: boundary, end: boundary + size, depth: depth + 1 })
      boundary += size
    }
  }
}

/**
 * Stable byte order shares the original lock radix. Each selector is invoked once and its bytes are
 * detached immediately, so later callback mutation cannot alter an earlier row's identity.
 */
export function orderStorageKeysByBytes<T>(
  entries: readonly T[],
  key: (entry: T) => Uint8Array
): readonly T[] {
  try {
    if (!Array.isArray(entries) || typeof key !== 'function')
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        {},
        StorageContractErrorText.keyByteOrder
      )
    /** Only this operation's detached ordering facts exist; no persistent index is created. */
    const captured: { readonly encoded: Uint8Array; readonly entry: T }[] = []
    /** Input length cannot grow while a borrowed selector executes. */
    const length = entries.length
    if (!Number.isSafeInteger(length) || length < 0)
      throw new StorageContractError(
        StorageContractErrorCode.invalidArgument,
        {},
        StorageContractErrorText.keyByteOrder
      )
    for (let index = 0; index < length; index++) {
      /** Each original row and selector result is captured once in input order. */
      const entry = entries[index]!
      /** The existing byte-domain guard admits actual cross-realm Uint8Array values. */
      const bytes = key(entry)
      if (!isUint8Array(bytes))
        throw new StorageContractError(
          StorageContractErrorCode.invalidArgument,
          {},
          StorageContractErrorText.keyByteOrder
        )
      captured.push({ encoded: new Uint8Array(bytes), entry })
    }
    sortStorageByteIdentities(captured)
    return Object.freeze(captured.map((row) => row.entry))
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw new StorageContractError(
      StorageContractErrorCode.invalidArgument,
      { cause },
      StorageContractErrorText.keyByteOrder
    )
  }
}
/**
 * Encodes one logical string prefix inside the original three-part organization envelope. Only the
 * final string and enclosing tuple terminators are omitted; all tags and preceding components come
 * from the original writer, including UTF-16 and empty-string semantics.
 */
export function encodeStorageOrgStringPrefix(
  orgId: string,
  prefix: string,
  backend: IBackendKind
): Uint8Array {
  assertStringStorageKey(prefix, backend)
  /** This exact envelope is shared with Redis/blob physical key composition. */
  const key = prefixStorageOrgKey(orgId, prefix)
  return encodeKeySnapshot(key, false).slice(0, -2)
}
