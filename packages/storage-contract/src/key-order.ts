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

/**
 * Snapshots the existing key domain and writes an independent order-preserving byte sequence.
 * UTF-16 code units, byte prefixes, nested keys and normalized signed zero retain comparator
 * order.
 */
export function encodeOrderedStorageKey(
  key: unknown,
  backend: IBackendKind | undefined
): Uint8Array {
  /** Existing key ownership handles validation, domain limits and mutable components. */
  const snapshot = snapshotStorageKey(key, backend)
  /** One allocation holds the complete encoded tree. */
  const output = new Uint8Array(measureKey(snapshot))
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
  const write = (value: IStorageKey): void => {
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
    output[offset++] = 0
  }
  write(snapshot)
  return output
}
