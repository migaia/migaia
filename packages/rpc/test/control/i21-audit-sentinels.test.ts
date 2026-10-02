import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  type IRpcHandshakeOffer,
  normalizeRpcHandshake,
  createRpcHello,
  completeRpcHandshake,
  acceptRpcHandshake
} from '../../src/contract/handshake.js'
import { serializeRpcError } from '../../src/contract/error.js'

/**
 * Check every six-character sentinel fragment across current diagnostics and persisted wire
 * projection.
 */
function assertPrivate(error: unknown): void {
  /** Reports use the production serializer policy; no secret values are persisted. */
  const reports: unknown[] = []
  /** Inspect hidden error/cause properties as well as actual serializable wire output. */
  const projections = [
    inspect(error, { depth: null, showHidden: true }),
    JSON.stringify(serializeRpcError(error, { report: (value) => reports.push(value) })),
    inspect(reports, { depth: null, showHidden: true })
  ]
  for (const token of ['toksecret9f8e', 'TOKSECRET9F8E']) {
    for (let offset = 0; offset <= token.length - 6; offset++) {
      /** Six-character fragments detect partial credential disclosure. */
      const fragment = token.slice(offset, offset + 6)
      for (const projection of projections) expect(projection.includes(fragment)).toBe(false)
    }
  }
}

