import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { decode as decodeCbor, encode as encodeCbor } from 'cborg'
import { Packr, unpack as unpackMessagePack } from 'msgpackr'
import * as protobuf from 'protobufjs'
import descriptor from 'protobufjs/ext/descriptor/index.js'
import { describe, expect, it } from 'vitest'
import { defineCBORCodec } from '../src/codecs/cbor.js'
import { defineJsonCodec } from '../src/codecs/json.js'
import { defineMessagePackCodec } from '../src/codecs/message-pack.js'
import { defineProtobufCodec } from '../src/codecs/protobuf.js'
import { rpcProtocolV1 } from '../../rpc-contract/dist/index.js'
import {
  rpcEnvelopeDescriptorBase64,
  RpcEnvelopeSchema,
  type IRpcEnvelopeMessage
} from './fixtures/rpc-envelope-schema.js'
import { createRpcProtobufPayloadCodec } from '../../web-rpc/test/interop/rpc-protobuf-payload.mjs'
import type { ICodecValue } from '../src/codec.js'

type ICanonicalVector = Readonly<{ id: string; value: ICodecValue }>
type ICanonicalDocument = Readonly<{ version: number; cases: readonly ICanonicalVector[] }>
type IByteVector = Readonly<{ value: ICodecValue; hex: string }>
type IDescriptorRoot = Readonly<{
  toDescriptor: (syntax: 'proto3') => Readonly<{ file: readonly unknown[] }>
}>
type IDescriptorModule = Readonly<{
  FileDescriptorProto: Readonly<{
    encode: (value: unknown) => Readonly<{ finish: () => Uint8Array }>
  }>
}>

/** Canonical values shared with the runtime-neutral contract vector corpus. */
const canonicalDocument = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../rpc-contract/schema/vectors/canonical.json'),
    'utf8'
  )
) as ICanonicalDocument

/** Normative schema text used to create an independent protobufjs binding. */
const protobufSchema = readFileSync(
  resolve(import.meta.dirname, '../../rpc-contract/schema/rpc-v1.proto'),
  'utf8'
)

/** Protobufjs message type created from the normative schema at test runtime. */
const protobufMessage = protobuf.parse(protobufSchema).root.lookupType('migaia.rpc.v1.RpcEnvelope')

/** Independent MessagePack encoder configured for plain maps. */
const independentMessagePack = new Packr({ useRecords: false })

/** Byte-exact scalar vectors shared by both production and independent codec assertions. */
const messagePackByteVectors: readonly IByteVector[] = [
  { value: null, hex: 'c0' },
  { value: true, hex: 'c3' },
  { value: -1.5, hex: 'cbbff8000000000000' },
  { value: 'text', hex: 'a474657874' },
  { value: { key: 'value' }, hex: '81a36b6579a576616c7565' }
]

/** Convert a binary result into the stable lowercase spelling used by vector fixtures. */
const toHex = (value: Uint8Array): string => Buffer.from(value).toString('hex')

