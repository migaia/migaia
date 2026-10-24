import { fromValueCodec } from '@migaia/storage-host/authoring/codec'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import { createTaggedCodec, type ITaggedValue } from '@migaia/serialize/tagged'
import {
  StorageContractErrorCode,
  StorageStageKind,
  type ICodecStageObserver
} from '@migaia/storage-contract'

describe('value codec adaptation', () => {
  it('delegates JSON encoding and decoding once with precise metadata', async () => {
    /** Factory metadata remains literal through adaptation. */
    const codec = fromValueCodec(defineJsonCodec({ version: 2 }))
    expect(codec.name).toBe('json@2')
    expect(codec.output).toBe('text')
    await expect(codec.encode({ a: 1 })).resolves.toBe('{"a":1}')
    await expect(codec.decode('{"a":1}')).resolves.toEqual({ a: 1 })
    expectTypeOf(codec.name).toEqualTypeOf<'json@2'>()
    expectTypeOf(codec.output).toEqualTypeOf<'text'>()
    await expect(codec.encode({ a: NaN })).rejects.toMatchObject({
      code: StorageContractErrorCode.invalidArgument,
      cause: { source: '@migaia/serialize', code: 'INVALID_OPTION' }
    })
    await expect(codec.decode('{bad')).rejects.toMatchObject({
      code: StorageContractErrorCode.invalidArgument,
      cause: { source: '@migaia/serialize', code: 'DECODE_FAILED', cause: expect.any(SyntaxError) }
    })
  })

  it('preserves each original failure, its cause and stack for sync and async callbacks', async () => {
    /** Deeper cause and stack must remain unchanged after contract wrapping. */
    const primary = new Error('primary')
    /** The codec failure itself remains the immediate contract cause. */
    const original = new TypeError('codec failed', { cause: primary })
    /** Stack is captured before the adapter can touch the error. */
    const stack = original.stack
    for (const invoke of [
      () => {
        throw original
      },
      () => Promise.reject(original)
    ]) {
      /** Both native throwing and asynchronous rejection use one await/catch boundary. */
      const codec = fromValueCodec({
        id: 'test',
        version: 1,
        encodedType: 'unknown',
        encode: invoke,
        decode: invoke
      })
      for (const operation of [() => codec.encode(undefined), () => codec.decode(undefined)]) {
        try {
          await operation()
          expect.unreachable()
        } catch (error) {
          expect(error).toMatchObject({
            code: StorageContractErrorCode.invalidArgument,
            cause: original
          })
        }
      }
    }
    expect(original.cause).toBe(primary)
    expect(original.stack).toBe(stack)
  })

  it.each([
    {},
    null,
    [],
    { id: 1 },
    { id: 'x', version: 0, encodedType: 'string', encode: () => '', decode: () => '' },
    { id: 'x', version: NaN, encodedType: 'string', encode: () => '', decode: () => '' },
    { id: 'x', version: 1, encodedType: 'wrong', encode: () => '', decode: () => '' },
    { id: 'x', version: 1, encodedType: 'string', encode: 1, decode: () => '' }
  ])('rejects an invalid descriptor synchronously %#', (value) => {
    expect(() => fromValueCodec(value as never)).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidArgument })
    )
  })

  it('routes binary and unknown carriers without changing callback results', async () => {
    /** The binary callback result is returned without a second byte copy. */
    const bytes = new Uint8Array([1, 2])
    /** Binary metadata chooses its route independently from the input domain. */
    const binary = fromValueCodec({
      id: 'bytes',
      version: 1,
      encodedType: 'uint8array',
      encode: (_value: string) => bytes,
      decode: (_raw: Uint8Array) => 'decoded'
    })
    expect(binary.output).toBe('binary')
    await expect(binary.encode('value')).resolves.toBe(bytes)
    await expect(binary.decode(bytes)).resolves.toBe('decoded')
    /** Structured values remain the same references when the source callback returns them. */
    const state = { count: 1 }
    /** Unknown-carrier metadata keeps exact source input and output types. */
    const structured = fromValueCodec({
      id: 'identity',
      version: 1,
      encodedType: 'unknown',
      encode: (value: typeof state) => value,
      decode: (raw: typeof state) => raw
    })
    expect(structured.output).toBe('structured')
    await expect(structured.encode(state)).resolves.toBe(state)
    await expect(structured.decode(state)).resolves.toBe(state)
    expectTypeOf(binary.encode).parameters.toEqualTypeOf<
      [value: string, context?: import('@migaia/storage-contract').IOperationContext]
    >()
  })

  it('retains tagged decode inputs independently of tagged encode output', async () => {
    /** Unknown carrier tags a domain object while still accepting its raw legacy form. */
    const objectCodec = fromValueCodec(
      createTaggedCodec({
        codecs: [
          {
            id: 'object',
            version: 1,
            encodedType: 'unknown',
            encode: (value: { count: number }) => value,
            decode: (raw: { count: number }) => raw
          }
        ]
      })
    )
    /** Exact domain value is restored from both tagged and untagged representations. */
    const object = { count: 1 }
    expectTypeOf(objectCodec.encode).returns.toEqualTypeOf<
      Promise<ITaggedValue<{ count: number }>>
    >()
    expectTypeOf(objectCodec.decode).parameters.toEqualTypeOf<
      [
        raw: ITaggedValue<{ count: number }> | { count: number },
        context?: import('@migaia/storage-contract').IOperationContext
      ]
    >()
    /** Raw reads require an explicit untagged codec, as decided by the tag owner. */
    const identity = {
      id: 'object',
      version: 1,
      encodedType: 'unknown' as const,
      encode: (value: { count: number }) => value,
      decode: (raw: { count: number }) => raw
    }
    /** Adapter retains the tagged codec's wider decode signature without guessing from encode. */
    const readable = fromValueCodec(createTaggedCodec({ codecs: [identity], untagged: identity }))
    await expect(readable.decode(object)).resolves.toBe(object)
    await expect(readable.decode(await readable.encode(object))).resolves.toBe(object)
    /** String-valued unknown carriers still emit tagged containers rather than plain strings. */
    const text = fromValueCodec(
      createTaggedCodec({
        codecs: [
          {
            id: 'text',
            version: 1,
            encodedType: 'unknown',
            encode: (value: string) => value,
            decode: (raw: string) => raw
          }
        ]
      })
    )
    expectTypeOf(text.encode).returns.toEqualTypeOf<Promise<ITaggedValue<string>>>()
    /** Byte-valued unknown carriers likewise retain their tagged container type. */
    const bytes = fromValueCodec(
      createTaggedCodec({
        codecs: [
          {
            id: 'bytes',
            version: 1,
            encodedType: 'unknown',
            encode: (value: Uint8Array) => value,
            decode: (raw: Uint8Array) => raw
          }
        ]
      })
    )
    expectTypeOf(bytes.encode).returns.toEqualTypeOf<Promise<ITaggedValue<Uint8Array>>>()
  })

  it('unwraps Promise results and preserves exclusive source union branches', async () => {
    /** Source Promise results must not create a Promise-of-Promise public return type. */
    const asynchronous = fromValueCodec({
      id: 'async',
      version: 1,
      encodedType: 'unknown',
      encode: async (value: number) => value,
      decode: async (value: number) => value
    })
    expectTypeOf(asynchronous.encode).returns.toEqualTypeOf<Promise<number>>()
    await expect(asynchronous.encode(3)).resolves.toBe(3)
    /** Two genuinely exclusive domains must remain correlated with their name and output tags. */
    function verifyUnion(
      source:
        | {
            readonly id: 'count'
            readonly version: 1
            readonly encodedType: 'string'
            encode(value: number): string
            decode(raw: string): number
          }
        | {
            readonly id: 'bytes'
            readonly version: 1
            readonly encodedType: 'uint8array'
            encode(value: string): Uint8Array
            decode(raw: Uint8Array): string
          }
    ): void {
      /** Distribution keeps callbacks paired with each metadata branch. */
      const codec = fromValueCodec(source)
      // @ts-expect-error Mutually exclusive input domains require a metadata narrowing first.
      codec.encode(1)
      if (codec.output === 'text')
        expectTypeOf(codec.encode).parameters.toEqualTypeOf<
          [value: number, context?: import('@migaia/storage-contract').IOperationContext]
        >()
      else expectTypeOf(codec.decode).returns.toEqualTypeOf<Promise<string>>()
    }
    void verifyUnion
  })

  it('uses the serialize collection owner for nested values without clone classification', async () => {
    /** Storage adaptation never introduces its own collection format or value traversal. */
    const codec = fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))
    /** Nested real collections exercise the shared serialize implementation through the adapter. */
    const value = { roles: new Map([['Ada', new Set(['read', 'write'])]]) }
    /** Source codec creates the single canonical encoded representation. */
    const raw = await codec.encode(value)
    expect(raw).toContain('"$rpc":"map"')
    expect(raw).toContain('"$rpc":"set"')
    /** Domain union is honest; narrow the restored value rather than asserting a business schema. */
    const restored = await codec.decode(raw)
    expect(restored).toEqual(value)
    expect(restored).not.toBe(value)
    expect(codec.name).toBe('collections-json@1')
    expect(codec.output).toBe('text')
  })
})

describe('codec observation types', () => {
  it('uses the canonical family kind and rejects a mismatched observer family', () => {
    /** All observers are pure declarations; the host owns their actual callbacks and permissions. */
    function observerTypes(observer: ICodecStageObserver): void {
      expectTypeOf(observer.kind).toEqualTypeOf<typeof StorageStageKind.codec>()
      // @ts-expect-error Transaction observation cannot be silently substituted for codec observation.
      const wrong: ICodecStageObserver = { ...observer, kind: StorageStageKind.transaction }
      void wrong
    }
    void observerTypes
    expect(StorageStageKind.codec).toBe('codec')
  })
})
