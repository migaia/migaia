import { readFileSync } from 'node:fs'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createTaggedCodec, type ITaggedValue } from '../src/tagged.js'
import { type ICodec, type ICodecValue, normalizeCodecFailure } from '../src/codec.js'
import { defineJsonCodec } from '../src/codecs/json.js'
import { defineCollectionsJsonCodec } from '../src/codecs/collections-json.js'
import { defineCBORCodec } from '../src/codecs/cbor.js'
import { defineMessagePackCodec } from '../src/codecs/message-pack.js'
import { defineProtobufCodec } from '../src/codecs/protobuf.js'
import { identityCodec } from '../src/codecs/identity/v1.js'
import { RpcEnvelopeSchema } from './fixtures/rpc-envelope-schema.js'
import { SerializeErrorCode } from '../src/error-code.js'
import { CodecErrorText } from '../src/codec-text.js'

/** Test frames spell the public binary wire format independently from the implementation. */
function byteFrame(tag: string, payload: Uint8Array): Uint8Array {
  const header = Uint8Array.from(tag, (char) => char.charCodeAt(0))
  const frame = new Uint8Array(7 + header.length + payload.length)
  frame.set([0, 0x4d, 0x47, 0x54, 1, header.length >>> 8, header.length & 255])
  frame.set(header, 7)
  frame.set(payload, 7 + header.length)
  return frame
}

/** Unknown carriers retain their actual inner type even for scalar and binary business payloads. */
function unknownCodec<TEncoded>(
  encoded: TEncoded
): ICodec<number, TEncoded> & { readonly encodedType: 'unknown' } {
  return {
    id: 'opaque',
    version: 1,
    encodedType: 'unknown',
    encode: () => encoded,
    decode: () => 1
  }
}

