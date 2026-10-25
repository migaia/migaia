import { inspect } from 'node:util'
import { describe, expect, it } from 'vitest'
import {
  type IRpcHandshakeOffer,
  normalizeRpcHandshake,
  createRpcHello,
  completeRpcHandshake,
  acceptRpcHandshake
} from '@migaia/rpc-contract'
import { serializeRpcError } from '@migaia/rpc-contract'

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

describe('audit-probe1 historical sentinel corpus', () => {
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const T = 'toksecret9f8e'
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const W = {
    source: '@migaia/rpc',
    code: 'HANDSHAKE_INCOMPATIBLE',
    name: 'Error',
    message: 'm',
    stack: 'Error: m'
  }
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const J = (o: unknown) => JSON.stringify(o)
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const N = (o: unknown) => () => normalizeRpcHandshake(J(o))
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const cases: Record<string, () => unknown> = {
    'reject-unknown(:402)': N({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { [T]: 1 }
    }),
    'reject-field(:402)': N({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { ...W, code: 5, message: T }
    }),
    'reject-data(:402)': N({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { ...W, data: { $rpc: 'x', v: T } }
    }),
    'reject-surrogate-free-bytes(:402)': N({
      kind: 'handshake',
      step: 'reject',
      protocol: 'migaia.rpc',
      error: { ...W, message: T.repeat(3000) }
    })
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
          'reject-surrogate-free-bytes(:402)'
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

describe('audit-probe2 historical sentinel corpus', () => {
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const T = 'toksecret9f8e'
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const OFFER: IRpcHandshakeOffer = {
    versions: [{ major: 1, minor: 0 }],
    codecs: ['json'],
    capabilities: [],
    peer: { id: 'a', runtime: 'node' }
  }
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const H = JSON.parse(createRpcHello(OFFER))
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
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
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const W = {
    source: '@migaia/rpc',
    code: 'HANDSHAKE_INCOMPATIBLE',
    name: 'Error',
    message: 'm',
    stack: 'Error: m'
  }
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const J = (o: unknown) => JSON.stringify(o)
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const N = (o: unknown) => () => normalizeRpcHandshake(typeof o === 'string' ? o : J(o))
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const R = (error: unknown) =>
    N({ kind: 'handshake', step: 'reject', protocol: 'migaia.rpc', error })
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const nest = (d: number, leaf: unknown): any =>
    d === 0 ? leaf : { ...W, cause: nest(d - 1, leaf) }
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
  const manyKeys = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [T + i, 1]))
  /** Historical synthetic payload fixture retained verbatim for audit replay. */
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
          'reject-surrogate-free-bytes(:402)'
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
