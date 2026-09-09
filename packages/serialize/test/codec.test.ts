import { describe, expect, it } from 'vitest'
import { identityCodecV1 } from '../src/codecs/identity.js'
import { identityCodec } from '../src/codecs/identity/v1.js'
import { defineJsonCodec } from '../src/codecs/json.js'
import { defineMessagePackCodec } from '../src/codecs/message-pack.js'
import { defineCBORCodec } from '../src/codecs/cbor.js'
import { defineProtobufCodec } from '../src/codecs/protobuf.js'
import { RpcEnvelopeSchema } from './fixtures/rpc-envelope-schema.js'
import type { ICodecValue } from '../src/codec.js'

const value = { text: 'portable', bytes: { $rpc: 'bytes', base64url: 'AAE' }, nested: [null, 1] }

/** Stable scalar fixtures make binary codec regressions visible as byte-level diffs. */
const goldenVectors = [
  { value: null, json: 'null', messagePack: 'c0', cbor: 'f6' },
  { value: true, json: 'true', messagePack: 'c3', cbor: 'f5' },
  { value: -1.5, json: '-1.5', messagePack: 'cbbff8000000000000', cbor: 'fbbff8000000000000' },
  { value: 'text', json: '"text"', messagePack: 'a474657874', cbor: '6474657874' },
  {
    value: { key: 'value' },
    json: '{"key":"value"}',
    messagePack: '81a36b6579a576616c7565',
    cbor: 'a1636b65796576616c7565'
  }
] as const

