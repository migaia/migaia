import { snapshotStorageKey } from './key.js'
import type { IBackendKind } from './capabilities.js'
import type { IStorageKey } from './context.js'

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
