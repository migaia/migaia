import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { inspect } from 'node:util'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  createRpcHello,
  normalizeRpcHandshake,
  serializeRpcError,
  type IRpcHandshakeOffer
} from '../../src/contract/index.js'

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
  seen.push(JSON.stringify(serializeRpcError(error, { report: () => {} })))
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

describe('handshake redaction', () => {
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
    for (const [change, violation, cause] of [
      [{ peer: 'bad-peer' }, 'type', 'bad-peer'],
      [
        { peer: { id: 'caller', runtime: 'node', implementation: 'bad-implementation' } },
        'type',
        'bad-implementation'
      ],
      [{ versions: ['bad-version'] }, 'type', 'bad-version']
    ] as const) {
      expect(
        invalid(() => normalizeRpcHandshake(JSON.stringify({ ...HELLO, ...change })), violation)
          .cause
      ).toBe(cause)
    }
    expect(
      invalid(
        () => normalizeRpcHandshake(JSON.stringify({ ...HELLO, codecs: ['json', 'json'] })),
        'duplicate'
      ).cause
    ).toEqual(['json', 'json'])
    const invalidReject = JSON.stringify({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { foo: 1 }
    })
    expect(invalid(() => normalizeRpcHandshake(invalidReject), 'type').cause).toMatchObject({
      code: 'INVALID_WIRE_ERROR'
    })
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

  it('A6 bounds and freezes the summary without changing the top-level error', () => {
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
    expect(summary.fields).toHaveLength(16)
    expect(summary.fields).toContain('[redacted]')
    expect(summary).toMatchObject({
      redacted: true,
      kind: 'request',
      protocol: '[redacted]',
      major: '[redacted]',
      auth: '[redacted]'
    })
    for (const omitted of ['versions', 'peer', 'codecs'])
      expect(summary).not.toHaveProperty(omitted)
    expect(serializeRpcError(error, { report: () => {} }).cause?.data).toEqual(summary)
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
