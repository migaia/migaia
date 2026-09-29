import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  createRpcUnknownFieldWarner,
  normalizeRpcEnvelope,
  normalizeRpcHandshake,
  RpcRouteField,
  RpcRouteProfile,
  RpcWireLimit,
  type IRpcHandshakeOffer
} from '../../src/contract/index.js'

/** Schema and vectors are language-neutral artifacts owned by the contract package. */
const schemaRoot = join(import.meta.dirname, '../../schema')
/** The same cases are copied verbatim to frozen/1.0 at the protocol cutover. */
const vectorRoot = join(schemaRoot, 'vectors')

/** Read one checked-in JSON artifact without importing runtime internals. */
function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

/** Convert an expected failure to its stable wire-level violation and pointer. */
function envelopeFailure(value: unknown): {
  code?: unknown
  violation?: unknown
  pointer?: unknown
} {
  try {
    normalizeRpcEnvelope(value)
  } catch (error) {
    return error as { code?: unknown; violation?: unknown; pointer?: unknown }
  }
  throw new Error('expected an invalid vector')
}

describe('protocol 1.0 schemas and frozen vectors (A9)', () => {
  it('keeps the schema field rows, route keys, validation order and wire limits aligned', () => {
    const schema = readJson(join(schemaRoot, 'envelope.schema.json'))
    expect(schema['x-migaia-limits']).toEqual(RpcWireLimit)
    expect(schema['x-migaia-validation-order']).toEqual(['V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7'])
    const rows = schema.oneOf as Array<{ title: string; required: string[] }>
    expect(Object.fromEntries(rows.map(({ title, required }) => [title, required]))).toEqual({
      request: ['kind', 'id', 'method', 'data'],
      'response-success': ['kind', 'ok', 'id', 'data'],
      'response-failure': ['kind', 'ok', 'id', 'code', 'message', 'data'],
      discovery: ['kind', 'id', 'version', 'acceptVersions', 'data'],
      variation: ['kind', 'id', 'data'],
      stream: ['kind', 'id', 'data']
    })
    const route = (schema.$defs as { route: { properties: Record<string, unknown> } }).route
    expect(Object.keys(route.properties).sort()).toEqual(Object.values(RpcRouteField).sort())
    expect((route.properties.profile as { const: string }).const).toBe(RpcRouteProfile)
    expect(readJson(join(schemaRoot, 'handshake.schema.json')).$id).toBe('migaia.rpc.handshake/1')
  })

  it('accepts valid envelopes and preserves invalid first-failure and warning vectors', () => {
    const vectors = readJson(join(vectorRoot, 'envelope.json')) as {
      valid: Array<{ id: string; value: unknown }>
      invalid: Array<{
        id: string
        value: unknown
        violation: string
        pointer: string
        evolvable?: boolean
      }>
      order: Array<{ id: string; value: unknown; violation: string; pointer: string }>
      unknownFields: Array<{ id: string; value: unknown; expected: Array<[string, string]> }>
      warnings: {
        sequence: Array<{ connection: string; kind: string; pointer: string; field: string }>
        expected: Array<[string, string]>
      }
    }
    for (const { id, value } of vectors.valid) {
      const result = normalizeRpcEnvelope(value)
      expect(Object.isFrozen(result), id).toBe(true)
      expect(Object.isFrozen(result.data), id).toBe(true)
    }
    const streamVectors = readJson(join(vectorRoot, 'stream.json')) as {
      envelope: { reclassified: { id: string; violation: string; pointer: string } }
    }
    for (const { id, value, violation, pointer } of [...vectors.invalid, ...vectors.order]) {
      const error = envelopeFailure(value)
      const expected =
        id === streamVectors.envelope.reclassified.id
          ? streamVectors.envelope.reclassified
          : { violation, pointer }
      expect(error, id).toMatchObject({
        code: 'INVALID_ENVELOPE',
        violation: expected.violation,
        pointer: expected.pointer
      })
      expect(error, id).toBeInstanceOf(TypeError)
    }
    for (const { id, value, expected } of vectors.unknownFields) {
      const fields: Array<[string, string]> = []
      normalizeRpcEnvelope(value, {
        onUnknownField: (pointer, field) => fields.push([pointer, field])
      })
      expect(fields, id).toEqual(expected)
    }
    const warnings: Array<[string, string]> = []
    const warner = createRpcUnknownFieldWarner({
      warn: (connection, key) => warnings.push([connection, key])
    })
    for (const { connection, kind, pointer, field } of vectors.warnings.sequence)
      warner.note(connection, kind, pointer, field)
    expect(warnings).toEqual(vectors.warnings.expected)
  })

  it('matches negotiation and error vectors through the public handshake functions', () => {
    const vectors = readJson(join(vectorRoot, 'handshake.json')) as {
      agreement: Array<{
        id: string
        initiator: IRpcHandshakeOffer
        responder: IRpcHandshakeOffer
        expected: Record<string, unknown>
      }>
      invalid: Array<{
        id: string
        value?: unknown
        initiator?: IRpcHandshakeOffer
        responder?: IRpcHandshakeOffer
        violation?: string
        reason?: string
      }>
      mismatch: Array<{ id: string; accept: unknown; violation: string }>
    }
    for (const { id, initiator, responder, expected } of vectors.agreement) {
      const answer = acceptRpcHandshake(responder, JSON.stringify(initiator))
      expect(answer.ok, id).toBe(true)
      if (!answer.ok) continue
      expect(answer.agreement, id).toMatchObject(expected)
      expect(completeRpcHandshake(initiator, answer.reply), id).toMatchObject(expected)
    }
    for (const entry of vectors.invalid) {
      if (entry.value !== undefined) {
        expect(() => normalizeRpcHandshake(JSON.stringify(entry.value)), entry.id).toThrow(
          expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: entry.violation })
        )
      } else if (entry.initiator && entry.responder) {
        const answer = acceptRpcHandshake(entry.responder, JSON.stringify(entry.initiator))
        expect(answer.ok, entry.id).toBe(false)
        if (!answer.ok)
          expect(answer.error).toMatchObject({
            code: 'HANDSHAKE_INCOMPATIBLE',
            reason: entry.reason
          })
      }
    }
    const initiator = vectors.agreement[0]!.initiator
    for (const { id, accept, violation } of vectors.mismatch)
      expect(() => completeRpcHandshake(initiator, JSON.stringify(accept)), id).toThrow(
        expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation })
      )
  })

  it('checks each frozen vector digest against the checked-in manifest', () => {
    const frozen = join(vectorRoot, 'frozen/1.0')
    const checksums = readFileSync(join(frozen, 'SHA256SUMS'), 'utf8').trim().split('\n')
    expect(checksums).toHaveLength(3)
    for (const row of checksums) {
      const [digest, filename] = row.split('  ')
      expect(['envelope.json', 'control.json', 'handshake.json']).toContain(filename)
      const contents = readFileSync(join(frozen, filename!))
      expect(createHash('sha256').update(contents).digest('hex')).toBe(digest)
      expect(contents.equals(readFileSync(join(vectorRoot, filename!)))).toBe(true)
    }
  })
})