describe('independent codec interoperability', () => {
  it('T10 matches native JSON for every canonical vector', () => {
    const codec = defineJsonCodec({ version: canonicalDocument.version })
    for (const vector of canonicalDocument.cases) {
      const encoded = codec.encode(vector.value)
      expect(JSON.parse(encoded)).toEqual(vector.value)
      expect(codec.decode(encoded)).toEqual(vector.value)
    }
  })

  it('T11 matches msgpackr bytes and independent decode for every canonical vector', () => {
    const codec = defineMessagePackCodec({ version: canonicalDocument.version })
    for (const vector of canonicalDocument.cases) {
      const encoded = codec.encode(vector.value)
      const independent = Uint8Array.from(independentMessagePack.pack(vector.value))
      expect(unpackMessagePack(encoded)).toEqual(vector.value)
      expect(codec.decode(independent)).toEqual(vector.value)
    }
    for (const vector of messagePackByteVectors)
      expect(toHex(codec.encode(vector.value))).toBe(vector.hex)
  })

  it('T12 matches cborg bytes and independent decode for every canonical vector', () => {
    const codec = defineCBORCodec({ version: canonicalDocument.version })
    for (const vector of canonicalDocument.cases) {
      const encoded = codec.encode(vector.value)
      const independent = Uint8Array.from(encodeCbor(vector.value, { float64: true }))
      expect(Uint8Array.from(encoded)).toEqual(independent)
      expect(decodeCbor(encoded)).toEqual(vector.value)
      expect(codec.decode(independent)).toEqual(vector.value)
    }
  })

  it('T12 projects independently encoded signed safe integers through nested portable values', () => {
    const codec = defineCBORCodec({ version: canonicalDocument.version })
    /** Realistic timestamp and signed boundaries encoded by an independent CBOR implementation. */
    const value = {
      sentAt: 1700000000000,
      nested: [
        2 ** 32,
        -(2 ** 32) - 1,
        { maximum: Number.MAX_SAFE_INTEGER, minimum: Number.MIN_SAFE_INTEGER }
      ]
    }
    const encoded = Uint8Array.from(encodeCbor(value))
    expect(codec.decode(encoded)).toEqual(value)
    expect(() => codec.decode(Uint8Array.from(encodeCbor(9007199254740992n)))).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION', source: '@migaia/serialize' })
    )
    expect(() => codec.decode(Uint8Array.from(encodeCbor(-9007199254740992n)))).toThrowError(
      expect.objectContaining({ code: 'INVALID_OPTION', source: '@migaia/serialize' })
    )
  })

  it('T13 round-trips normative rpc-v1 bytes through an independent protobufjs binding', () => {
    const codec = defineProtobufCodec({
      version: 1,
      schema: { id: 'migaia.rpc', version: 1 },
      binding: RpcEnvelopeSchema
    })
    const value: IRpcEnvelopeMessage = {
      $typeName: 'migaia.rpc.v1.RpcEnvelope',
      kind: 'request',
      id: 'independent-vector',
      payload: Uint8Array.from([0, 1, 255])
    }
    const independentBytes = Uint8Array.from(
      protobufMessage
        .encode(
          protobufMessage.create({
            kind: value.kind,
            id: value.id,
            payload: Buffer.from(value.payload)
          })
        )
        .finish()
    )
    expect(codec.id).toBe('protobuf')
    expect(codec.schema).toEqual({ id: 'migaia.rpc', version: 1 })
    expect(codec.encode(value)).toEqual(independentBytes)
    expect(codec.decode(independentBytes)).toMatchObject(value)
  })

  it('F3 regenerates the canonical Buf descriptor from rpc-v1.proto', () => {
    const regenerated = (
      protobuf.parse(protobufSchema).root as unknown as IDescriptorRoot
    ).toDescriptor('proto3').file[0]!
    const regeneratedBytes = (
      descriptor as unknown as IDescriptorModule
    ).FileDescriptorProto.encode(regenerated).finish()
    const fixtureBytes = Buffer.from(rpcEnvelopeDescriptorBase64, 'base64')
    expect(Buffer.from(regeneratedBytes)).toEqual(fixtureBytes)
    expect(RpcEnvelopeSchema.typeName).toBe('migaia.rpc.v1.RpcEnvelope')
    expect(RpcEnvelopeSchema.fields.map((field) => field.localName)).toEqual([
      'kind',
      'id',
      'payload'
    ])
    expect(RpcEnvelopeSchema.fields.map((field) => field.number)).toEqual([1, 2, 3])
  })

  it('F3 keeps request and failure-response body fields across Buf and independent protobufjs', () => {
    const protobufCodec = defineProtobufCodec({
      version: 1,
      schema: { id: 'migaia.rpc', version: 1 },
      binding: RpcEnvelopeSchema
    })
    const jsonCodec = defineJsonCodec({ version: 1 })
    const productionCodec = createRpcProtobufPayloadCodec({
      protobufCodec,
      jsonCodec,
      normalize: rpcProtocolV1.normalize
    })
    const request = {
      kind: 'request' as const,
      id: 'f3-request',
      method: 'echo',
      data: { request: true }
    }
    const { kind: requestKind, id: requestId, ...requestBody } = request
    const productionRequest = productionCodec.encode({
      kind: requestKind,
      id: requestId,
      ...requestBody
    })
    const peerRequest = protobufMessage.decode(productionRequest) as unknown as {
      readonly kind: string
      readonly id: string
      readonly payload: Uint8Array
    }
    expect(peerRequest.kind).toBe(request.kind)
    expect(peerRequest.id).toBe(request.id)
    expect(JSON.parse(new TextDecoder().decode(peerRequest.payload))).toEqual({
      method: 'echo',
      data: { request: true }
    })

    const responseBody = {
      ok: false,
      code: 'REJECTED',
      message: 'peer rejected',
      data: { retry: false },
      error: {
        source: 'peer',
        code: 'PEER_REJECTED',
        name: 'Error',
        message: 'peer rejected',
        stack: 'peer-stack'
      }
    }
    const peerResponse = Uint8Array.from(
      protobufMessage
        .encode(
          protobufMessage.create({
            kind: 'response',
            id: 'f3-response',
            payload: Buffer.from(JSON.stringify(responseBody))
          })
        )
        .finish()
    )
    expect(productionCodec.decode(peerResponse)).toEqual({
      kind: 'response',
      id: 'f3-response',
      ...responseBody
    })
  })

  it('F3 rejects invalid outer identity and payload identity collisions with the original cause', () => {
    const protobufCodec = defineProtobufCodec({
      version: 1,
      schema: { id: 'migaia.rpc', version: 1 },
      binding: RpcEnvelopeSchema
    })
    const jsonCodec = defineJsonCodec({ version: 1 })
    const productionCodec = createRpcProtobufPayloadCodec({
      protobufCodec,
      jsonCodec,
      normalize: rpcProtocolV1.normalize
    })
    expect(() =>
      productionCodec.encode({ kind: 'request', id: '', method: 'echo', data: null })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ENVELOPE' }))
    const invalidCases = [
      { kind: 'unknown', id: 'f3-invalid', payload: '{}' },
      { kind: 'request', id: '', payload: '{"method":"echo","data":null}' },
      {
        kind: 'request',
        id: 'f3-kind-collision',
        payload: '{"kind":"response","method":"echo","data":null}'
      },
      {
        kind: 'request',
        id: 'f3-id-collision',
        payload: '{"id":"other","method":"echo","data":null}'
      },
      {
        kind: 'request',
        id: 'f3-invalid-utf8',
        payload: Uint8Array.of(123, 34, 109, 195, 34, 58, 34, 34, 125)
      }
    ] as const
    for (const invalidCase of invalidCases) {
      const payload =
        typeof invalidCase.payload === 'string'
          ? Buffer.from(invalidCase.payload)
          : invalidCase.payload
      const bytes = Uint8Array.from(
        protobufMessage.encode(protobufMessage.create({ ...invalidCase, payload })).finish()
      )
      let thrown: unknown
      try {
        productionCodec.decode(bytes)
      } catch (error) {
        thrown = error
      }
      expect(thrown).toMatchObject({
        source: '@migaia/rpc-contract',
        code: 'INVALID_ENVELOPE'
      })
      expect((thrown as Error).cause).toBeDefined()
    }
    const originalCause = new TypeError('invalid JSON payload')
    const throwingJsonCodec = Object.freeze({
      ...jsonCodec,
      decode: () => {
        throw originalCause
      }
    })
    const wrappingCodec = createRpcProtobufPayloadCodec({
      protobufCodec,
      jsonCodec: throwingJsonCodec,
      normalize: rpcProtocolV1.normalize
    })
    const validEnvelope = protobufCodec.encode({
      $typeName: 'migaia.rpc.v1.RpcEnvelope',
      kind: 'request',
      id: 'f3-cause',
      payload: new Uint8Array()
    })
    expect(() => wrappingCodec.decode(validEnvelope)).toThrowError(
      expect.objectContaining({ cause: originalCause })
    )
  })
})
