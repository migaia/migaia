/** Retain original handshake text privacy assertions at the actual executing JSON codec. */
import { inspect } from 'node:util'
import { RpcJsonCarrierCodec, RpcUtf8 } from '@migaia/rpc-host/sdk'
import type { IRpcCodecContext } from '@migaia/rpc-contract/interfaces'
import { expect, it, vi } from 'vitest'
import { TOKEN, leaks } from '../../../rpc-contract/test/fixtures/handshake-privacy.js'

/** Only the real codec's borrowed physical budget participates in these parse-only failures. */
const context: IRpcCodecContext = { codec: 'json', nativeBinary: false, maxFrameBytes: 65536 }

/** Capture the actual decoder error without reconstructing its native cause or parse operation. */
function decodeFailure(text: string): Error & { cause?: unknown } {
  /** Each real installation owns its original serialize JSON parser. */
  const codec = new RpcJsonCarrierCodec()
  /** Failure must come from the real codec operation, not a test normalizer of the same text. */
  let failure: unknown
  try {
    codec.decode({ kind: 'message', data: text }, context)
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(TypeError)
  expect(failure).toMatchObject({ source: 'rpc.contract', code: 'HANDSHAKE_INVALID' })
  return failure as Error & { cause?: unknown }
}

it('withholds engine excerpts for malformed JSON text and bytes', () => {
  /** Native UTF-8 decoding is covered by the separately migrated original fatal UTF-8 oracle. */
  const invalidJson = `{"kind":"handshake","auth":${TOKEN}}`
  for (const input of [invalidJson, new RpcUtf8().decode(new TextEncoder().encode(invalidJson))]) {
    const error = decodeFailure(input)
    expect(leaks(error, TOKEN)).toBe(false)
    expect(error.cause).not.toBeInstanceOf(SyntaxError)
    expect(Object.isFrozen(error.cause)).toBe(true)
  }
  const quoted = `{"kind":"handshake","auth":["${TOKEN}",]}`
  expect(leaks(decodeFailure(quoted), TOKEN)).toBe(false)
})

it('preserves clean original errors and non-input causes at the actual text codec', () => {
  expect(decodeFailure('{').cause).toBeInstanceOf(SyntaxError)
  const quoted = `{"kind":"handshake","auth":"${TOKEN}",}`
  const clean = decodeFailure(quoted)
  expect(clean.cause).toBeInstanceOf(SyntaxError)
  expect(leaks(clean, TOKEN)).toBe(false)
})

it('retains a clean engine instance and withholds a four-unit excerpt', () => {
  const clean = new SyntaxError('clean engine failure')
  const cleanParse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
    throw clean
  })
  try {
    expect(decodeFailure('{"x":123}').cause).toBe(clean)
  } finally {
    cleanParse.mockRestore()
  }
  const excerpt = new SyntaxError('unexpected z9Qv token')
  const excerptParse = vi.spyOn(JSON, 'parse').mockImplementationOnce(() => {
    throw excerpt
  })
  try {
    const error = decodeFailure('{"x":z9Qv}')
    expect(error.cause).not.toBe(excerpt)
    expect(Object.isFrozen(error.cause)).toBe(true)
    expect(inspect(error, { depth: null, showHidden: true })).not.toContain('z9Qv')
  } finally {
    excerptParse.mockRestore()
  }
})
