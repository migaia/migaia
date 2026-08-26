import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { encodeSerializeTextChunk, validateSerializeChunk } from '../src/types.js'
import { SerializePhase } from '../src/format-constants.js'

/** Stable diagnostics used by both boundary probes. */
const details = {
  type: 't58',
  phase: SerializePhase.encode,
  context: 'cross-realm',
  chunkIndex: 0,
  bytesConsumed: 0
} as const

describe('SWV2-T58 serialize byte boundaries', () => {
  it('accepts foreign intrinsic bytes without changing payload identity', () => {
    const foreignBytes = runInNewContext('new Uint8Array([1, 2, 3])') as Uint8Array
    const foreignSubclass = runInNewContext(
      'class ByteSubclass extends Uint8Array {}; new ByteSubclass([4, 5])'
    ) as Uint8Array
    const chunk = validateSerializeChunk(['bytes', foreignBytes], details)
    expect(chunk[1]).toBe(foreignBytes)
    expect(validateSerializeChunk(['bytes', foreignSubclass], details)[1]).toBe(foreignSubclass)
    expect(encodeSerializeTextChunk({ encode: () => foreignBytes }, 'ignored', details)).toBe(
      foreignBytes
    )
  })

  it('keeps forged and wrong-view values on the existing invalid-chunk path', () => {
    for (const value of [
      new Int8Array(1),
      new Uint8ClampedArray(1),
      new DataView(new ArrayBuffer(1)),
      new Proxy(new Uint8Array(1), {})
    ]) {
      try {
        validateSerializeChunk(['bytes', value], details)
        throw new Error('expected invalid byte chunk')
      } catch (error) {
        expect(error).toMatchObject({ source: '@migaia/serialize', code: 'INVALID_CHUNK' })
        expect(error).toHaveProperty('message', 'bytes chunk data must be a Uint8Array')
        expect(error).toHaveProperty('stack')
      }
    }
  })
})
