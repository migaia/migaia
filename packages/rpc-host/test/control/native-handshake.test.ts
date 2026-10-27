/** Original handshake business reaches current records and the sole executing SDK text codec. */
import { assert, expect, it } from 'vitest'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  normalizeRpcHandshake,
  serializeRpcWireError
} from '@migaia/rpc-contract/protocol'
import type { IRpcCodecContext } from '@migaia/rpc-contract/interfaces'
import { RpcJsonCarrierCodec, RpcUtf8 } from '@migaia/rpc-host/sdk'
import { hello } from '../../../rpc-contract/test/fixtures/core-profile.js'

/** Sole-profile input retains the original initiator's codec and optional-extension preferences. */
const initiator = normalizeRpcHandshake({
  ...hello('caller', ['abort@1', 'trace@1', 'x@1']),
  codecs: ['cbor', 'json'],
  peer: { id: 'caller', runtime: 'zig' }
})
assert(initiator.step === 'hello')
/** The independent responder offers the opposite codec order and the original overlap. */
const responder = normalizeRpcHandshake({
  ...hello('provider', ['trace@1', 'abort@1']),
  codecs: ['json', 'cbor'],
  peer: { id: 'provider', runtime: 'node' }
})
assert(responder.step === 'hello')
/** The original encoded-handshake ceiling is supplied at the genuine media boundary. */
const codecContext: IRpcCodecContext = {
  codec: 'json',
  nativeBinary: false,
  maxFrameBytes: 65_536
}

/** Decode each input once and restore exactly that prepared value once, without a fixture parser. */
async function decodeHandshake(value: string | Uint8Array) {
  /** Actual byte media owns fatal UTF-8 decoding; string media already supplies its text. */
  const text = typeof value === 'string' ? value : new RpcUtf8().decode(value)
  /** Each independent input uses the real public JSON codec and its original restore operation. */
  const codec = new RpcJsonCarrierCodec()
  /** This is the only JSON decode for this input; observations never parse its output again. */
  const prepared = codec.decode({ kind: 'message', data: text }, codecContext)
  return codec.restore(prepared, codecContext)
}

// Codec/extension priority and both peer views survive sole2.0.
it('keeps initiator codec priority, shared extensions and both admitted peers', () => {
  /** The responder sees the actual admitted remote hello rather than an old agreement facade. */
  const received = normalizeRpcHandshake(initiator)
  assert(received.step === 'hello')
  /** Canonical negotiation returns the receiving peer's real accept record. */
  const answer = acceptRpcHandshake(received, responder)
  expect(answer.step).toBe('accept')
  expect({ selected: answer, received: received.peer }).toMatchObject({
    selected: { major: 2, minor: 0, codec: 'cbor', extensions: ['abort@1', 'trace@1'] },
    received: { runtime: 'zig' }
  })
  expect(completeRpcHandshake(initiator, answer)).toMatchObject({
    major: 2,
    minor: 0,
    codec: 'cbor',
    peer: { id: 'provider' }
  })
})

// Only lower-v1 negotiation retires; peer facts/auth/JSON remain.
it('keeps optional peer details and portable auth in the actual admitted hello', () => {
  /** The original caller facts are carried by a genuine current-profile record. */
  const caller = normalizeRpcHandshake({
    ...initiator,
    codecs: ['json'],
    auth: { token: 'opaque' },
    peer: {
      id: 'caller',
      runtime: 'zig',
      runtimeVersion: '0.14',
      implementation: { name: 'client', version: '1' }
    }
  })
  assert(caller.step === 'hello')
  /** The sole supported major replaces only the removed lower-v1 negotiation dimension. */
  const answer = acceptRpcHandshake(caller, responder)
  expect(answer.step).toBe('accept')
  expect({ selected: answer, received: caller }).toMatchObject({
    selected: { major: 2, minor: 0, codec: 'json' },
    received: {
      auth: { token: 'opaque' },
      peer: { runtimeVersion: '0.14', implementation: { name: 'client', version: '1' } }
    }
  })
  expect(completeRpcHandshake(caller, answer)).toMatchObject({ major: 2, minor: 0 })
})

// Preserve all9 malformed business inputs and the actual JSON error.
it('rejects malformed first-message fields at the genuine handshake boundary', async () => {
  /** Original malformed domains remain unchanged apart from the current extension field name. */
  const malformed: readonly [unknown, string][] = [
    [{ ...initiator, kind: 'request' }, 'required'],
    [{ ...initiator, step: 'resume' }, 'step'],
    [{ ...initiator, peer: { id: '', runtime: 'zig' } }, 'required'],
    [
      { ...initiator, peer: { id: 'caller', runtime: 'zig', runtimeVersion: 'x'.repeat(65) } },
      'type'
    ],
    [
      { ...initiator, peer: { id: 'caller', runtime: 'zig', implementation: { name: 'client' } } },
      'required'
    ],
    [{ ...initiator, versions: [] }, 'type'],
    [{ ...initiator, versions: [{ major: 0, minor: 0 }] }, 'type'],
    [{ ...initiator, codecs: ['json', 'json'] }, 'duplicate'],
    [{ ...initiator, extensions: ['abort@1', 'abort@1'] }, 'duplicate'],
    // Confirmed missing/wrong-shape branches must not hide behind generic envelope errors.
    [{ ...initiator, peer: undefined }, 'required'],
    [{ ...initiator, peer: null }, 'type']
  ]
  for (const [message, violation] of malformed)
    expect
      .soft(() => normalizeRpcHandshake(message))
      .toThrow(expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation }))
  await expect.soft(decodeHandshake('{')).rejects.toMatchObject({
    code: 'HANDSHAKE_INVALID',
    violation: 'type'
  })
})

