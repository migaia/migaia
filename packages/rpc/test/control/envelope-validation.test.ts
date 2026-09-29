import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope, RpcRouteProfile, RpcRouteType } from '../../src/contract/index.js'

/** A complete request exposes the protocol route instead of a core-owned route alias. */
function request(payload: unknown = null): object {
  return {
    kind: 'request',
    id: 'req-1',
    method: 'count',
    data: {
      route: {
        profile: RpcRouteProfile,
        type: RpcRouteType.request,
        applicationVersion: '1',
        senderId: 'caller',
        targetId: 'provider',
        sentAt: 0
      },
      payload
    }
  }
}

describe('control envelope validation (A3)', () => {
  it('requires a route on every request', () => {
    expect(() =>
      normalizeRpcEnvelope({ kind: 'request', id: '1', method: 'm', data: null })
    ).toThrow(
      expect.objectContaining({ code: 'INVALID_ENVELOPE', violation: 'route', pointer: '/data' })
    )
    expect(normalizeRpcEnvelope(request())).toMatchObject({ data: { route: { type: 'request' } } })
  })

  it('warns and drops unknown fields in protocol order', () => {
    const fields: string[] = []
    const value = { ...request(), z: 1, a: 2 } as Record<string, unknown>
    value.data = {
      ...(value.data as object),
      route: { ...(value.data as { route: object }).route, manual: true, x: 1 }
    }
    const result = normalizeRpcEnvelope(value, {
      onUnknownField(pointer, field) {
        fields.push(`${pointer}#${field}`)
      }
    })
    expect(fields).toEqual(['#a', '#z', '/data/route#manual', '/data/route#x'])
    expect(result).not.toHaveProperty('a')
    expect(result.data.route).not.toHaveProperty('manual')
  })

  it('chooses kind before a malformed route and retains the original getter error', () => {
    expect(() => normalizeRpcEnvelope({ ...request(), kind: 'handshake' })).toThrow(
      expect.objectContaining({ violation: 'unknownKind', pointer: '/kind' })
    )
    const original = new Error('getter failed')
    const value = {
      ...request(),
      get z(): never {
        throw original
      }
    }
    expect(() => normalizeRpcEnvelope(value)).toThrow(
      expect.objectContaining({ code: 'INVALID_ENVELOPE', violation: 'read', cause: original })
    )
  })

  it('keeps variation payload opaque while checking ordinary payload depth', () => {
    const hostile = {
      get broken(): never {
        throw new Error('not read')
      }
    }
    const variation = {
      kind: 'variation',
      id: 'req-1',
      data: {
        route: {
          profile: RpcRouteProfile,
          type: RpcRouteType.variation,
          applicationVersion: '1',
          senderId: 'caller',
          targetId: 'provider',
          sentAt: 0,
          variation: 'abort'
        },
        payload: hostile
      }
    }
    expect(normalizeRpcEnvelope(variation).data.payload).toBe(hostile)
    expect(() => normalizeRpcEnvelope(request(hostile))).toThrow(
      expect.objectContaining({ violation: 'payload', pointer: '/data/payload' })
    )
  })
})