describe('versioned codecs', () => {
  it('preserves identity descriptor and arbitrary whole-frame values', () => {
    expect(Object.isFrozen(identityCodecV1)).toBe(true)
    const marker = { value: 1 }
    expect(identityCodecV1.decode(identityCodecV1.encode(marker))).toBe(marker)
    expect(identityCodec).toBe(identityCodecV1)
  })

  it('round-trips the canonical JSON portable profile', () => {
    const codec = defineJsonCodec({ version: 1 })
    expect(codec.id).toBe('json')
    expect(codec.decode(codec.encode(value))).toEqual(value)
  })

  it('round-trips extension-free binary profiles', () => {
    const messagePack = defineMessagePackCodec({ version: 1 })
    const cbor = defineCBORCodec({ version: 1 })
    expect(messagePack.decode(messagePack.encode(value))).toEqual(value)
    expect(cbor.decode(cbor.encode(value))).toEqual(value)
  })

  it('keeps protobuf schema identity separate from codec identity', () => {
    const codec = defineProtobufCodec({
      version: 2,
      schema: { id: 'migaia.rpc', version: 1 },
      binding: RpcEnvelopeSchema
    })
    expect(codec.id).toBe('protobuf')
    expect(codec.version).toBe(2)
    expect(codec.schema).toEqual({ id: 'migaia.rpc', version: 1 })
    expect(
      codec.decode(
        codec.encode({
          $typeName: 'migaia.rpc.v1.RpcEnvelope',
          kind: 'request',
          id: 'ok',
          payload: new Uint8Array()
        })
      )
    ).toMatchObject({ kind: 'request', id: 'ok', payload: new Uint8Array() })
  })

  it('snapshots hostile protobuf schema identity getters once', () => {
    let idReads = 0
    let versionReads = 0
    const schema = {
      get id() {
        idReads += 1
        return idReads === 1 ? 'migaia.rpc' : 'invalid'
      },
      get version() {
        versionReads += 1
        return versionReads === 1 ? 1 : 0
      }
    }
    const codec = defineProtobufCodec({ version: 1, schema, binding: RpcEnvelopeSchema })
    expect(idReads).toBe(1)
    expect(versionReads).toBe(1)
    expect(codec.schema).toEqual({ id: 'migaia.rpc', version: 1 })
  })

  it('retains the original getter failure as a coded invalid protobuf option cause', () => {
    const original = new Error('hostile schema id')
    const schema = {
      get id(): string {
        throw original
      },
      version: 1
    }
    expect(() =>
      defineProtobufCodec({ version: 1, schema, binding: RpcEnvelopeSchema })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION', cause: original }))
  })

  it('normalizes hostile protobuf binding discriminator getters once', () => {
    const original = new Error('hostile binding kind')
    let reads = 0
    const binding = {
      get kind(): never {
        reads += 1
        throw original
      },
      typeName: 'migaia.rpc.v1.RpcEnvelope'
    }
    expect(() =>
      defineProtobufCodec({
        version: 1,
        schema: { id: 'migaia.rpc', version: 1 },
        binding: binding as never
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION', cause: original }))
    expect(reads).toBe(1)
  })

  it('retains each hostile protobuf option getter failure after one read', () => {
    const cases = [
      {
        name: 'version',
        create: (original: Error, reads: { value: number }) => ({
          get version(): never {
            reads.value += 1
            throw original
          },
          schema: { id: 'migaia.rpc', version: 1 },
          binding: RpcEnvelopeSchema
        })
      },
      {
        name: 'schema',
        create: (original: Error, reads: { value: number }) => ({
          version: 1,
          get schema(): never {
            reads.value += 1
            throw original
          },
          binding: RpcEnvelopeSchema
        })
      },
      {
        name: 'binding',
        create: (original: Error, reads: { value: number }) => ({
          version: 1,
          schema: { id: 'migaia.rpc', version: 1 },
          get binding(): never {
            reads.value += 1
            throw original
          }
        })
      },
      {
        name: 'schema.id',
        create: (original: Error, reads: { value: number }) => ({
          version: 1,
          schema: {
            get id(): never {
              reads.value += 1
              throw original
            },
            version: 1
          },
          binding: RpcEnvelopeSchema
        })
      },
      {
        name: 'schema.version',
        create: (original: Error, reads: { value: number }) => ({
          version: 1,
          schema: {
            id: 'migaia.rpc',
            get version(): never {
              reads.value += 1
              throw original
            }
          },
          binding: RpcEnvelopeSchema
        })
      },
      {
        name: 'binding.kind',
        create: (original: Error, reads: { value: number }) => ({
          version: 1,
          schema: { id: 'migaia.rpc', version: 1 },
          binding: {
            get kind(): never {
              reads.value += 1
              throw original
            },
            typeName: 'migaia.rpc.v1.RpcEnvelope'
          }
        })
      },
      {
        name: 'binding.typeName',
        create: (original: Error, reads: { value: number }) => ({
          version: 1,
          schema: { id: 'migaia.rpc', version: 1 },
          binding: {
            kind: 'message',
            get typeName(): never {
              reads.value += 1
              throw original
            }
          }
        })
      }
    ]
    for (const testCase of cases) {
      const original = new Error(`hostile ${testCase.name}`)
      const reads = { value: 0 }
      try {
        defineProtobufCodec(testCase.create(original, reads) as never)
        throw new Error(`expected ${testCase.name} to reject`)
      } catch (error) {
        expect(error).toMatchObject({
          source: '@migaia/serialize',
          code: 'INVALID_OPTION',
          cause: original
        })
      }
      expect(reads.value).toBe(1)
    }
  })

  it('rejects cycles and nonfinite values before invoking a format runtime', () => {
    const codec = defineJsonCodec({ version: 1 })
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    expect(() => codec.encode(cycle as ICodecValue)).toThrow()
    expect(() => codec.encode(Number.NaN)).toThrow()
    expect(() => codec.encode(1n as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION', source: '@migaia/serialize' })
    )
  })

  it('rejects invalid versions and descriptors before publishing a codec', () => {
    expect(() => defineJsonCodec({ version: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    expect(() =>
      defineProtobufCodec({
        version: 1,
        schema: { id: 'not valid', version: 1 },
        binding: RpcEnvelopeSchema
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION' }))
  })

  it('matches the canonical scalar bytes for JSON, MessagePack, and CBOR', () => {
    const json = defineJsonCodec({ version: 1 })
    const messagePack = defineMessagePackCodec({ version: 1 })
    const cbor = defineCBORCodec({ version: 1 })
    for (const vector of goldenVectors) {
      expect(json.encode(vector.value)).toBe(vector.json)
      expect(Buffer.from(messagePack.encode(vector.value)).toString('hex')).toBe(vector.messagePack)
      expect(Buffer.from(cbor.encode(vector.value)).toString('hex')).toBe(vector.cbor)
      expect(json.decode(vector.json)).toEqual(vector.value)
      expect(messagePack.decode(Uint8Array.from(Buffer.from(vector.messagePack, 'hex')))).toEqual(
        vector.value
      )
      expect(cbor.decode(Uint8Array.from(Buffer.from(vector.cbor, 'hex')))).toEqual(vector.value)
    }
  })

  it('normalizes malformed and foreign codec failures with a reachable cause', () => {
    const json = defineJsonCodec({ version: 1 })
    expect(() => json.decode('{')).toThrowError(
      expect.objectContaining({ code: 'DECODE_FAILED', source: '@migaia/serialize' })
    )

    const protobuf = defineProtobufCodec({
      version: 1,
      schema: { id: 'migaia.rpc', version: 1 },
      binding: RpcEnvelopeSchema
    })
    expect(() => protobuf.decode(Uint8Array.of(255))).toThrowError(
      expect.objectContaining({ code: 'DECODE_FAILED' })
    )
  })

  it('rejects caller-supplied encode and decode callbacks at the type boundary', () => {
    expect(() =>
      defineProtobufCodec({
        version: 1,
        schema: { id: 'migaia.rpc', version: 1 },
        // @ts-expect-error Protobuf codecs only accept a generated Buf descriptor.
        binding: {}
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION' }))
  })
})
