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

/** Construct only the original synthetic input nesting, without traversing or normalizing a graph. */
function nestedInput(depth: number, leaf: unknown): unknown {
  /** Each fixed fixture edge points to the previous exact leaf, matching the original cause chain. */
  let value = leaf
  for (let index = 0; index < depth; index++) value = { ...W, cause: value }
  return value
}

/** Fixed fixture nodes encode the original cause edges directly in the current raw wire grammar. */
function errorChain(depth: number, leaf: unknown): unknown {
  /**
   * These are synthetic raw nodes, including intentionally invalid fields; no serializer repairs
   * them.
   */
  const nodes: unknown[] = Array.from({ length: depth }, (_, index) => ({
    ...W,
    cause: index + 1
  }))
  nodes.push(leaf)
  return { root: 0, nodes }
}

/** The original four accepted variants remain the entire fixed acceptance exception set. */
const acceptedSentinels = new Set([
  'proto in peer',
  'proto in version entry',
  'reject nest 17 token msg',
  'reject-surrogate-free-bytes(:402)'
])
/** Only the current reject discriminator is shared; each raw error below remains unnormalized. */
const REJECT = { profile: OFFER.profile, kind: 'handshake', step: 'reject' }

describe('audit-probe1 current flat error sentinel receivers', () => {
  /** All four remaining original variants retain their exact scalar values and byte counts. */
  const cases: Record<string, () => unknown> = {
    'reject-unknown(:402)': normalization({
      ...REJECT,
      error: { root: 0, nodes: [{ [T]: 1 }] }
    }),
    'reject-field(:402)': normalization({
      ...REJECT,
      error: { root: 0, nodes: [{ ...W, code: 5, message: T }] }
    }),
    'reject-data(:402)': normalization({
      ...REJECT,
      error: { root: 0, nodes: [{ ...W, data: { $rpc: 'x', v: T } }] }
    }),
    'reject-surrogate-free-bytes(:402)': normalization({
      ...REJECT,
      error: { root: 0, nodes: [{ ...W, message: T.repeat(3000) }] }
    })
  }
  it.each(Object.entries(cases))(
    '%s preserves historical acceptance or redacted rejection',
    (_name, run) => {
      /** Admission is the actual Contract operation, not a fixture-side error reconstruction. */
      let caught: unknown
      try {
        run()
      } catch (error) {
        caught = error
      }
      if (acceptedSentinels.has(_name)) {
        expect(caught).toBeUndefined()
      } else {
        expect(caught).toBeInstanceOf(Error)
        assertPrivate(caught)
      }
    }
  )
})

