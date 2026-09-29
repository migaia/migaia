import type { IRpcPortableValue } from './types.js'

/** The seven protocol 1.1 stream events; direction and sequence are checked by the stream owner. */
export const RpcStreamEvent = {
  open: 'open',
  pull: 'pull',
  item: 'item',
  end: 'end',
  fail: 'fail',
  cancel: 'cancel',
  cancelled: 'cancelled'
} as const
export type RpcStreamEvent = keyof typeof RpcStreamEvent

/** Stable first-failure categories shared by the contract and core state machine. */
export const RpcStreamViolation = {
  event: 'event',
  direction: 'direction',
  field: 'field',
  seq: 'seq',
  budget: 'budget'
} as const
export type RpcStreamViolation = keyof typeof RpcStreamViolation

/** Portable value budget and per-peer admission ceiling from streaming R6. */
export const RpcStreamLimit = {
  maxItemValueBytes: 16_384,
  maxOpenStreamsPerPeer: 256
} as const

/** Count JSON-compatible bytes without depending on a codec, route header or key order. */
export function measurePortableStreamValue(value: IRpcPortableValue): number {
  if (value === null) return 4
  if (typeof value === 'boolean') return value ? 4 : 5
  if (typeof value === 'number') return 24
  if (typeof value === 'string') return stringBytes(value)
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
