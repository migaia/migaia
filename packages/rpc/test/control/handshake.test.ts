import { describe, expect, it } from 'vitest'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  createRpcHello,
  normalizeRpcHandshake,
  type IRpcHandshakeOffer
} from '../../src/contract/index.js'

/** Two independent peers advertise overlap without sharing any runtime object. */
const initiator: IRpcHandshakeOffer = {
  versions: [
    { major: 1, minor: 4 },
    { major: 2, minor: 3 }
  ],
  codecs: ['cbor', 'json'],
  capabilities: ['abort@1', 'trace@1', 'x@1'],
  peer: { id: 'caller', runtime: 'zig' }
}
const responder: IRpcHandshakeOffer = {
  versions: [
    { major: 1, minor: 0 },
    { major: 2, minor: 1 },
    { major: 3, minor: 0 }
  ],
  codecs: ['json', 'cbor'],
  capabilities: ['trace@1', 'abort@1'],
  peer: { id: 'provider', runtime: 'node' }
}

describe('handshake 1.0 (A5)', () => {
  it('chooses the greatest shared major and the initiator-preferred codec', () => {
    const answer = acceptRpcHandshake(responder, createRpcHello(initiator))
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.agreement).toMatchObject({
      major: 2,
      minor: 1,
      codec: 'cbor',
      capabilities: ['abort@1', 'trace@1'],
      peer: { runtime: 'zig' }
    })
    expect(completeRpcHandshake(initiator, answer.reply)).toMatchObject({
      major: 2,
      minor: 1,
      codec: 'cbor',
      peer: { id: 'provider' }
    })
  })

  it('keeps a lower shared major, optional peer details, and portable auth', () => {
    const caller: IRpcHandshakeOffer = {
      ...initiator,
      versions: [{ major: 1, minor: 2 }],
      codecs: ['json'],
      auth: { token: 'opaque' },
      peer: {
        id: 'caller',
        runtime: 'zig',
        runtimeVersion: '0.14',
        implementation: { name: 'client', version: '1' }
      }
    }
    const answer = acceptRpcHandshake(
      {
        ...responder,
        versions: [
          { major: 1, minor: 5 },
          { major: 2, minor: 0 }
        ]
      },
      createRpcHello(caller)
    )
    expect(answer.ok).toBe(true)
    if (!answer.ok) return
    expect(answer.agreement).toMatchObject({
      major: 1,
      minor: 2,
      codec: 'json',
      auth: { token: 'opaque' },
      peer: { runtimeVersion: '0.14', implementation: { name: 'client', version: '1' } }
    })
    expect(completeRpcHandshake(caller, answer.reply)).toMatchObject({ major: 1, minor: 2 })
  })

  it('rejects malformed first-message fields at the handshake boundary', () => {
    const hello = JSON.parse(createRpcHello(initiator)) as Record<string, unknown>
    const malformed: readonly [Record<string, unknown>, string][] = [
      [{ ...hello, kind: 'request' }, 'required'],
      [{ ...hello, step: 'resume' }, 'step'],
      [{ ...hello, peer: { id: '', runtime: 'zig' } }, 'required'],
      [
        { ...hello, peer: { id: 'caller', runtime: 'zig', runtimeVersion: 'x'.repeat(65) } },
        'type'
      ],
      [
        { ...hello, peer: { id: 'caller', runtime: 'zig', implementation: { name: 'client' } } },
        'required'
      ],
      [{ ...hello, versions: [] }, 'type'],
      [{ ...hello, versions: [{ major: 0, minor: 0 }] }, 'type'],
      [{ ...hello, codecs: ['json', 'json'] }, 'duplicate'],
      [{ ...hello, capabilities: ['abort@1', 'abort@1'] }, 'duplicate']
    ]
    for (const [message, violation] of malformed)
      expect(() => normalizeRpcHandshake(JSON.stringify(message))).toThrow(
        expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation })
      )
    expect(() => normalizeRpcHandshake('{')).toThrow(
      expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: 'type' })
    )
  })

  it('returns a coded reject and keeps the remote cause on completion', () => {
    const answer = acceptRpcHandshake(
      { ...responder, versions: [{ major: 1, minor: 0 }] },
      createRpcHello({ ...initiator, versions: [{ major: 2, minor: 0 }] })
    )
    expect(answer.ok).toBe(false)
    if (answer.ok) return
    expect(answer.error).toMatchObject({ code: 'HANDSHAKE_INCOMPATIBLE', reason: 'version' })
    expect(normalizeRpcHandshake(answer.reply)).toMatchObject({ step: 'reject' })
    expect(() => completeRpcHandshake(initiator, answer.reply)).toThrow(
      expect.objectContaining({
        code: 'HANDSHAKE_REJECTED',
        cause: expect.objectContaining({ code: 'HANDSHAKE_INCOMPATIBLE' })
      })
    )
  })

  it('rejects absent JSON baseline, duplicate majors, oversized text, and invalid UTF-16', () => {
    expect(() => createRpcHello({ ...initiator, codecs: ['cbor'] })).toThrow(
      expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: 'baseline' })
    )
    expect(() =>
      createRpcHello({
        ...initiator,
        versions: [
          { major: 1, minor: 0 },
          { major: 1, minor: 1 }
        ]
      })
    ).toThrow(expect.objectContaining({ violation: 'duplicate' }))
    expect(() => normalizeRpcHandshake(' '.repeat(65_537))).toThrow(
      expect.objectContaining({ violation: 'bytes' })
    )
    expect(() => normalizeRpcHandshake('\uD800')).toThrow(
      expect.objectContaining({ violation: 'encoding' })
    )
    expect(() => normalizeRpcHandshake(new Uint8Array(65_537))).toThrow(
      expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: 'bytes' })
    )
    expect(() => normalizeRpcHandshake(new Uint8Array([0xff]))).toThrow(
      expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: 'encoding' })
    )
    expect(() => createRpcHello({ ...initiator, auth: { $rpc: 'bytes', base64url: '!' } })).toThrow(
      expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: 'type' })
    )
  })

  it('rejects each accept value outside the local offer and preserves wire error causes', () => {
    const valid = {
      kind: 'handshake',
      step: 'accept',
      protocol: 'migaia.rpc',
      major: 2,
      minor: 1,
      codec: 'cbor',
      capabilities: ['abort@1'],
      peer: responder.peer
    }
    for (const change of [
      { major: 3 },
      { minor: 4 },
      { codec: 'msgpack' },
      { capabilities: ['close@1'] },
      { protocol: 'foreign.rpc' }
    ]) {
      expect(() =>
        completeRpcHandshake(initiator, JSON.stringify({ ...valid, ...change }))
      ).toThrow(expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: 'mismatch' }))
    }
    const invalidReject = JSON.stringify({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { foo: 1 }
    })
    expect(() => normalizeRpcHandshake(invalidReject)).toThrow(
      expect.objectContaining({
        code: 'HANDSHAKE_INVALID',
        cause: expect.objectContaining({
          redacted: true,
          path: '/error',
          wireCode: 'INVALID_WIRE_ERROR',
          wireViolation: 'required'
        })
      })
    )
  })

  it('ignores additive hello fields and wraps hostile local offer reads', () => {
    const fields: string[] = []
    normalizeRpcHandshake(
      JSON.stringify({ ...JSON.parse(createRpcHello(initiator)), z: 1, a: 2 }),
      { onUnknownField: (pointer, field) => fields.push(`${pointer}#${field}`) }
    )
    expect(fields).toEqual(['#a', '#z'])
    const original = new Error('getter failed')
    const offer = {
      ...initiator,
      get versions(): never {
        throw original
      }
    }
    expect(() => createRpcHello(offer)).toThrow(
      expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: 'read', cause: original })
    )
  })
})
