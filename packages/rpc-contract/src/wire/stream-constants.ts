/** Pure stream value budgets and event vocabulary; execution and held credit stay in Host. */
import type { IRpcPortableValue } from './types.js'
import { isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import { rpcPortableBackingLength, rpcPortableViewLength } from '../portable/normalize.js'

/** The seven shared stream events; direction and sequence are checked by the stream owner. */
export const RpcStreamEvent = {
  /** Producer announces a stream before any item is pulled. */
  open: 'open',
  /** Consumer grants the next unit of item demand. */
  pull: 'pull',
  /** Producer supplies the next sequenced business value. */
  item: 'item',
  /** Producer completes without another item. */
  end: 'end',
  /** Producer terminates with a serialized business error. */
  fail: 'fail',
  /** Consumer requests cancellation with an optional serialized reason. */
  cancel: 'cancel',
  /** Producer acknowledges cancellation as the terminal event. */
  cancelled: 'cancelled'
} as const
export type RpcStreamEvent = keyof typeof RpcStreamEvent

/** Stable first-failure categories shared by the contract and core state machine. */
export const RpcStreamViolation = {
  /** Stream event discriminator is unsupported. */
  event: 'event',
  /** The event came from the wrong stream participant. */
  direction: 'direction',
  /** A known stream field does not match the selected event. */
  field: 'field',
  /** The event sequence is outside its admitted domain or expected position. */
  seq: 'seq',
  /** The stream value or owner admission exceeds its allowed budget. */
  budget: 'budget'
} as const
export type RpcStreamViolation = keyof typeof RpcStreamViolation

/** Portable value budget and per-peer admission ceiling for streaming. */
export const RpcStreamLimit = {
  /** Maximum portable value accounting size for item or final business data. */
  maxItemValueBytes: 16_384,
  /** Per-peer open-stream admission ceiling enforced by the stream owner. */
  maxOpenStreamsPerPeer: 256
} as const

/** ASCII ranges exclude quote/backslash and JSON controls; DEL retains its original single byte. */
const stringNeedsByteWalk = /[^\x20-\x21\x23-\x5b\x5d-\x7f]/u

/**
 * Compute the stream owner's portable-value budget independently of a codec or route header. Finite
 * numbers charge a fixed conservative 24 bytes; native buffers/views charge their actual admitted
 * lengths. An unpaired surrogate returns Infinity. Use this on already admitted values; it does not
 * validate arbitrary inputs or enforce a stream limit itself.
 */
export function measurePortableStreamValue(value: IRpcPortableValue): number {
  if (value === null) return 4
  if (typeof value === 'boolean') return value ? 4 : 5
  if (typeof value === 'number') return 24
  if (typeof value === 'string') return stringBytes(value)
  if (isArrayBuffer(value)) return rpcPortableBackingLength(value)
  if (isUint8Array(value)) return rpcPortableViewLength(value)
  if (Array.isArray(value)) {
    let size = 2 + Math.max(0, value.length - 1)
    for (const item of value) size += measurePortableStreamValue(item)
    return size
  }
  const entries = Object.entries(value)
  let size = 2 + Math.max(0, entries.length - 1)
  for (const [key, item] of entries) size += stringBytes(key) + 1 + measurePortableStreamValue(item)
  return size
}

/** Count a quoted string, rejecting unpaired UTF-16 surrogates before transmission. */
function stringBytes(value: string): number {
  if (!stringNeedsByteWalk.test(value)) return value.length + 2
  let size = 2
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20) {
      size += 6
      continue
    }
    if (code === 0x22 || code === 0x5c) {
      size += 2
      continue
    }
    if (code < 0x80) {
      size += 1
      continue
    }
    if (code < 0x800) {
      size += 2
      continue
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return Infinity
      size += 4
      index += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) return Infinity
    size += 3
  }
  return size
}
