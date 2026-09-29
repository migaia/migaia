import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope } from '../../src/contract/index.js'
import { minimalRpcRoute } from '../fixtures/control-envelopes.js'

/** Short wire node that stays below text limits even in wide trees. */
function node(): {
  source: string
  code: string
  name: string
  message: string
  stack: string
  cause?: unknown
  errors?: unknown[]
  data?: unknown
  truncated?: true
} {
  return { source: 's', code: 'C', name: 'Error', message: 'm', stack: 'x' }
}

/** Existing V1 failure envelope with an optional wire error slot. */
function failure(error: unknown): unknown {
  return {
    kind: 'response',
    ok: false,
    id: 'i',
    code: 'C',
    message: 'm',
    data: { route: minimalRpcRoute('response') },
    error
  }
}

describe('V1 failure error slot', () => {
  it('accepts data and truncation from the one contract wire schema', () => {
    const error = { ...node(), data: { hint: 1 }, truncated: true }
    expect(normalizeRpcEnvelope(failure(error))).toMatchObject({ error })
  })

  it('wraps schema violations after the whole envelope passes portable validation', () => {
    const warnings: Array<[string, string]> = []
    expect(
      normalizeRpcEnvelope(failure({ ...node(), extra: true }), {
        onUnknownField: (pointer, field) => warnings.push([pointer, field])
      })
    ).toMatchObject({ error: node() })
    expect(warnings).toEqual([['/error', 'extra']])
    const invalid = [
      { ...node(), stack: '' },
      { ...node(), errors: Array.from({ length: 1024 }, () => node()) }
    ]
    let deep = node()
    for (let index = 1; index < 49; index += 1) deep = { ...node(), cause: deep }
    invalid.push(deep)
    for (const error of invalid) {
      let received: unknown
      try {
        normalizeRpcEnvelope(failure(error))
      } catch (cause) {
        received = cause
      }
      expect(received).toMatchObject({ code: 'INVALID_ENVELOPE' })
      expect((received as Error).cause).toMatchObject({ code: 'INVALID_WIRE_ERROR' })
    }
  })

  it('keeps the earlier portable-envelope failure for absolute depth over 64', () => {
    let deep = node()
    for (let index = 1; index < 70; index += 1) deep = { ...node(), cause: deep }
    let received: unknown
    try {
      normalizeRpcEnvelope(failure(deep))
    } catch (error) {
      received = error
    }
    expect(received).toMatchObject({ code: 'INVALID_ENVELOPE' })
    expect((received as Error).cause).toMatchObject({
      code: 'INVALID_WIRE_ERROR',
      violation: 'depth'
    })
  })

  it('preserves non-error request, discovery, variation, and success-response decisions', () => {
    const pairs = [
      [
        { kind: 'request', id: 'i', method: 'm', data: { route: minimalRpcRoute('request') } },
        { kind: 'request', id: 'i', method: 1, data: { route: minimalRpcRoute('request') } }
      ],
      [
        {
          kind: 'discovery',
          id: 'i',
          version: '1',
          acceptVersions: ['1'],
          data: { route: minimalRpcRoute('discovery-query') }
        },
        {
          kind: 'discovery',
          id: 'i',
          version: 1,
          acceptVersions: ['1'],
          data: { route: minimalRpcRoute('discovery-query') }
        }
      ],
      [
        { kind: 'variation', id: 'i', data: { route: minimalRpcRoute('variation') } },
        { kind: 'variation', id: 1, data: { route: minimalRpcRoute('variation') } }
      ],
      [
        { kind: 'response', ok: true, id: 'i', data: { route: minimalRpcRoute('response') } },
        { kind: 'response', ok: true, id: 'i' }
      ]
    ] as const
    for (const [accepted, rejected] of pairs) {
      expect(normalizeRpcEnvelope(accepted)).toEqual(accepted)
      expect(() => normalizeRpcEnvelope(rejected)).toThrow(
        expect.objectContaining({ code: 'INVALID_ENVELOPE' })
      )
    }
  })
})
