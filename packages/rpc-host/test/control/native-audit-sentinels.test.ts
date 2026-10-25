/** Historical sentinel values reach current pure handshake admission and the actual text codec. */
import { inspect } from 'node:util'
import { assert, describe, expect, it } from 'vitest'
import {
  normalizeRpcHandshake,
  acceptRpcHandshake,
  completeRpcHandshake,
  serializeRpcError
} from '@migaia/rpc-contract'
import type { IRpcCodecContext } from '@migaia/rpc-contract/interfaces'
import { RpcJsonCarrierCodec, RpcUtf8 } from '@migaia/rpc-host/sdk'
import { hello } from '../../../rpc-contract/test/fixtures/core-profile.js'

/** Original synthetic credential, including its original case variants, remains unchanged. */
const T = 'toksecret9f8e'
/** Current protocol declarations replace only the removed v1 hello builder and bootstrap DTO. */
const OFFER = normalizeRpcHandshake(hello('a'))
assert(OFFER.step === 'hello')
/** The original extra supported codec remains a real negotiation proposal. */
const OFFER2 = { ...OFFER, codecs: ['json', 'cbor'] }
/** The actual Contract negotiation supplies the receiving peer's valid selected reply. */
const OTHER = normalizeRpcHandshake(hello('b'))
assert(OTHER.step === 'hello')
/** Invalid fields below modify this real current accept rather than a compatibility DTO. */
const ACC = acceptRpcHandshake(OFFER, OTHER)
/** Original error scalar fixture remains unchanged inside the current flat graph representation. */
const W = {
  source: '@migaia/rpc',
  code: 'HANDSHAKE_INCOMPATIBLE',
  name: 'Error',
  message: 'm',
  stack: 'Error: m'
}
/** The actual codec borrows only its normal JSON storage and physical frame budget. */
const codecContext: IRpcCodecContext = {
  codec: 'json',
  nativeBinary: false,
  maxFrameBytes: 65536
}

/** Preserve every original six-character fragment predicate across all three public projections. */
function assertPrivate(error: unknown): void {
  /** Reports remain observable beside both the hidden local Error and its real wire serializer. */
  const reports: unknown[] = []
  /** Each original projection independently detects partial credential disclosure. */
  const projections = [
    inspect(error, { depth: null, showHidden: true }),
    JSON.stringify(serializeRpcError(error, { report: (value) => reports.push(value) })),
    inspect(reports, { depth: null, showHidden: true })
  ]
  for (const token of ['toksecret9f8e', 'TOKSECRET9F8E']) {
    for (let offset = 0; offset <= token.length - 6; offset++) {
      /** Six-character fragments detect the same original partial disclosure window. */
      const fragment = token.slice(offset, offset + 6)
      for (const projection of projections) expect(projection.includes(fragment)).toBe(false)
    }
  }
}

/** A short case callback invokes only the public record admission that now owns these fields. */
function normalization(value: unknown): () => unknown {
  return () => normalizeRpcHandshake(value)
}

/** Use the genuine codec's one decode/restore chain, including its native UTF-8 byte entry. */
async function decodeHandshake(value: string | Uint8Array): Promise<unknown> {
  /** Each input owns one codec; the test never parses or restores an observed frame again. */
  const codec = new RpcJsonCarrierCodec()
  /** Byte input uses the same public UTF-8 owner as actual SDK byte transports. */
  const text = typeof value === 'string' ? value : new RpcUtf8().decode(value)
  /** Codec restore is the first and only semantic admission of this newly decoded input. */
  const prepared = codec.decode({ kind: 'message', data: text }, codecContext)
  return codec.restore(prepared, codecContext)
}

