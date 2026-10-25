import { runInNewContext } from 'node:vm'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { defineCollectionsJsonCodec } from '../src/codecs/collections-json.js'
import { defineJsonCodec } from '../src/codecs/json.js'
import { defineCBORCodec } from '../src/codecs/cbor.js'
import { defineMessagePackCodec } from '../src/codecs/message-pack.js'
import { toPortableValue } from '../src/codec.js'

describe('collection-preserving JSON codec', () => {
  it('restores nested collections in insertion order and leaves byte tags as records', () => {
    const codec = defineCollectionsJsonCodec({ version: 2 })
    const value = new Map([[new Set(['b', 'a']), new Map([[1, new Uint8Array([0, 1])]])]])
    expect(codec.encode(value)).toBe(
      '{"$rpc":"map","entries":[[{"$rpc":"set","values":["b","a"]},{"$rpc":"map","entries":[[1,{"$rpc":"bytes","base64url":"AAE"}]]}]]}'
    )
    expect(codec.decode(codec.encode(value))).toEqual(
      new Map([[new Set(['b', 'a']), new Map([[1, { $rpc: 'bytes', base64url: 'AAE' }]])]])
    )
    expect(Object.isFrozen(codec)).toBe(true)
    expectTypeOf(codec.id).toEqualTypeOf<'collections-json'>()
    expectTypeOf(codec.version).toEqualTypeOf<2>()
    expectTypeOf(codec.encodedType).toEqualTypeOf<'string'>()
  })

  it('uses intrinsic collection slots and iterators across realms and changed prototypes', () => {
    const codec = defineCollectionsJsonCodec({ version: 1 })
    const foreign = runInNewContext('new Map([["foreign", new Set([1, 2])]])')
    expect(codec.decode(codec.encode(foreign))).toEqual(new Map([['foreign', new Set([1, 2])]]))
    const map = new Map([['own', 3]])
    Object.setPrototypeOf(map, null)
    Object.defineProperty(map, Symbol.iterator, {
      value: () => {
        throw new Error('untrusted iterator')
      }
    })
    expect(codec.decode(codec.encode(map))).toEqual(new Map([['own', 3]]))
  })

  it('rejects unsupported values and cycles with the portable error directly on cause', () => {
    const codec = defineCollectionsJsonCodec({ version: 1 })
    const cycle = new Map<unknown, unknown>()
    cycle.set('cycle', cycle)
    /** Length growth intentionally creates a sparse fixture for portable admission. */
    const sparse: unknown[] = []
    sparse.length = 2
    for (const input of [
      NaN,
      Infinity,
      undefined,
      new Date(),
      1n,
      sparse,
      new Map([[NaN, 1]]),
      new Set([undefined]),
      cycle
    ]) {
      expect(() => codec.encode(input as never)).toThrowError(
        expect.objectContaining({
          source: '@migaia/serialize',
          code: 'ENCODE_FAILED',
          cause: expect.objectContaining({ code: 'INVALID_OPTION' })
        })
      )
    }
    expect(() => codec.decode('1e400')).toThrowError(
      expect.objectContaining({
        code: 'DECODE_FAILED',
        cause: expect.objectContaining({ code: 'INVALID_OPTION' })
      })
    )
    expect(() => codec.decode('{bad')).toThrowError(
      expect.objectContaining({ code: 'DECODE_FAILED', cause: expect.any(SyntaxError) })
    )
  })

  it('validates reserved records on both paths and treats old tuple formats as data', () => {
    const codec = defineCollectionsJsonCodec({ version: 1 })
    for (const value of [
      { $rpc: 'map', entries: [[1]] },
      { $rpc: 'map', entries: [1] },
      { $rpc: 'set', values: {}, extra: 1 },
      { $rpc: 'other' },
      { $rpc: 'bytes', base64url: 1 },
      { $rpc: 'set', values: [NaN] }
    ]) {
      expect(() => codec.encode(value as never)).toThrowError(
        expect.objectContaining({ code: 'ENCODE_FAILED' })
      )
      if (value.$rpc !== 'set' || !Array.isArray(value.values))
        expect(() => codec.decode(JSON.stringify(value))).toThrowError(
          expect.objectContaining({ code: 'DECODE_FAILED' })
        )
    }
    expect(codec.decode('["migaia-collections-json-v1","map",[[1,2]]]')).toEqual([
      'migaia-collections-json-v1',
      'map',
      [[1, 2]]
    ])
  })

  it('projects class fields and shared noncyclic children without mutating inputs', () => {
    class Row {
      b = 1
      a = 2
    }
    const codec = defineCollectionsJsonCodec({ version: 1 })
    expect(codec.encode({ ...new Row() })).toBe('{"b":1,"a":2}')
    expect(codec.encode(new Row() as never)).toBe('{"b":1,"a":2}')
    const shared = new Set([1])
    expect(codec.decode(codec.encode({ left: shared, right: shared }))).toEqual({
      left: new Set([1]),
      right: new Set([1])
    })
    expect(() => defineCollectionsJsonCodec({ version: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
  })

  it('keeps codec property order without comparison sorting and preserves public projection order', () => {
    const input = Object.fromEntries(
      Array.from({ length: 10_000 }, (_, i) => [`k${10_000 - i}`, i])
    )
    const sort = vi.spyOn(Array.prototype, 'sort')
    try {
      const expected = JSON.stringify(input)
      for (const codec of [
        defineJsonCodec({ version: 1 }),
        defineCollectionsJsonCodec({ version: 1 })
      ]) {
        expect(codec.encode(input)).toBe(expected)
        expect(codec.encode(input)).toBe(expected)
      }
      expect(sort).not.toHaveBeenCalled()
    } finally {
      sort.mockRestore()
    }
    expect(Object.keys(toPortableValue({ b: 1, a: 2 }) as object)).toEqual(['a', 'b'])
  })

  it('visits format getters once in property order and emits format-specific ordered bytes', () => {
    const reads: string[] = []
    const input = {
      get b() {
        reads.push('b')
        return {
          get z() {
            reads.push('z')
            return 1
          }
        }
      },
      get a() {
        reads.push('a')
        return 2
      }
    }
    for (const codec of [
      defineJsonCodec({ version: 1 }),
      defineCollectionsJsonCodec({ version: 1 }),
      defineCBORCodec({ version: 1 }),
      defineMessagePackCodec({ version: 1 })
    ]) {
      reads.length = 0
      codec.encode(input)
      expect(reads).toEqual(['b', 'z', 'a'])
    }
    expect(
      Buffer.from(defineCBORCodec({ version: 1 }).encode({ b: 1, a: 2 })).toString('hex')
    ).toBe('a2616201616102')
    expect(
      Buffer.from(defineMessagePackCodec({ version: 1 }).encode({ b: 1, a: 2 })).toString('hex')
    ).toBe('82a16201a16102')
    expect(
      defineCollectionsJsonCodec({ version: 1 }).encode({ z: 1, '10': 10, a: 2, '2': 2 })
    ).toBe('{"2":2,"10":10,"z":1,"a":2}')
  })
})
