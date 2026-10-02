import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  createRpcHello,
  normalizeRpcHandshake,
  serializeRpcError,
  type IRpcHandshakeOffer
} from '../../src/contract/index.js'
import { redactWireFailure } from '../../src/contract/handshake.js'

/** Distinctive synthetic credential used to detect partial disclosures. */
const TOKEN = 'tok_SECRET_9f8e7d6c5b4a'
/** Valid offer shared by the failure cases. */
const OFFER: IRpcHandshakeOffer = {
  versions: [{ major: 1, minor: 1 }],
  codecs: ['json'],
  capabilities: [],
  peer: { id: 'caller', runtime: 'node' },
  auth: TOKEN
}
/** The same hello as an independently received JSON object. */
const HELLO = JSON.parse(createRpcHello(OFFER)) as Record<string, unknown>
/** Resolve the package without relying on the process working directory. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Inspect visible, hidden, wire and cause values for every six-character token fragment. */
function leaks(error: unknown, token: string): boolean {
  const seen: string[] = [inspect(error, { depth: null, showHidden: true })]
  const reported: unknown[] = []
  seen.push(JSON.stringify(serializeRpcError(error, { report: (value) => reported.push(value) })))
  seen.push(inspect(reported, { depth: null, showHidden: true }))
  let cause: unknown = error
  for (let depth = 0; depth < 16 && cause !== null && typeof cause === 'object'; depth++) {
    const current = cause as { cause?: unknown }
    cause = current.cause
    if (typeof cause === 'string') seen.push(cause)
    else if (cause instanceof Uint8Array) seen.push(new TextDecoder().decode(cause))
    else if (cause !== undefined) seen.push(JSON.stringify(cause))
  }
  for (let offset = 0; offset <= token.length - 6; offset++) {
    const fragment = token.slice(offset, offset + 6)
    if (seen.some((value) => value.includes(fragment))) return true
  }
  return false
}

