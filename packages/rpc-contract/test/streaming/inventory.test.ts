import { expect, it, vi } from 'vitest'
import {
  normalizeRpcFrame,
  normalizeRpcStream,
  RpcWireProfile,
  measurePortableStreamValue
} from '@migaia/rpc-contract/protocol'

/** Unknown semantic kinds still fail at their canonical grammar pointer under the sole profile. */
it('retains the unknown-kind rejection for unregistered future kinds', () => {
  expect(() => normalizeRpcFrame({ profile: RpcWireProfile, kind: 'future-kind' })).toThrow(
    expect.objectContaining({ code: 'INVALID_ENVELOPE', pointer: '/kind' })
  )
})

/** The prior string loop is the value-parity oracle, not another production measuring path. */
function legacyStringBytes(value: string): number {
  /** The old budget includes the two surrounding JSON quotation marks. */
  let size = 2
  for (let index = 0; index < value.length; index += 1) {
    /** Preserve the old UTF-16 branch order exactly for the comparison baseline. */
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
      /** A high surrogate only accepts its original adjacent low-surrogate partner. */
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

it.each([
  ['ASCII', 'plain ASCII 09\u007f'],
  ['escaped', '\u0000\t\n"\\'],
  ['non-ASCII', 'é߿ࠀ漢'],
  ['paired-surrogate', 'a😀z'],
  ['unpaired-high-surrogate', '\ud800x'],
  ['unpaired-low-surrogate', '\udfff']
] as const)('preserves the original %s string budget', (_kind, value) => {
  expect(measurePortableStreamValue(value)).toBe(legacyStringBytes(value))
  if (!Number.isFinite(legacyStringBytes(value)))
    expect(() => normalizeRpcStream({ event: 'item', seq: 0, value })).toThrow(
      expect.objectContaining({ code: 'INVALID_ENVELOPE', pointer: '/stream' })
    )
})

it('ordinary ASCII bypasses the character loop', () => {
  /** Passthrough observes the actual intrinsic without substituting a counting implementation. */
  const character = vi.spyOn(String.prototype, 'charCodeAt')
  try {
    expect(measurePortableStreamValue('plain ASCII')).toBe(13)
    expect(character).not.toHaveBeenCalled()
  } finally {
    character.mockRestore()
  }
})