describe('audit-probe1 current public handshake sentinel receivers', () => {
  /** First thirty original variants exercise the same field or negotiation failure with v2 data. */
  const cases: Record<string, () => unknown> = {
    'unknown-kind': normalization({ ...OFFER, kind: 'x', [T]: 1 }),
    'unknown-step': normalization({ ...OFFER, step: 'x', [T]: 1 }),
    kind: normalization({ ...OFFER, kind: T }),
    step: normalization({ ...OFFER, step: T }),
    protocol: normalization({ ...OFFER, kind: 'x', profile: T }),
    'codec pattern-invalid': normalization({ ...ACC, codec: 'X' + T }),
    'codec pattern-valid': normalization({ ...ACC, codec: T, major: 0 }),
    'codec-complete :535': () => completeRpcHandshake(OFFER, { ...ACC, codec: T }),
    'codec-complete accept :468': () => acceptRpcHandshake(OFFER, { ...ACC, codec: T } as never),
    'protocol :535': () => completeRpcHandshake(OFFER, { ...ACC, profile: T }),
    'protocol :523': () => completeRpcHandshake(OFFER, { ...OFFER, profile: T }),
    'protocol :468': () => acceptRpcHandshake(OFFER, { ...ACC, profile: T } as never),
    'peer-snapshot(:213)': normalization({ ...OFFER, peer: T }),
    'peer-unknown(:223)': normalization({
      ...OFFER,
      peer: { id: 'a', runtime: 'BAD', [T]: 1 }
    }),
    'peer-id(:223)': normalization({ ...OFFER, peer: { id: T, runtime: 'BAD' } }),
    'peer-runtime(:223)': normalization({ ...OFFER, peer: { id: 'a', runtime: 'X' + T } }),
    'peer-runtimeVersion(:232)': normalization({
      ...OFFER,
      peer: { id: 'a', runtime: 'node', runtimeVersion: 1, [T]: 1 }
    }),
    'impl-snapshot(:235)': normalization({
      ...OFFER,
      peer: { id: 'a', runtime: 'node', implementation: T }
    }),
    'impl-unknown(:238)': normalization({
      ...OFFER,
      peer: { id: 'a', runtime: 'node', implementation: { name: 1, version: T, [T]: 1 } }
    }),
    'versions-type(:252)': normalization({ ...OFFER, versions: T }),
    'versions-entry-snapshot(:258)': normalization({ ...OFFER, versions: [T] }),
    'versions-entry(:262)': normalization({
      ...OFFER,
      versions: [{ major: 0, minor: 0, [T]: 1 }]
    }),
    'versions-duplicate(:264)': normalization({
      ...OFFER,
      versions: [
        { major: 1, minor: 0, [T]: 1 },
        { major: 1, minor: 0 }
      ]
    }),
    'codecs-type(:279)': normalization({ ...OFFER, codecs: T }),
    'codecs-label(:281)': normalization({ ...OFFER, codecs: ['json', T.toUpperCase()] }),
    'codecs-duplicate(:284)': normalization({ ...OFFER, codecs: ['json', T, T] }),
    'codecs-baseline(:286)': normalization({ ...OFFER, codecs: [T] }),
    'capabilities(:281)': normalization({ ...OFFER, extensions: [T] }),
    'accept-capabilities': () => completeRpcHandshake(OFFER, { ...ACC, extensions: [T] }),
    'accept-peer': () => completeRpcHandshake(OFFER, { ...ACC, peer: { id: T, runtime: 'BAD' } })
  }
  /** All five original clean controls still demand real rejection at a current canonical owner. */
  const controls: Record<string, () => unknown> = {
    'CONTROL cbor': () => completeRpcHandshake(OFFER2, { ...ACC, major: 9, codec: 'cbor' }),
    'CONTROL codecs dup': normalization({ ...OFFER, codecs: ['json', 'json'] }),
    'CONTROL reject foo': normalization({
      profile: OFFER.profile,
      kind: 'handshake',
      step: 'reject',
      error: { root: 0, nodes: [{ foo: 1 }] }
    }),
    'CONTROL reject bad cause': normalization({
      profile: OFFER.profile,
      kind: 'handshake',
      step: 'reject',
      error: { root: 0, nodes: [{ ...W, cause: 5 }] }
    }),
    'CONTROL getter offer': () =>
      normalizeRpcHandshake({
        ...OFFER,
        get peer() {
          throw new Error('boom')
        }
      })
  }
  it.each(Object.entries(controls))('%s retains a real rejection', (_name, run) =>
    expect(run).toThrow()
  )
  it.each(Object.entries(cases))(
    '%s preserves historical acceptance or redacted rejection',
    (_name, run) => {
      /** Keep the real classified failure for the original hidden/serialized/report predicates. */
      let caught: unknown
      try {
        run()
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(Error)
      assertPrivate(caught)
    }
  )
})

describe('audit-probe2 actual codec sentinel receivers', () => {
  /** Original raw text and byte values reach their executing SDK owner rather than a text facade. */
  const cases: Record<string, () => Promise<unknown>> = {
    'bytes form unknown-kind': () =>
      decodeHandshake(new TextEncoder().encode(JSON.stringify({ ...OFFER, kind: T, [T]: 1 }))),
    'bytes form peer': () =>
      decodeHandshake(new TextEncoder().encode(JSON.stringify({ ...OFFER, peer: T }))),
    'json syntax unquoted token': () => decodeHandshake(`{"kind":"handshake","x":${T}}`),
    'json syntax token key': () => decodeHandshake(`{"${T}" 1}`)
  }
  it.each(Object.entries(cases))(
    '%s preserves historical acceptance or redacted rejection',
    async (_name, run) => {
      /** Await only the original codec completion so an actual restore rejection cannot escape. */
      let caught: unknown
      try {
        await run()
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(Error)
      assertPrivate(caught)
    }
  )
})