/** Capture the native top-level error and assert its stable public identity. */
function invalid(run: () => unknown, violation: string): TypeError & { cause: unknown } {
  let caught: unknown
  try {
    run()
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(TypeError)
  expect(caught).toMatchObject({ code: 'HANDSHAKE_INVALID', violation })
  return caught as TypeError & { cause: unknown }
}

/** Demand that every error projection omit a chosen adversarial field or value. */
function redacted(error: unknown, token: string, marker: string): void {
  expect(leaks(error, token), `SDD_BASE_RED_CONTRACT:${marker}`).toBe(false)
}

/** Exercise an independently received first message with one adversarial edit. */
function invalidHello(
  change: Record<string, unknown>,
  violation: string
): TypeError & { cause: unknown } {
  return invalid(() => normalizeRpcHandshake(JSON.stringify({ ...HELLO, ...change })), violation)
}

describe('handshake redaction', () => {
  it('[A10] redacts AggregateError errors arrays before any diagnostic projection', () => {
    const aggregate = new AggregateError([new Error(TOKEN)], 'aggregate failure')
    const result = redactWireFailure(aggregate)
    expect(result).not.toBe(aggregate)
    expect(result).toMatchObject({ redacted: true, path: '/error' })
    expect(Object.isFrozen(result)).toBe(true)
    expect(inspect(result, { depth: null, showHidden: true })).not.toContain(TOKEN)
    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  it('[A10] redacts a secret beyond the 16-layer traversal limit', () => {
    let chain: unknown = { secret: TOKEN }
    for (let depth = 0; depth < 17; depth++) chain = new Error('clean', { cause: chain })
    const result = redactWireFailure(chain)
    expect(result).not.toBe(chain)
    expect(result).toMatchObject({ redacted: true, path: '/error' })
    expect(inspect(result, { depth: null, showHidden: true })).not.toContain(TOKEN)
  })

  it('[A5] retains an identity-safe four-layer Error chain', () => {
    let chain: Error = new Error('leaf')
    for (let depth = 0; depth < 3; depth++) chain = new Error('clean', { cause: chain })
    expect(redactWireFailure(chain)).toBe(chain)
  })

  it('A1 redacts responder input in all input forms', () => {
    const malformed = [
      [JSON.stringify({ ...HELLO, kind: 'request' }), 'required'],
      [JSON.stringify({ ...HELLO, step: 'resume' }), 'step'],
      [JSON.stringify({ auth: TOKEN, ...HELLO, pad: ' '.repeat(70000) }), 'bytes'],
      [
        new TextEncoder().encode(JSON.stringify({ auth: TOKEN, ...HELLO, pad: ' '.repeat(70000) })),
        'bytes'
      ],
      [JSON.stringify(HELLO) + '\uD800', 'encoding'],
      [JSON.stringify([TOKEN]), 'type'],
      [{ auth: TOKEN }, 'type'],
      [JSON.stringify({ ...HELLO, step: 'accept', major: 0 }), 'type'],
      [JSON.stringify({ ...HELLO, auth: { $rpc: 'x', v: TOKEN } }), 'type']
    ] as const
    for (const [input, violation] of malformed) {
      const error = invalid(() => normalizeRpcHandshake(input as string), violation)
      expect(leaks(error, TOKEN), violation).toBe(false)
    }
    const reply = JSON.stringify({ ...HELLO, step: 'accept', major: 1, minor: 1, codec: 'json' })
    const error = invalid(() => acceptRpcHandshake({ ...OFFER, auth: undefined }, reply), 'step')
    expect(leaks(error, TOKEN)).toBe(false)
    expect(
      invalid(() => normalizeRpcHandshake(JSON.stringify([TOKEN])), 'type').cause
    ).toMatchObject({
      redacted: true,
      form: 'text',
      parsed: true
    })
    expect(invalid(() => normalizeRpcHandshake({ auth: TOKEN } as never), 'type').cause).toEqual({
      redacted: true,
      form: 'other',
      parsed: false
    })
  })

  it('A2 redacts initiator replies and describes the normalized message', () => {
    const helloError = invalid(() => completeRpcHandshake(OFFER, JSON.stringify(HELLO)), 'step')
    expect(leaks(helloError, TOKEN)).toBe(false)
    expect(helloError.cause).toMatchObject({ step: 'hello', auth: '[redacted]' })
    const reply = JSON.stringify({ ...HELLO, step: 'accept', major: 9, minor: 0, codec: 'json' })
    const mismatch = invalid(() => completeRpcHandshake(OFFER, reply), 'mismatch')
    expect(leaks(mismatch, TOKEN)).toBe(false)
    expect(mismatch.cause).toMatchObject({ step: 'accept', major: 9 })
    expect(mismatch.cause).not.toHaveProperty('auth')
  })

  it('A3 redacts local offers without reading them again', () => {
    const badOffer = { ...OFFER, kind: 'x' }
    for (const run of [
      () => createRpcHello(badOffer as never),
      () => acceptRpcHandshake(badOffer as never, JSON.stringify(HELLO)),
      () => completeRpcHandshake(badOffer as never, JSON.stringify(HELLO))
    ]) {
      const error = invalid(run, 'required')
      expect(leaks(error, TOKEN)).toBe(false)
    }
    let reads = 0
    const offer = {
      ...OFFER,
      get auth() {
        reads++
        return TOKEN
      },
      toJSON: () => undefined
    }
    const error = invalid(() => createRpcHello(offer), 'type')
    expect(error.cause).toEqual({ redacted: true, form: 'offer', parsed: false })
    expect(leaks(error, TOKEN)).toBe(false)
    expect(reads).toBe(1)
  })

  it('A4 withholds engine excerpts for malformed JSON text and bytes', () => {
    const invalidJson = `{"kind":"handshake","auth":${TOKEN}}`
    for (const input of [invalidJson, new TextEncoder().encode(invalidJson)]) {
      const error = invalid(() => normalizeRpcHandshake(input), 'type')
      expect(leaks(error, TOKEN)).toBe(false)
      expect(error.cause).not.toBeInstanceOf(SyntaxError)
      expect(error.cause).toMatchObject({ redacted: true, syntaxError: '[redacted]' })
    }
    const quoted = `{"kind":"handshake","auth":["${TOKEN}",]}`
    expect(
      leaks(
        invalid(() => normalizeRpcHandshake(quoted), 'type'),
        TOKEN
      )
    ).toBe(false)
  })

  it('A5 preserves clean original errors and non-input causes', () => {
    expect(invalid(() => normalizeRpcHandshake('{'), 'type').cause).toBeInstanceOf(SyntaxError)
    const quoted = `{"kind":"handshake","auth":"${TOKEN}",}`
    const clean = invalid(() => normalizeRpcHandshake(quoted), 'type')
    expect(clean.cause).toBeInstanceOf(SyntaxError)
    expect(leaks(clean, TOKEN)).toBe(false)
    expect(
      invalid(() => normalizeRpcHandshake(new Uint8Array([0xff])), 'encoding').cause
    ).toBeInstanceOf(TypeError)
    const original = new Error('getter failed')
    const hostile = {
      ...OFFER,
      get peer(): never {
        throw original
      }
    }
    expect(invalid(() => createRpcHello(hostile), 'read').cause).toBe(original)
    const invalidRejectData = JSON.stringify({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: {
        source: 'rpc-contract',
        code: 'REJECTED',
        name: 'Error',
        message: 'rejected',
        stack: 'Error: rejected',
        data: { $rpc: 'x', v: TOKEN }
      }
    })
    const invalidData = invalid(() => normalizeRpcHandshake(invalidRejectData), 'type')
    expect(invalidData.cause).toMatchObject({
      code: 'INVALID_WIRE_ERROR',
      violation: 'dataPortable',
      cause: expect.objectContaining({ code: 'INVALID_ENVELOPE' })
    })
    expect(leaks(invalidData, TOKEN)).toBe(false)
    const rejected = acceptRpcHandshake(
      { ...OFFER, versions: [{ major: 2, minor: 0 }] },
      createRpcHello(OFFER)
    )
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      let outcome: unknown
      try {
        completeRpcHandshake(OFFER, rejected.reply)
      } catch (error) {
        outcome = error
      }
      expect(outcome).toMatchObject({
        code: 'HANDSHAKE_REJECTED',
        cause: expect.objectContaining({ code: 'HANDSHAKE_INCOMPATIBLE' })
      })
    }
    expect(
      invalid(
        () => normalizeRpcHandshake(JSON.stringify({ ...HELLO, auth: { $rpc: 'x', v: TOKEN } })),
        'type'
      ).cause
    ).toMatchObject({ code: 'INVALID_ENVELOPE' })
  })

  it('A4/A5 retains a clean engine instance and withholds a four-unit excerpt', () => {
    const clean = new SyntaxError('clean engine failure')
    const cleanParse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw clean
    })
    try {
      expect(invalid(() => normalizeRpcHandshake('{"x":123}'), 'type').cause).toBe(clean)
    } finally {
      cleanParse.mockRestore()
    }

    const excerpt = new SyntaxError('unexpected z9Qv token')
    const excerptParse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
      throw excerpt
    })
    try {
      const error = invalid(() => normalizeRpcHandshake('{"x":z9Qv}'), 'type')
      expect(error.cause).not.toBe(excerpt)
      expect(error.cause).toMatchObject({
        redacted: true,
        form: 'text',
        parsed: false,
        syntaxError: '[redacted]'
      })
    } finally {
      excerptParse.mockRestore()
    }
  })

  it('[A6] bounds and freezes the summary without changing the top-level error', () => {
    const unknown = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`z${index}`, index])
    )
    const error = invalid(
      () =>
        normalizeRpcHandshake(
          JSON.stringify({
            ...HELLO,
            ...unknown,
            kind: 'request',
            protocol: 'x'.repeat(65),
            major: 1.5,
            ['a'.repeat(65)]: 'x'
          })
        ),
      'required'
    )
    expect(error.message).toBe('rpc handshake is invalid')
    expect(error.stack).toMatch(/^TypeError: rpc handshake is invalid/)
    expect(Object.getOwnPropertyDescriptor(error, 'cause')?.enumerable).toBe(false)
    expect(leaks(error, TOKEN)).toBe(false)
    const summary = error.cause as Record<string, unknown>
    expect(Object.isFrozen(summary)).toBe(true)
    expect(Object.isFrozen(summary.fields)).toBe(true)
    expect(summary.fields, 'SDD_BASE_RED_CONTRACT:A6').toEqual([
      'auth',
      'capabilities',
      'codecs',
      'kind',
      'major',
      'peer',
      'protocol',
      'step',
      'versions'
    ])
    expect(summary).toMatchObject({
      redacted: true,
      kind: '[redacted]',
      protocol: '[redacted]',
      major: '[redacted]',
      auth: '[redacted]',
      unknownFieldCount: 21
    })
    for (const omitted of ['versions', 'peer', 'codecs'])
      expect(summary).not.toHaveProperty(omitted)
    const report = vi.fn()
    /** K232 keeps even the redacted diagnostic local to the controlled Contract factory. */
    const wire = serializeRpcError(error, { report })
    expect(wire).toMatchObject({
      source: '@migaia/rpc/contract',
      code: 'HANDSHAKE_INVALID',
      message: error.message,
      stack: error.stack
    })
    for (const field of ['cause', 'data', 'errors']) expect(wire).not.toHaveProperty(field)
    expect(error.cause).toBe(summary)
    expect(report).not.toHaveBeenCalled()
    const empty = invalid(() => normalizeRpcHandshake('{}'), 'required')
    expect(empty.cause).toMatchObject({ fields: [], parsed: true })
    expect(empty.cause).not.toHaveProperty('kind')
    expect(empty.cause).not.toHaveProperty('step')
    expect(empty.cause).not.toHaveProperty('protocol')
  })

  it('[A9] unknown-kind hides short unknown field names', () => {
    const token = 'toksecret9f8e'
    const error = invalidHello({ kind: 'request', [token]: 1 }, 'required')
    redacted(error, token, 'A9:unknown-kind')
    expect(error.cause).toMatchObject({ unknownFieldCount: 1 })
  })

  it('[A9] unknown-step hides short unknown field names', () => {
    const token = 'toksecret9f8e'
    const error = invalidHello({ step: 'resume', [token]: 1 }, 'step')
    redacted(error, token, 'A9:unknown-step')
    expect(error.cause).toMatchObject({ unknownFieldCount: 1 })
  })

  it('[A9] kind allows only the reserved handshake kind', () => {
    const token = 'toksecret9f8e'
    const error = invalidHello({ kind: token }, 'required')
    redacted(error, token, 'A9:kind')
    expect(error.cause).toMatchObject({ kind: '[redacted]' })
  })

  it('[A9] step allows only handshake steps', () => {
    const token = 'toksecret9f8e'
    const error = invalidHello({ step: token }, 'step')
    redacted(error, token, 'A9:step')
    expect(error.cause).toMatchObject({ step: '[redacted]' })
  })

  it('[A9] protocol hides unrecognized values across call paths', () => {
    const token = 'toksecret9f8e'
    for (const [run, violation] of [
      [
        () => normalizeRpcHandshake(JSON.stringify({ ...HELLO, kind: 'request', protocol: token })),
        'required'
      ],
      [() => completeRpcHandshake(OFFER, JSON.stringify({ ...HELLO, protocol: token })), 'step'],
      [
        () =>
          completeRpcHandshake(
            OFFER,
            JSON.stringify({
              ...HELLO,
              step: 'accept',
              major: 1,
              minor: 1,
              codec: 'json',
              protocol: token
            })
          ),
        'mismatch'
      ],
      [
        () =>
          acceptRpcHandshake(
            OFFER,
            JSON.stringify({
              ...HELLO,
              step: 'accept',
              major: 1,
              minor: 1,
              codec: 'json',
              protocol: token
            })
          ),
        'step'
      ]
    ] as const) {
      const error = invalid(run, violation)
      redacted(error, token, 'A9:protocol')
      expect(error.cause).toMatchObject({ protocol: '[redacted]' })
    }
  })

  it('[A9] codec hides an invalid accept label', () => {
    const token = 'toksecret9f8e'
    const error = invalidHello(
      { step: 'accept', major: 0, minor: 0, codec: token.toUpperCase() },
      'type'
    )
    redacted(error, token.toUpperCase(), 'A9:codec')
    expect(error.cause).toMatchObject({ codec: '[redacted]' })
    const permittedShape = invalidHello(
      { step: 'accept', major: 0, minor: 0, codec: token },
      'type'
    )
    redacted(permittedShape, token, 'A9:codec')
    expect(permittedShape.cause).toMatchObject({ codec: '[redacted]' })
  })

  it('[A9] codec-complete uses the local offer as its allowed codec set', () => {
    const token = 'toksecret9f8e'
    const accept = JSON.stringify({ ...HELLO, step: 'accept', major: 1, minor: 1, codec: token })
    for (const [run, violation] of [
      [() => completeRpcHandshake(OFFER, accept), 'mismatch'],
      [() => acceptRpcHandshake(OFFER, accept), 'step']
    ] as const) {
      const error = invalid(run, violation)
      redacted(error, token, 'A9:codec-complete')
      expect(error.cause).toMatchObject({ codec: '[redacted]' })
    }
    const known = invalid(
      () =>
        completeRpcHandshake(
          { ...OFFER, codecs: ['json', 'cbor'] },
          JSON.stringify({ ...HELLO, step: 'accept', major: 2, minor: 0, codec: 'cbor' })
        ),
      'mismatch'
    )
    expect(known.cause).toMatchObject({
      codec: 'cbor',
      kind: 'handshake',
      step: 'accept',
      protocol: 'migaia.rpc'
    })
  })

  it('[A10] peer hides scalar, known value and unknown key', () => {
    const token = 'toksecret9f8e'
    for (const [peer, violation] of [
      [token, 'type'],
      [{ id: token, runtime: 'BAD', [token]: 1 }, 'required'],
      [{ id: 'caller', runtime: token.toUpperCase() }, 'required']
    ] as const) {
      const error = invalidHello({ peer }, violation)
      redacted(error, token, 'A10:peer')
      expect(error.cause).toMatchObject({ path: '/peer' })
    }
    for (const [peer, valueType] of [
      [null, 'null'],
      [5, 'number'],
      [false, 'boolean']
    ] as const) {
      const error = invalidHello({ peer }, 'type')
      expect(error.cause).toMatchObject({ path: '/peer', valueType })
    }
    const acceptPeer = invalid(
      () =>
        completeRpcHandshake(
          OFFER,
          JSON.stringify({
            ...HELLO,
            step: 'accept',
            major: 1,
            minor: 1,
            codec: 'json',
            peer: { id: token, runtime: 'BAD' }
          })
        ),
      'required'
    )
    redacted(acceptPeer, token, 'A10:peer')
    expect(acceptPeer.cause).toMatchObject({ path: '/peer' })
  })

  it('[A10] peer-runtime-version hides unknown keys and values', () => {
    const token = 'toksecret9f8e'
    const error = invalidHello(
      { peer: { id: 'caller', runtime: 'node', runtimeVersion: 1, [token]: 1 } },
      'type'
    )
    redacted(error, token, 'A10:peer-runtime-version')
    expect(error.cause).toMatchObject({ path: '/peer', unknownFieldCount: 1 })
  })

  it('[A10] implementation hides scalar and nested values', () => {
    const token = 'toksecret9f8e'
    for (const [implementation, violation] of [
      [token, 'type'],
      [{ name: 1, version: token, [token]: 1 }, 'required']
    ] as const) {
      const error = invalidHello(
        { peer: { id: 'caller', runtime: 'node', implementation } },
        violation
      )
      redacted(error, token, 'A10:implementation')
      expect(error.cause).toMatchObject({ path: '/peer/implementation' })
    }
  })

  it('[A10] versions hides scalar, entry and nested key', () => {
    const token = 'toksecret9f8e'
    for (const versions of [
      token,
      [token],
      [{ major: 0, minor: 0, [token]: 1 }],
      { major: 1, minor: 0, [token]: 1 }
    ]) {
      const error = invalidHello({ versions }, 'type')
      redacted(error, token, 'A10:versions')
      expect(error.cause).toMatchObject({ path: '/versions' })
    }
  })

  it('[A10] versions-duplicate hides repeated entries', () => {
    const token = 'toksecret9f8e'
    const error = invalidHello(
      {
        versions: [
          { major: 1, minor: 0 },
          { major: 1, minor: 1, [token]: 1 }
        ]
      },
      'duplicate'
    )
    redacted(error, token, 'A10:versions-duplicate')
    expect(error.cause).toMatchObject({ path: '/versions', length: 2 })
  })

  it('[A10] codecs hides scalar, invalid label and missing baseline', () => {
    const token = 'toksecret9f8e'
    for (const [codecs, violation] of [
      [token, 'type'],
      [{ [token]: 1 }, 'type'],
      [['json', token.toUpperCase()], 'type'],
      [[token], 'baseline']
    ] as const) {
      const error = invalidHello({ codecs }, violation)
      redacted(error, token, 'A10:codecs')
      expect(error.cause).toMatchObject({ path: '/codecs' })
    }
  })

  it('[A10] codecs-duplicate hides array contents', () => {
    const token = 'toksecret9f8e'
    for (const codecs of [
      ['json', token, token],
      ['json', 'json']
    ]) {
      const error = invalidHello({ codecs }, 'duplicate')
      redacted(error, token, 'A10:codecs-duplicate')
      expect(error.cause).toMatchObject({ redacted: true, path: '/codecs', length: codecs.length })
    }
  })

  it('[A10] capabilities hides labels in hello and accept', () => {
    const token = 'toksecret9f8e'
    for (const message of [
      { ...HELLO, capabilities: [token] },
      { ...HELLO, step: 'accept', major: 1, minor: 1, codec: 'json', capabilities: [token] }
    ]) {
      const error = invalid(() => normalizeRpcHandshake(JSON.stringify(message)), 'type')
      redacted(error, token, 'A10:capabilities')
      expect(error.cause).toMatchObject({ path: '/capabilities' })
    }
  })

  it('[A10] reject hides invalid wire-error subtrees', () => {
    const token = 'toksecret9f8e'
    for (const wireError of [
      { [token]: 1 },
      { foo: 1 },
      { source: 'rpc-contract', code: 5, message: token }
    ]) {
      const error = invalidHello({ step: 'reject', error: wireError }, 'type')
      redacted(error, token, 'A10:reject')
      expect(error.cause).toMatchObject({ path: '/error', wireCode: 'INVALID_WIRE_ERROR' })
    }
  })

  it('A7 preserves the frozen 1.0 handshake vector bytes', () => {
    const directory = resolve(PACKAGE_ROOT, 'schema/vectors/frozen/1.0')
    const vector = readFileSync(resolve(directory, 'handshake.json'))
    const sums = readFileSync(resolve(directory, 'SHA256SUMS'), 'utf8')
    expect(sums).toContain(createHash('sha256').update(vector).digest('hex') + '  handshake.json')
    expect(vector.toString('utf8')).not.toContain('"auth"')
  })

  it('A8 keeps handshake modules outside the root retained graph', () => {
    const run = spawnSync('node', ['test/core/tree-shaking-baseline.mjs'], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8'
    })
    expect(run.status, run.stderr).toBe(0)
    const measurement = JSON.parse(run.stdout) as { modules: string[] }
    expect(
      measurement.modules.some((path) =>
        /\/packages\/rpc\/src\/contract\/handshake(?:-text)?\.ts$/u.test(path)
      )
    ).toBe(false)
  })
})
