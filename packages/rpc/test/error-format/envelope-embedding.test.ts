import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope } from '../../src/contract/index.js'

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
  return { kind: 'response', ok: false, id: 'i', code: 'C', message: 'm', error }
}

describe('V1 failure error slot', () => {
  it('accepts data and truncation from the one contract wire schema', () => {
    const error = { ...node(), data: { hint: 1 }, truncated: true }
    expect(normalizeRpcEnvelope(failure(error))).toMatchObject({ error })
  })

  it('wraps schema violations after the whole envelope passes portable validation', () => {
    const invalid = [
      { ...node(), extra: true },
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
    expect((received as Error).cause).not.toMatchObject({ code: 'INVALID_WIRE_ERROR' })
  })

  it('preserves non-error request, discovery, variation, and success-response decisions', () => {
    const pairs = [
      [
        { kind: 'request', id: 'i', method: 'm', data: null },
        { kind: 'request', id: 'i', method: 1, data: null }
      ],
      [
        { kind: 'discovery', id: 'i', version: '1', acceptVersions: ['1'] },
        { kind: 'discovery', id: 'i', version: 1, acceptVersions: ['1'] }
      ],
      [
        { kind: 'variation', id: 'i', data: null },
        { kind: 'variation', id: 1, data: null }
      ],
      [
        { kind: 'response', ok: true, id: 'i', data: null },
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
