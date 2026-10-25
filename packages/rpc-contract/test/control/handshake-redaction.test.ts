import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  normalizeRpcHandshake,
  serializeRpcWireError,
  type IRpcHello
} from '@migaia/rpc-contract/protocol'
import { redactRpcHandshakeFailure, serializeRpcError } from '@migaia/rpc-contract/errors'
import { hello } from '../fixtures/core-profile.js'
import { TOKEN, leaks } from '../fixtures/handshake-privacy.js'

/** The actual sole-profile object replaces the removed text-producing offer API. */
const OFFER = normalizeRpcHandshake({ ...hello('caller'), auth: TOKEN }) as IRpcHello
/** Independently received ordinary JSON data enters actual metadata admission. */
const HELLO = JSON.parse(JSON.stringify(OFFER)) as Record<string, unknown>
/** Resolve canonical vector data independently of the process working directory. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Capture the original native failure while asserting the new profile's explicit error domain. */
function invalid(run: () => unknown, code = 'HANDSHAKE_INVALID'): Error & { cause?: unknown } {
  /** A thrown undefined cannot accidentally satisfy this native-boundary assertion. */
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(
    code === 'HANDSHAKE_REJECTED' || code === 'HANDSHAKE_INCOMPATIBLE' ? Error : TypeError
  )
  expect(caught).toMatchObject({ source: 'rpc.contract', code })
  return caught as Error & { cause?: unknown }
}

/** Six-unit secrecy remains the assertion; retired diagnostic field layouts grant no exception. */
function redacted(error: unknown, token: string, marker: string): void {
  expect(leaks(error, token), `redaction:${marker}`).toBe(false)
}

/** One adversarial metadata edit passes through the actual decoded hello reader. */
function invalidHello(change: Record<string, unknown>, code = 'HANDSHAKE_INVALID') {
  return invalid(() => normalizeRpcHandshake({ ...HELLO, ...change }), code)
}

/**
 * BC9 no longer reflects record prototypes; the existing public privacy operation keeps this
 * oracle.
 */
function reflected(cause: unknown): unknown {
  return redactRpcHandshakeFailure(cause)
}

/** The actual negotiated accept has disjoint fields rather than an edited old hello wrapper. */
function accepted(change: Record<string, unknown> = {}) {
  return { ...acceptRpcHandshake(OFFER, hello('provider') as IRpcHello), ...change }
}