// Old ok/reply DTO retires, actual error/coded reject/cause do not.
it('keeps negotiation failure and the original remote error cause on completion', () => {
  /** This actual unsupported offer causes the real canonical negotiator to reject. */
  let incompatible: unknown
  try {
    acceptRpcHandshake(initiator, { ...responder, versions: [{ major: 3, minor: 0 }] })
  } catch (error) {
    incompatible = error
  }
  expect(incompatible).toBeInstanceOf(Error)
  assert(incompatible instanceof Error)
  expect.soft(incompatible).toMatchObject({ code: 'HANDSHAKE_INCOMPATIBLE', reason: 'version' })
  /** Raw current reject input borrows the actual failure through the sole canonical serializer. */
  const reject = {
    profile: initiator.profile,
    kind: 'handshake',
    step: 'reject',
    error: serializeRpcWireError(incompatible, {
      report: (failure) => {
        throw failure.error
      }
    })
  }
  expect(normalizeRpcHandshake(reject)).toMatchObject({ step: 'reject' })
  expect(() => completeRpcHandshake(initiator, reject)).toThrow(
    expect.objectContaining({
      code: 'HANDSHAKE_REJECTED',
      cause: expect.objectContaining({ code: 'HANDSHAKE_INCOMPATIBLE' })
    })
  )
})

// No fixture size guard repairs a missing actual media boundary.
it('keeps JSON baseline, duplicate versions, byte budgets and encoding rejection', async () => {
  expect
    .soft(() => normalizeRpcHandshake({ ...initiator, codecs: ['cbor'] }))
    .toThrow(expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: 'baseline' }))
  expect
    .soft(() =>
      normalizeRpcHandshake({
        ...initiator,
        versions: [
          { major: 2, minor: 0 },
          { major: 2, minor: 1 }
        ]
      })
    )
    .toThrow(expect.objectContaining({ violation: 'duplicate' }))
  await expect.soft(decodeHandshake(' '.repeat(65_537))).rejects.toMatchObject({
    violation: 'bytes'
  })
  await expect.soft(decodeHandshake('\uD800')).rejects.toMatchObject({ violation: 'encoding' })
  await expect.soft(decodeHandshake(new Uint8Array(65_537))).rejects.toMatchObject({
    code: 'HANDSHAKE_INVALID',
    violation: 'bytes'
  })
  await expect.soft(decodeHandshake(new Uint8Array([0xff]))).rejects.toMatchObject({
    code: 'HANDSHAKE_INVALID',
    violation: 'encoding'
  })
  expect
    .soft(() => normalizeRpcHandshake({ ...initiator, auth: { $rpc: 'bytes', base64url: '!' } }))
    .toThrow(expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: 'type' }))
})

// Actual current accept records retain mismatch and wire-cause oracles.
it('rejects accepts outside the offer and retains invalid remote error diagnostics', () => {
  /** Only the canonical negotiator supplies the unmodified valid response. */
  const valid = acceptRpcHandshake(initiator, responder)
  for (const change of [
    { major: 3 },
    { minor: 4 },
    { codec: 'msgpack' },
    { extensions: ['close@1'] },
    { profile: 'foreign.rpc' }
  ])
    expect
      .soft(() => completeRpcHandshake(initiator, { ...valid, ...change }))
      .toThrow(expect.objectContaining({ code: 'HANDSHAKE_INVALID', violation: 'mismatch' }))
  /** Flat nodes replace only the old tree grammar; the original malformed node stays malformed. */
  const invalidReject = {
    profile: initiator.profile,
    kind: 'handshake',
    step: 'reject',
    error: { root: 0, nodes: [{ foo: 1 }] }
  }
  expect
    .soft(() => normalizeRpcHandshake(invalidReject))
    .toThrow(
      expect.objectContaining({
        code: 'HANDSHAKE_INVALID',
        cause: expect.objectContaining({
          code: 'INVALID_WIRE_ERROR',
          violation: 'required',
          pointer: '/nodes/0/source'
        })
      })
    )
})

// Unknown-field scan/order is NoPASS; known-field reads remain.
it('ignores additive hello fields and preserves a hostile known-field getter cause', () => {
  /** Unknown metadata cannot change the actual negotiated known-field result. */
  const additive = normalizeRpcHandshake({ ...initiator, z: 1, a: 2 })
  assert(additive.step === 'hello')
  expect(acceptRpcHandshake(additive, responder)).toEqual(acceptRpcHandshake(initiator, responder))
  /** The original native getter exception must remain exactly reachable after classification. */
  const original = new Error('getter failed')
  /** Only the originally known versions field is hostile; no unknown-property scan is involved. */
  const offer = {
    ...initiator,
    get versions(): never {
      throw original
    }
  }
  /** Capture the one actual admission failure without parsing or reconstructing its cause. */
  let failure: unknown
  try {
    normalizeRpcHandshake(offer)
  } catch (error) {
    failure = error
  }
  expect.soft(failure).toMatchObject({
    code: 'HANDSHAKE_INVALID',
    violation: 'read',
    cause: original
  })
  expect.soft((failure as { readonly cause?: unknown } | undefined)?.cause).toBe(original)
})