describe('audit-probe2 current graph and portable sentinel receivers', () => {
  /**
   * Peer stays last solely to preserve the original raw-JSON constructor/prototype insertion
   * geometry. All fields come from the same already-admitted current hello.
   */
  const H = {
    profile: OFFER.profile,
    kind: OFFER.kind,
    step: OFFER.step,
    versions: OFFER.versions,
    codecs: OFFER.codecs,
    extensions: OFFER.extensions,
    requiredExtensions: OFFER.requiredExtensions,
    directory: OFFER.directory,
    peer: OFFER.peer
  }
  /** The original 3000 hostile key names remain present on each independently constructed input. */
  const manyKeys = (count: number) =>
    Object.fromEntries(Array.from({ length: count }, (_, index) => [T + index, 1]))
  /** The original JSON constructors are fixture input formation, never a second decoder. */
  const J = (value: unknown) => JSON.stringify(value)
  /** Original input values/order/depth survive the required wire2 discriminator and graph shape. */
  const cases: Record<string, () => unknown> = {
    'proto top-level': () =>
      decodeHandshake(
        `{"__proto__":{"${T}":1},"kind":"x","step":"hello","profile":"${OFFER.profile}"}`
      ),
    'proto key name kind': () =>
      decodeHandshake(`{"__proto__":"${T}","constructor":"${T}","kind":"x","profile":"p"}`),
    'constructor key in peer': () =>
      decodeHandshake(
        `${J({ ...H, peer: { id: 'a', runtime: 'BAD' } }).slice(0, -2)},"constructor":{"${T}":1}}}`
      ),
    'proto in peer': () =>
      decodeHandshake(
        J({ ...H }).replace('"peer":{', `"peer":{"__proto__":{"${T}":1},"runtime":"BAD",`)
      ),
    'proto in version entry': () =>
      decodeHandshake(J(H).replace('"versions":[{', `"versions":[{"__proto__":"${T}","major":0,`)),
    'proto in implementation': () =>
      decodeHandshake(
        J({ ...H, peer: { id: 'a', runtime: 'node', implementation: { name: 1 } } }).replace(
          '"implementation":{',
          `"implementation":{"__proto__":{"${T}":[1]},`
        )
      ),
    'deep nest in peer': normalization({
      ...H,
      peer: { id: 'a', runtime: 'BAD', x: nestedInput(50, T) }
    }),
    'array of objects codecs': normalization({ ...H, codecs: [{ [T]: T }, { a: [T] }] }),
    'array of objects capabilities': normalization({
      ...H,
      extensions: Array.from({ length: 5 }, () => ({ [T]: T }))
    }),
    'array of objects versions': normalization({
      ...H,
      versions: [{ major: 1, minor: 0 }, [T], { [T]: { [T]: T } }]
    }),
    'huge unknown keys top': normalization({ ...manyKeys(3000), kind: 'x', profile: 'p' }),
    'huge unknown keys peer': normalization({
      ...H,
      peer: { id: 'a', runtime: 'BAD', ...manyKeys(3000) }
    }),
    'huge versions array': normalization({
      ...H,
      versions: Array.from({ length: 5000 }, () => T)
    }),
    'reject nest 15 token msg invalid code': normalization({
      ...REJECT,
      error: errorChain(15, { ...W, code: 5, message: T })
    }),
    'reject nest 17 token msg': normalization({
      ...REJECT,
      error: errorChain(17, { ...W, message: T })
    }),
    'reject nest 40': normalization({
      ...REJECT,
      error: errorChain(40, { ...W, message: T, name: 5 })
    }),
    'reject data token key': normalization({
      ...REJECT,
      error: { root: 0, nodes: [{ ...W, data: { [T]: { $rpc: 'x' } } }] }
    }),
    'reject data array': normalization({
      ...REJECT,
      error: { root: 0, nodes: [{ ...W, data: [{ [T]: { $rpc: 'bad' } }] }] }
    }),
    'reject cause data non-portable': normalization({
      ...REJECT,
      error: {
        root: 0,
        nodes: [
          { ...W, cause: 1 },
          { ...W, data: { $rpc: 'x', v: T } }
        ]
      }
    }),
    'reject errors array token': normalization({
      ...REJECT,
      error: {
        root: 0,
        nodes: [
          { ...W, errors: [1] },
          { ...W, code: 5, message: T }
        ]
      }
    }),
    'reject errors array data': normalization({
      ...REJECT,
      error: {
        root: 0,
        nodes: [
          { ...W, errors: [1] },
          { ...W, data: { $rpc: 'x', [T]: T } }
        ]
      }
    }),
    'reject proto key in error': () =>
      decodeHandshake(
        `{"profile":"${OFFER.profile}","kind":"handshake","step":"reject","error":{"root":0,"nodes":[{"__proto__":{"${T}":1},"source":5}]}}`
      ),
    'reject proto key raw': () =>
      decodeHandshake(
        `{"profile":"${OFFER.profile}","kind":"handshake","step":"reject","error":{"root":0,"nodes":[{"__proto__":{"${T}":1},"source":5,"message":"${T}"}]}}`
      ),
    'reject error is string': normalization({ ...REJECT, error: T }),
    'reject error array': normalization({ ...REJECT, error: [T] }),
    'reject huge unknown keys': normalization({
      ...REJECT,
      error: { root: 0, nodes: [{ ...W, code: 5, ...manyKeys(3000) }] }
    }),
    'auth non-portable $rpc': normalization({ ...H, auth: { $rpc: 'x', secret: T } }),
    'auth non-portable key': normalization({ ...H, auth: { [T]: { $rpc: 'y' } } }),
    'auth deep nest': normalization({ ...H, auth: nestedInput(200, T) }),
    'complete accept deep peer': () =>
      completeRpcHandshake(OFFER, {
        ...ACC,
        peer: { id: 'b', runtime: 'BAD', deep: nestedInput(30, T) }
      }),
    'accept hello deep caps': () =>
      acceptRpcHandshake(OFFER, { ...H, extensions: [{ [T]: [T] }] } as never)
  }
  it.each(Object.entries(cases))(
    '%s preserves historical acceptance or redacted rejection',
    async (_name, run) => {
      /** The actual codec may suspend restore; no late failure is mistaken for acceptance. */
      let caught: unknown
      try {
        await run()
      } catch (error) {
        caught = error
      }
      if (acceptedSentinels.has(_name)) {
        expect(caught).toBeUndefined()
      } else {
        expect(caught).toBeInstanceOf(Error)
        assertPrivate(caught)
      }
    }
  )
})