describe('tagged codec', () => {
  it('writes the first string revision and routes old and untagged text to their own readers', () => {
    const current = {
      id: 'text',
      version: 2,
      encodedType: 'string' as const,
      encode: vi.fn((value: string) => `new:${value}`),
      decode: vi.fn((raw: string) => `new:${raw}`)
    }
    const previous = { ...current, version: 1, decode: vi.fn((raw: string) => `old:${raw}`) }
    const legacy = { ...current, id: 'legacy', decode: vi.fn((raw: string) => `legacy:${raw}`) }
    const tagged = createTaggedCodec({ codecs: [current, previous], untagged: legacy })
    expect(tagged.encode('3')).toBe('mgt1:text@2;new:3')
    expect(tagged.decode('mgt1:text@2;payload')).toBe('new:payload')
    expect(tagged.decode('mgt1:text@1;payload')).toBe('old:payload')
    expect(tagged.decode('raw')).toBe('legacy:raw')
    expect(current.decode.mock.calls).toEqual([['payload']])
    expect(previous.decode.mock.calls).toEqual([['payload']])
    expect(legacy.decode.mock.calls).toEqual([['raw']])
    expect(() => tagged.decode('mgt1:missing@1;raw')).toThrowError(
      expect.objectContaining({ code: 'TAG_UNKNOWN' })
    )
    expect(() => tagged.decode('mgt1:text')).toThrowError(
      expect.objectContaining({ code: 'TAG_INVALID' })
    )
    expect(legacy.decode).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(tagged)).toBe(true)
  })

  it('routes byte revisions with a copied frame and a borrowed payload subarray', () => {
    const payload = new Uint8Array([7, 8])
    const current = {
      id: 'binary',
      version: 2,
      encodedType: 'uint8array' as const,
      encode: vi.fn((_value: string) => payload),
      decode: vi.fn((raw: Uint8Array) => `new:${raw[0]}`)
    }
    const previous = { ...current, version: 1, decode: vi.fn((raw: Uint8Array) => `old:${raw[0]}`) }
    const legacy = {
      ...current,
      id: 'legacy',
      decode: vi.fn((raw: Uint8Array) => `legacy:${raw[0]}`)
    }
    const tagged = createTaggedCodec({ codecs: [current, previous], untagged: legacy })
    const encoded = tagged.encode('one')
    expect(encoded).toEqual(byteFrame('binary@2', payload))
    expect(payload).toEqual(new Uint8Array([7, 8]))
    expect(tagged.decode(encoded)).toBe('new:7')
    expect(current.decode.mock.calls[0]![0].buffer).toBe(encoded.buffer)
    expect(current.decode.mock.calls[0]![0].byteOffset).toBe(encoded.byteOffset + 15)
    expect(tagged.decode(byteFrame('binary@1', payload))).toBe('old:7')
    expect(tagged.decode(payload)).toBe('legacy:7')
    expect(() => tagged.decode(byteFrame('missing@1', payload))).toThrowError(
      expect.objectContaining({ code: 'TAG_UNKNOWN' })
    )
    for (const invalid of [
      new Uint8Array([0, 0x4d, 0x47, 0x54]),
      new Uint8Array([0, 0x4d, 0x47, 0x54, 1, 0, 8]),
      new Uint8Array([0, 0x4d, 0x47, 0x54, 2, 0, 0])
    ])
      expect(() => tagged.decode(invalid)).toThrowError(
        expect.objectContaining({ code: 'TAG_INVALID' })
      )
    expect(legacy.decode).toHaveBeenCalledTimes(1)
  })

  it('routes unknown-carrier wrappers without copying or freezing the inner value', () => {
    const payload = { count: 1 }
    const current = {
      id: 'object',
      version: 2,
      encodedType: 'unknown' as const,
      encode: vi.fn((_value: string) => payload),
      decode: vi.fn((raw: typeof payload) => `new:${raw.count}`)
    }
    const previous = {
      ...current,
      version: 1,
      decode: vi.fn((raw: typeof payload) => `old:${raw.count}`)
    }
    const legacy = {
      ...current,
      id: 'legacy',
      decode: vi.fn((raw: typeof payload) => `legacy:${raw.count}`)
    }
    const tagged = createTaggedCodec({ codecs: [current, previous], untagged: legacy })
    const encoded = tagged.encode('one')
    expect(encoded).toEqual({ '$migaia.codec': 'object@2', value: payload })
    expect(Object.isFrozen(encoded)).toBe(true)
    expect(encoded.value).toBe(payload)
    expect(Object.isFrozen(payload)).toBe(false)
    expect(tagged.decode(encoded)).toBe('new:1')
    expect(tagged.decode({ '$migaia.codec': 'object@1', value: payload })).toBe('old:1')
    expect(tagged.decode(payload)).toBe('legacy:1')
    expect(() => tagged.decode({ '$migaia.codec': 'missing@1', value: payload })).toThrowError(
      expect.objectContaining({ code: 'TAG_UNKNOWN' })
    )
    expect(() => tagged.decode({ '$migaia.codec': 'object@1' } as never)).toThrowError(
      expect.objectContaining({ code: 'TAG_INVALID' })
    )
    expect(legacy.decode).toHaveBeenCalledTimes(1)
  })

  it('requires explicit fallback for each untagged carrier', () => {
    expect(() =>
      createTaggedCodec({ codecs: [defineJsonCodec({ version: 1 })] }).decode('{}')
    ).toThrowError(expect.objectContaining({ code: 'TAG_MISSING' }))
    expect(() =>
      createTaggedCodec({ codecs: [defineCBORCodec({ version: 1 })] }).decode(
        new Uint8Array([0xf6])
      )
    ).toThrowError(expect.objectContaining({ code: 'TAG_MISSING' }))
    expect(() => createTaggedCodec({ codecs: [identityCodec] }).decode({})).toThrowError(
      expect.objectContaining({ code: 'TAG_MISSING' })
    )
  })

  it('rejects noncanonical tags instead of trying a fallback', () => {
    const legacy = { ...defineJsonCodec({ version: 1 }), decode: vi.fn(() => null) }
    const tagged = createTaggedCodec({
      codecs: [defineJsonCodec({ version: 1 })],
      untagged: legacy
    })
    for (const tag of [
      'json@0',
      'json@01',
      'json@1.0',
      'json@1e0',
      'json@9007199254740992',
      'json@1@1',
      '@1',
      'bad/id@1'
    ])
      expect(() => tagged.decode(`mgt1:${tag};null`)).toThrowError(
        expect.objectContaining({ code: 'TAG_INVALID' })
      )
    expect(legacy.decode).not.toHaveBeenCalled()
  })

  it('validates all descriptors and captures fixed identities and callbacks once', () => {
    const codec = defineJsonCodec({ version: 1 })
    for (const options of [
      { codecs: [] },
      { codecs: [codec, codec] },
      { codecs: [codec, defineCBORCodec({ version: 1 })] },
      { codecs: [codec], untagged: identityCodec },
      ...['bad/id', '', 1].map((id) => ({ codecs: [{ ...codec, id }] })),
      ...[0, 1.5, Number.MAX_SAFE_INTEGER + 1].flatMap((version) => [
        { codecs: [{ ...codec, version }] },
        { codecs: [codec], untagged: { ...codec, version } }
      ])
    ])
      expect(() => createTaggedCodec(options as never)).toThrowError(
        expect.objectContaining({ code: 'INVALID_OPTION' })
      )
    const reads = { id: 0, version: 0 }
    const descriptor = {
      ...codec,
      get id() {
        reads.id++
        return 'json' as const
      },
      get version() {
        reads.version++
        return 1 as const
      }
    }
    const tagged = createTaggedCodec({ codecs: [descriptor] })
    tagged.encode({ b: 1 })
    tagged.encode({ a: 2 })
    expect(reads).toEqual({ id: 1, version: 1 })
    const original = new Error('descriptor getter')
    expect(() =>
      createTaggedCodec({
        codecs: [
          {
            ...codec,
            get id(): string {
              throw original
            }
          }
        ]
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION', cause: original }))
  })

  it('normalizes foreign codec failures once and preserves serialize failures by identity', () => {
    const original = new Error('inner codec failed')
    const serialized = normalizeCodecFailure(
      original,
      SerializeErrorCode.invalidOption,
      CodecErrorText.portableValueInvalid
    )
    for (const failure of [original, serialized]) {
      const tagged = createTaggedCodec({
        codecs: [
          {
            id: 'failing',
            version: 1,
            encodedType: 'string',
            encode: (_value: number): string => {
              throw failure
            },
            decode: (_raw: string): number => {
              throw failure
            }
          }
        ]
      })
      for (const [code, operation] of [
        ['ENCODE_FAILED', () => tagged.encode(1)],
        ['DECODE_FAILED', () => tagged.decode('mgt1:failing@1;raw')]
      ] as const) {
        try {
          operation()
          expect.fail('must fail')
        } catch (error) {
          if (failure === serialized) expect(error).toBe(failure)
          else expect(error).toMatchObject({ source: 'serialization', code, cause: original })
        }
      }
    }
  })

  it('retains precise factory carriers, tagged inner types and legacy decode input types', () => {
    const json = createTaggedCodec({
      codecs: [defineJsonCodec({ version: 2 })],
      untagged: defineJsonCodec({ version: 1 })
    })
    expectTypeOf(json.encode(null)).toEqualTypeOf<string>()
    expectTypeOf(json.decode('{}')).toEqualTypeOf<ICodecValue>()
    expectTypeOf(
      createTaggedCodec({ codecs: [defineCollectionsJsonCodec({ version: 1 })] }).encode(new Map())
    ).toEqualTypeOf<string>()
    expectTypeOf(
      createTaggedCodec({ codecs: [defineCBORCodec({ version: 1 })] }).encode(null)
    ).toEqualTypeOf<Uint8Array>()
    expectTypeOf(
      createTaggedCodec({ codecs: [defineMessagePackCodec({ version: 1 })] }).encode(null)
    ).toEqualTypeOf<Uint8Array>()
    const protobuf = defineProtobufCodec({
      version: 1,
      schema: { id: 'example', version: 1 },
      binding: RpcEnvelopeSchema
    })
    expectTypeOf(protobuf.encodedType).toEqualTypeOf<'uint8array'>()
    const object = createTaggedCodec({
      codecs: [unknownCodec({ count: 1 })],
      untagged: unknownCodec({ count: 1 })
    })
    expectTypeOf(object.encode(1)).toEqualTypeOf<ITaggedValue<{ count: number }>>()
    expectTypeOf(object.decode({ count: 1 })).toEqualTypeOf<number>()
    expectTypeOf(createTaggedCodec({ codecs: [unknownCodec('raw')] }).encode(1)).toEqualTypeOf<
      ITaggedValue<string>
    >()
    expectTypeOf(
      createTaggedCodec({ codecs: [unknownCodec(new Uint8Array())] }).encode(1)
    ).toEqualTypeOf<ITaggedValue<Uint8Array<ArrayBuffer>>>()
    const widened: ICodec<ICodecValue, string> = defineJsonCodec({ version: 1 })
    expectTypeOf(createTaggedCodec({ codecs: [widened] }).encode(null)).toEqualTypeOf<
      string | Uint8Array | ITaggedValue<string>
    >()
  })

  it('documents new writes, old tagged reads, explicit legacy reads and unknown-tag failures', () => {
    for (const file of ['README.md', 'README.en.md', 'USEGUIDE.md', 'USEGUIDE.en.md']) {
      const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
      expect(text).toContain('createTaggedCodec')
      expect(text).toContain('mgt1:json@2;')
      expect(text).toContain("tagged.decode('mgt1:json@1;")
      expect(text).toContain('tagged.decode(\'{"count":1}\')')
      expect(text).toContain('TAG_UNKNOWN')
      expect(text).toContain('mgt1:')
    }
    expect(
      readFileSync(new URL('../../../website/app/reference/serialize.ts', import.meta.url), 'utf8')
    ).toContain('createTaggedCodec:')
  })
})