describe('handshake redaction', () => {
  it('redacts AggregateError errors arrays before any diagnostic projection', () => {
    const aggregate = new AggregateError([new Error(TOKEN)], 'aggregate failure')
    const result = reflected(aggregate)
    expect(result).not.toBe(aggregate)
    expect(result).toMatchObject({ redacted: true, path: '/error' })
    expect(Object.isFrozen(result)).toBe(true)
    expect(inspect(result, { depth: null, showHidden: true })).not.toContain(TOKEN)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('redacts a secret beyond the 16-layer traversal limit', () => {
    let chain: unknown = { secret: TOKEN }
    for (let depth = 0; depth < 17; depth++) chain = new Error('clean', { cause: chain })
    const result = reflected(chain)
    expect(result).not.toBe(chain)
    expect(result).toMatchObject({ redacted: true, path: '/error' })
    expect(inspect(result, { depth: null, showHidden: true })).not.toContain(TOKEN)
  })

  it('retains an identity-safe four-layer Error chain', () => {
    let chain: Error = new Error('leaf')
    for (let depth = 0; depth < 3; depth++) chain = new Error('clean', { cause: chain })
    expect(reflected(chain)).toBe(chain)
    expect(redactRpcHandshakeFailure(chain)).toBe(chain)
  })

  it('redacts responder input in all input forms', () => {
    /** Text and byte execution cases moved to the real SDK codec; these are decoded metadata forms. */
    const malformed = [
      [{ ...HELLO, kind: 'request' }, 'HANDSHAKE_INVALID'],
      [{ ...HELLO, step: 'resume' }, 'HANDSHAKE_INVALID'],
      [{ auth: TOKEN }, 'HANDSHAKE_INVALID'],
      [[TOKEN], 'HANDSHAKE_INVALID'],
      [{ ...HELLO, auth: { $rpc: 'x', v: TOKEN } }, 'HANDSHAKE_INVALID']
    ] as const
    for (const [input, code] of malformed) {
      const error = invalid(() => normalizeRpcHandshake(input), code)
      expect(leaks(error, TOKEN), code).toBe(false)
    }
    const error = invalid(() => acceptRpcHandshake(accepted() as never, OFFER))
    expect(leaks(error, TOKEN)).toBe(false)
  })

  it('redacts initiator replies and describes the normalized message', () => {
    const helloError = invalid(() => completeRpcHandshake(OFFER, HELLO), 'HANDSHAKE_INVALID')
    expect(leaks(helloError, TOKEN)).toBe(false)
    const mismatch = invalid(
      () => completeRpcHandshake(OFFER, accepted({ major: 9, minor: 0 })),
      'HANDSHAKE_INVALID'
    )
    expect(leaks(mismatch, TOKEN)).toBe(false)
    expect(mismatch.cause ?? {}).not.toHaveProperty('auth')
  })

  it('redacts local offers without reading them again', () => {
    const badOffer = { ...OFFER, kind: 'x' }
    for (const run of [
      () => normalizeRpcHandshake(badOffer),
      () => acceptRpcHandshake(badOffer as never, OFFER),
      () => completeRpcHandshake(badOffer as never, accepted())
    ]) {
      const error = invalid(run)
      expect(leaks(error, TOKEN)).toBe(false)
    }
    let reads = 0
    const offer = {
      ...OFFER,
      get auth() {
        reads++
        return TOKEN
      }
    }
    expect(normalizeRpcHandshake(offer)).toBe(offer)
    /** Known auth is read directly; only its portable value is normalized. */
    expect(reads).toBe(1)
  })

  it('preserves clean original errors and non-input causes', () => {
    const original = new Error('getter failed')
    expect(reflected(original)).toBe(original)
    const invalidData = invalid(
      () =>
        normalizeRpcHandshake({
          profile: OFFER.profile,
          kind: 'handshake',
          step: 'reject',
          error: {
            root: 0,
            nodes: [
              {
                source: 'rpc-contract',
                code: 'REJECTED',
                name: 'Error',
                message: 'rejected',
                stack: 'Error: rejected',
                data: { $rpc: 'x', v: TOKEN }
              }
            ]
          }
        }),
      'HANDSHAKE_INVALID'
    )
    expect(invalidData).toMatchObject({
      code: 'HANDSHAKE_INVALID',
      violation: 'type',
      cause: expect.objectContaining({
        code: 'INVALID_WIRE_ERROR',
        violation: 'dataPortable',
        cause: expect.objectContaining({ code: 'INVALID_ENVELOPE' })
      })
    })
    expect(leaks(invalidData, TOKEN)).toBe(false)
    const incompatible = invalid(
      () => acceptRpcHandshake(OFFER, { ...OFFER, versions: [{ major: 3, minor: 0 }] }),
      'HANDSHAKE_INCOMPATIBLE'
    )
    const outcome = invalid(
      () =>
        completeRpcHandshake(OFFER, {
          profile: OFFER.profile,
          kind: 'handshake',
          step: 'reject',
          error: serializeRpcWireError(incompatible, { report: () => undefined })
        }),
      'HANDSHAKE_REJECTED'
    )
    expect(outcome).toMatchObject({
      code: 'HANDSHAKE_REJECTED',
      cause: expect.objectContaining({ code: 'HANDSHAKE_INCOMPATIBLE' })
    })
    invalidHello({ auth: { $rpc: 'x', v: TOKEN } }, 'HANDSHAKE_INVALID')
  })

  it('bounds and freezes the summary without changing the top-level error', () => {
    const error = invalidHello({ kind: 'request' })
    expect(error.message).toBe('rpc handshake is invalid')
    expect(error.stack).toMatch(/^TypeError: rpc handshake is invalid/)
    expect(Object.getOwnPropertyDescriptor(error, 'cause')?.enumerable ?? false).toBe(false)
    expect(leaks(error, TOKEN)).toBe(false)
    const summary = redactRpcHandshakeFailure({ secret: TOKEN })
    expect(Object.isFrozen(summary)).toBe(true)
    const report = vi.fn()
    const wire = serializeRpcError(error, { report })
    expect(wire).toMatchObject({
      source: 'rpc.contract',
      code: 'HANDSHAKE_INVALID',
      message: error.message,
      stack: error.stack
    })
    for (const field of ['cause', 'data', 'errors']) expect(wire).not.toHaveProperty(field)
    expect(report).not.toHaveBeenCalled()
    const empty = invalid(() => normalizeRpcHandshake({}), 'HANDSHAKE_INVALID')
    expect(leaks(empty, TOKEN)).toBe(false)
  })

  it('unknown-kind hides short unknown field names', () => {
    const token = 'toksecret9f8e'
    redacted(invalidHello({ kind: 'request', [token]: 1 }), token, 'unknown-kind')
  })
  it('unknown-step hides short unknown field names', () => {
    const token = 'toksecret9f8e'
    redacted(invalidHello({ step: 'resume', [token]: 1 }), token, 'unknown-step')
  })
  it('kind allows only the reserved handshake kind', () => {
    const token = 'toksecret9f8e'
    redacted(invalidHello({ kind: token }), token, 'kind')
  })
  it('step allows only handshake steps', () => {
    const token = 'toksecret9f8e'
    redacted(invalidHello({ step: token }), token, 'step')
  })
  it('protocol hides unrecognized values across call paths', () => {
    const token = 'toksecret9f8e'
    for (const run of [
      () => normalizeRpcHandshake({ ...HELLO, profile: token }),
      () => completeRpcHandshake(OFFER, { ...HELLO, profile: token }),
      () => completeRpcHandshake(OFFER, accepted({ profile: token })),
      () => acceptRpcHandshake({ ...OFFER, profile: token } as never, OFFER)
    ])
      redacted(invalid(run), token, 'profile')
  })
  it('codec hides an invalid accept label', () => {
    const token = 'toksecret9f8e'
    redacted(
      invalid(() => normalizeRpcHandshake(accepted({ codec: token.toUpperCase() }))),
      token.toUpperCase(),
      'codec'
    )
    redacted(
      invalid(() => completeRpcHandshake(OFFER, accepted({ codec: token })), 'HANDSHAKE_INVALID'),
      token,
      'codec'
    )
  })
  it('codec-complete uses the local offer as its allowed codec set', () => {
    const token = 'toksecret9f8e'
    redacted(
      invalid(() => completeRpcHandshake(OFFER, accepted({ codec: token })), 'HANDSHAKE_INVALID'),
      token,
      'codec-complete'
    )
    redacted(
      invalid(() => acceptRpcHandshake(accepted({ codec: token }) as never, OFFER)),
      token,
      'codec-complete'
    )
    const known = invalid(
      () =>
        completeRpcHandshake(
          { ...OFFER, codecs: ['json', 'cbor'] },
          accepted({ major: 9, minor: 0, codec: 'cbor' })
        ),
      'HANDSHAKE_INVALID'
    )
    expect(leaks(known, TOKEN)).toBe(false)
  })
  it('peer hides scalar, known value and unknown key', () => {
    const token = 'toksecret9f8e'
    for (const [peer, code] of [
      [token, 'HANDSHAKE_INVALID'],
      [{ id: token, runtime: 'BAD', [token]: 1 }, 'HANDSHAKE_INVALID'],
      [{ id: 'caller', runtime: token.toUpperCase() }, 'HANDSHAKE_INVALID'],
      [null, 'HANDSHAKE_INVALID'],
      [5, 'HANDSHAKE_INVALID'],
      [false, 'HANDSHAKE_INVALID']
    ] as const)
      redacted(invalidHello({ peer }, code), token, 'peer')
    redacted(
      invalid(() => completeRpcHandshake(OFFER, accepted({ peer: { id: token, runtime: 'BAD' } }))),
      token,
      'peer'
    )
  })
  it('peer-runtime-version hides unknown keys and values', () => {
    const token = 'toksecret9f8e'
    redacted(
      invalidHello({ peer: { id: 'caller', runtime: 'node', runtimeVersion: 1, [token]: 1 } }),
      token,
      'peer-runtime-version'
    )
  })
  it('implementation hides scalar and nested values', () => {
    const token = 'toksecret9f8e'
    for (const [implementation, code] of [
      [token, 'HANDSHAKE_INVALID'],
      [{ name: 1, version: token, [token]: 1 }, 'HANDSHAKE_INVALID']
    ] as const)
      redacted(
        invalidHello({ peer: { id: 'caller', runtime: 'node', implementation } }, code),
        token,
        'implementation'
      )
  })
  it('versions hides scalar, entry and nested key', () => {
    const token = 'toksecret9f8e'
    for (const versions of [
      token,
      [token],
      [{ major: 0, minor: 0, [token]: 1 }],
      { major: 1, minor: 0, [token]: 1 }
    ])
      redacted(invalidHello({ versions }, 'HANDSHAKE_INVALID'), token, 'versions')
  })
  it('versions-duplicate hides repeated entries', () => {
    const token = 'toksecret9f8e'
    const error = invalidHello({
      versions: [
        { major: 2, minor: 0 },
        { major: 2, minor: 1 }
      ]
    })
    redacted(error, token, 'versions-duplicate')
    expect(error).toMatchObject({ violation: 'duplicate' })
  })
  it('codecs hides scalar, invalid label and missing baseline', () => {
    const token = 'toksecret9f8e'
    for (const [codecs, code] of [
      [token, 'HANDSHAKE_INVALID'],
      [{ [token]: 1 }, 'HANDSHAKE_INVALID'],
      [['json', token.toUpperCase()], 'HANDSHAKE_INVALID'],
      [[token], 'HANDSHAKE_INVALID']
    ] as const)
      redacted(invalidHello({ codecs }, code), token, 'codecs')
  })
  it('codecs-duplicate hides array contents', () => {
    const token = 'toksecret9f8e'
    for (const codecs of [
      ['json', token, token],
      ['json', 'json']
    ]) {
      const error = invalidHello({ codecs })
      redacted(error, token, 'codecs-duplicate')
      expect(error).toMatchObject({ violation: 'duplicate' })
    }
  })
  it('capabilities hides labels in hello and accept', () => {
    const token = 'toksecret9f8e'
    for (const message of [{ ...HELLO, extensions: [token] }, accepted({ extensions: [token] })])
      redacted(
        invalid(() => normalizeRpcHandshake(message)),
        token,
        'extensions'
      )
  })
  it('reject hides invalid wire-error subtrees', () => {
    const token = 'toksecret9f8e'
    for (const wireError of [
      { [token]: 1 },
      { foo: 1 },
      { root: 0, nodes: [{ source: 'rpc-contract', code: 5, message: token }] }
    ]) {
      const error = invalid(
        () =>
          normalizeRpcHandshake({
            profile: OFFER.profile,
            kind: 'handshake',
            step: 'reject',
            error: wireError
          }),
        'HANDSHAKE_INVALID'
      )
      redacted(error, token, 'reject')
    }
  })
  it('verifies current baseline handshake bytes without credentials', () => {
    const directory = resolve(PACKAGE_ROOT, '../rpc-integration/schema/vectors')
    const vector = readFileSync(resolve(directory, 'handshake.json'))
    const sums = readFileSync(resolve(directory, 'SHA256SUMS'), 'utf8')
    expect(sums).toContain(createHash('sha256').update(vector).digest('hex') + '  handshake.json')
    expect(vector.toString('utf8')).not.toContain('"auth"')
  })
})