describe('I21 EQ4 audit-probe1 historical sentinel corpus', () => {
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const T = 'toksecret9f8e'
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const OFFER: IRpcHandshakeOffer = {
    versions: [{ major: 1, minor: 0 }],
    codecs: ['json'],
    capabilities: [],
    peer: { id: 'a', runtime: 'node' }
  }
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const OFFER2: IRpcHandshakeOffer = { ...OFFER, codecs: ['json', 'cbor'] }
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const H = JSON.parse(createRpcHello(OFFER))
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const ACC = {
    kind: 'handshake',
    step: 'accept',
    protocol: 'migaia.rpc',
    major: 1,
    minor: 0,
    codec: 'json',
    capabilities: [],
    peer: { id: 'b', runtime: 'node' }
  }
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const W = {
    source: '@migaia/rpc',
    code: 'HANDSHAKE_INCOMPATIBLE',
    name: 'Error',
    message: 'm',
    stack: 'Error: m'
  }
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const J = (o: unknown) => JSON.stringify(o)
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const N = (o: unknown) => () => normalizeRpcHandshake(J(o))
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const cases: Record<string, () => unknown> = {
    'A9 unknown-kind': N({ ...H, kind: 'x', [T]: 1 }),
    'A9 unknown-step': N({ ...H, step: 'x', [T]: 1 }),
    'A9 kind': N({ ...H, kind: T }),
    'A9 step': N({ ...H, step: T }),
    'A9 protocol': N({ ...H, kind: 'x', protocol: T }),
    'A9 codec pattern-invalid': N({ ...ACC, codec: 'X' + T }),
    'A9 codec pattern-valid': N({ ...ACC, codec: T, major: 0 }),
    'A9 codec-complete :535': () => completeRpcHandshake(OFFER, J({ ...ACC, codec: T })),
    'A9 codec-complete accept :468': () => acceptRpcHandshake(OFFER, J({ ...ACC, codec: T })),
    'A9 protocol :535': () => completeRpcHandshake(OFFER, J({ ...ACC, protocol: T })),
    'A9 protocol :523': () => completeRpcHandshake(OFFER, J({ ...H, protocol: T })),
    'A9 protocol :468': () => acceptRpcHandshake(OFFER, J({ ...ACC, protocol: T })),
    'A10 peer-snapshot(:213)': N({ ...H, peer: T }),
    'A10 peer-unknown(:223)': N({ ...H, peer: { id: 'a', runtime: 'BAD', [T]: 1 } }),
    'A10 peer-id(:223)': N({ ...H, peer: { id: T, runtime: 'BAD' } }),
    'A10 peer-runtime(:223)': N({ ...H, peer: { id: 'a', runtime: 'X' + T } }),
    'A10 peer-runtimeVersion(:232)': N({
      ...H,
      peer: { id: 'a', runtime: 'node', runtimeVersion: 1, [T]: 1 }
    }),
    'A10 impl-snapshot(:235)': N({ ...H, peer: { id: 'a', runtime: 'node', implementation: T } }),
    'A10 impl-unknown(:238)': N({
      ...H,
      peer: { id: 'a', runtime: 'node', implementation: { name: 1, version: T, [T]: 1 } }
    }),
    'A10 versions-type(:252)': N({ ...H, versions: T }),
    'A10 versions-entry-snapshot(:258)': N({ ...H, versions: [T] }),
    'A10 versions-entry(:262)': N({ ...H, versions: [{ major: 0, minor: 0, [T]: 1 }] }),
    'A10 versions-duplicate(:264)': N({
      ...H,
      versions: [
        { major: 1, minor: 0, [T]: 1 },
        { major: 1, minor: 0 }
      ]
    }),
    'A10 codecs-type(:279)': N({ ...H, codecs: T }),
    'A10 codecs-label(:281)': N({ ...H, codecs: ['json', T.toUpperCase()] }),
    'A10 codecs-duplicate(:284)': N({ ...H, codecs: ['json', T, T] }),
    'A10 codecs-baseline(:286)': N({ ...H, codecs: [T] }),
    'A10 capabilities(:281)': N({ ...H, capabilities: [T] }),
    'A10 accept-capabilities': () => completeRpcHandshake(OFFER, J({ ...ACC, capabilities: [T] })),
    'A10 accept-peer': () =>
      completeRpcHandshake(OFFER, J({ ...ACC, peer: { id: T, runtime: 'BAD' } })),
    'A10 reject-unknown(:402)': N({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { [T]: 1 }
    }),
    'A10 reject-field(:402)': N({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { ...W, code: 5, message: T }
    }),
    'A10 reject-data(:402)': N({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { ...W, data: { $rpc: 'x', v: T } }
    }),
    'A10 reject-surrogate-free-bytes(:402)': N({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { ...W, message: T.repeat(3000) }
    })
  }
  /** Historical non-secret controls ensure failures are genuine contract rejections. */
  const controls: Record<string, () => unknown> = {
    'CONTROL cbor': () => completeRpcHandshake(OFFER2, J({ ...ACC, major: 9, codec: 'cbor' })),
    'CONTROL codecs dup': N({ ...H, codecs: ['json', 'json'] }),
    'CONTROL reject foo': N({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { foo: 1 }
    }),
    'CONTROL reject bad cause': N({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { ...W, cause: 5 }
    }),
    'CONTROL getter offer': () =>
      createRpcHello({
        ...OFFER,
        get peer(): IRpcHandshakeOffer['peer'] {
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
      /** Observe the current native failure without logging the synthetic credential. */
      let caught: unknown
      try {
        run()
      } catch (error) {
        caught = error
      }
      if (
        [
          'proto in peer',
          'proto in version entry',
          'reject nest 17 token msg',
          'A10 reject-surrogate-free-bytes(:402)'
        ].includes(_name)
      ) {
        expect(caught).toBeUndefined()
      } else {
        expect(caught).toBeInstanceOf(Error)
        assertPrivate(caught)
      }
    }
  )
})

describe('I21 EQ4 audit-probe2 historical sentinel corpus', () => {
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const T = 'toksecret9f8e'
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const OFFER: IRpcHandshakeOffer = {
    versions: [{ major: 1, minor: 0 }],
    codecs: ['json'],
    capabilities: [],
    peer: { id: 'a', runtime: 'node' }
  }
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const H = JSON.parse(createRpcHello(OFFER))
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const ACC = {
    kind: 'handshake',
    step: 'accept',
    protocol: 'migaia.rpc',
    major: 1,
    minor: 0,
    codec: 'json',
    capabilities: [],
    peer: { id: 'b', runtime: 'node' }
  }
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const W = {
    source: '@migaia/rpc',
    code: 'HANDSHAKE_INCOMPATIBLE',
    name: 'Error',
    message: 'm',
    stack: 'Error: m'
  }
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const J = (o: unknown) => JSON.stringify(o)
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const N = (o: unknown) => () => normalizeRpcHandshake(typeof o === 'string' ? o : J(o))
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const R = (error: unknown) =>
    N({ kind: 'handshake', step: 'reject', protocol: 'migaia.rpc', error })
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const nest = (d: number, leaf: unknown): any =>
    d === 0 ? leaf : { ...W, cause: nest(d - 1, leaf) }
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const manyKeys = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [T + i, 1]))
  /** Historical synthetic payload fixture retained verbatim for EQ4 replay. */
  const cases: Record<string, () => unknown> = {
    'proto top-level': N(
      `{"__proto__":{"${T}":1},"kind":"x","step":"hello","protocol":"migaia.rpc"}`
    ),
    'proto key name kind': N(`{"__proto__":"${T}","constructor":"${T}","kind":"x","protocol":"p"}`),
    'constructor key in peer': N(
      `${J({ ...H, peer: { id: 'a', runtime: 'BAD' } }).slice(0, -2)},"constructor":{"${T}":1}}}`
    ),
    'proto in peer': N(
      J({ ...H }).replace('"peer":{', `"peer":{"__proto__":{"${T}":1},"runtime":"BAD",`)
    ),
    'proto in version entry': N(
      J(H).replace('"versions":[{', `"versions":[{"__proto__":"${T}","major":0,`)
    ),
    'proto in implementation': N(
      J({ ...H, peer: { id: 'a', runtime: 'node', implementation: { name: 1 } } }).replace(
        '"implementation":{',
        `"implementation":{"__proto__":{"${T}":[1]},`
      )
    ),
    'deep nest in peer': N({ ...H, peer: { id: 'a', runtime: 'BAD', x: nest(50, T) } }),
    'array of objects codecs': N({ ...H, codecs: [{ [T]: T }, { a: [T] }] }),
    'array of objects capabilities': N({
      ...H,
      capabilities: Array.from({ length: 5 }, () => ({ [T]: T }))
    }),
    'array of objects versions': N({
      ...H,
      versions: [{ major: 1, minor: 0 }, [T], { [T]: { [T]: T } }]
    }),
    'huge unknown keys top': N({ ...manyKeys(3000), kind: 'x', protocol: 'p' }),
    'huge unknown keys peer': N({ ...H, peer: { id: 'a', runtime: 'BAD', ...manyKeys(3000) } }),
    'huge versions array': N({ ...H, versions: Array.from({ length: 5000 }, () => T) }),
    'bytes form unknown-kind': () =>
      normalizeRpcHandshake(new TextEncoder().encode(J({ ...H, kind: T, [T]: 1 }))),
    'bytes form peer': () => normalizeRpcHandshake(new TextEncoder().encode(J({ ...H, peer: T }))),
    'json syntax unquoted token': N(`{"kind":"handshake","x":${T}}`),
    'json syntax token key': N(`{"${T}" 1}`),
    'reject nest 15 token msg invalid code': R(nest(15, { ...W, code: 5, message: T })),
    'reject nest 17 token msg': R(nest(17, { ...W, message: T })),
    'reject nest 40': R(nest(40, { ...W, message: T, name: 5 })),
    'reject data token key': R({ ...W, data: { [T]: { $rpc: 'x' } } }),
    'reject data array': R({ ...W, data: [{ [T]: { $rpc: 'bad' } }] }),
    'reject cause data non-portable': R({ ...W, cause: { ...W, data: { $rpc: 'x', v: T } } }),
    'reject errors array token': R({ ...W, errors: [{ ...W, code: 5, message: T }] }),
    'reject errors array data': R({ ...W, errors: [{ ...W, data: { $rpc: 'x', [T]: T } }] }),
    'reject proto key in error': R(JSON.parse(`{"__proto__":{"${T}":1},"source":5}`)),
    'reject proto key raw': N(
      `{"kind":"handshake","step":"reject","protocol":"migaia.rpc","error":{"__proto__":{"${T}":1},"source":5,"message":"${T}"}}`
    ),
    'reject error is string': R(T),
    'reject error array': R([T]),
    'reject huge unknown keys': R({ ...W, code: 5, ...manyKeys(3000) }),
    'auth non-portable $rpc': N({ ...H, auth: { $rpc: 'x', secret: T } }),
    'auth non-portable key': N({ ...H, auth: { [T]: { $rpc: 'y' } } }),
    'auth deep nest': N({ ...H, auth: nest(200, T) }),
    'complete accept deep peer': () =>
      completeRpcHandshake(
        OFFER,
        J({ ...ACC, peer: { id: 'b', runtime: 'BAD', deep: nest(30, T) } })
      ),
    'accept hello deep caps': () =>
      acceptRpcHandshake(OFFER, J({ ...H, capabilities: [{ [T]: [T] }] }))
  }
  it.each(Object.entries(cases))(
    '%s preserves historical acceptance or redacted rejection',
    (_name, run) => {
      /** Observe the current native failure without logging the synthetic credential. */
      let caught: unknown
      try {
        run()
      } catch (error) {
        caught = error
      }
      if (
        [
          'proto in peer',
          'proto in version entry',
          'reject nest 17 token msg',
          'A10 reject-surrogate-free-bytes(:402)'
        ].includes(_name)
      ) {
        expect(caught).toBeUndefined()
      } else {
        expect(caught).toBeInstanceOf(Error)
        assertPrivate(caught)
      }
    }
  )
})
