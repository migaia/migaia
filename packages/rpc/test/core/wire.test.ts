import { describe, expect, it } from 'vitest'
import { RpcRouteProfile, normalizeRpcEnvelope } from '../../src/contract/index.js'
import { assertContractMethod as assertMethod } from '../../src/core/internal/contract.js'

describe('wire boundary', () => {
  it('accepts only request, response, variation envelopes', () => {
    expect(
      normalizeRpcEnvelope({
        kind: 'request',
        id: 't',
        method: 'm',
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'request',
            applicationVersion: '1.0',
            senderId: 'a',
            targetId: 'b',
            sentAt: 0
          },
          payload: null
        }
      })
    ).toBeDefined()
    expect(
      normalizeRpcEnvelope({
        kind: 'response',
        id: 't',
        ok: true,
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'response',
            applicationVersion: '1.0',
            senderId: 'b',
            targetId: 'a',
            method: 'm',
            sentAt: 0
          }
        }
      })
    ).toBeDefined()
    expect(
      normalizeRpcEnvelope({
        kind: 'variation',
        id: 't',
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'variation',
            applicationVersion: '1.0',
            senderId: 'a',
            targetId: 'b',
            variation: 'ping',
            sentAt: 0
          }
        }
      })
    ).toBeDefined()
    expect(() => normalizeRpcEnvelope({ kind: 'request' })).toThrow()
    expect(() => normalizeRpcEnvelope({ kind: 'unknown' })).toThrow()
    expect(() => normalizeRpcEnvelope(null)).toThrow()
  })
  it('rejects empty method names at entry', () => {
    expect(() => assertMethod('')).toThrow('non-empty')
    expect(assertMethod('notes.save')).toBe('notes.save')
  })

  it('delegates hostile semantic envelope getters to the rpc-contract normalizer', () => {
    let reads = 0
    const input = new Proxy(
      {
        kind: 'response',
        id: 'response-1',
        ok: true,
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'response',
            applicationVersion: '1.0',
            senderId: 'b',
            targetId: 'a',
            method: 'm',
            sentAt: 0
          }
        }
      },
      {
        get(target, property, receiver) {
          if (property === 'id') {
            reads += 1
            return reads === 1 ? 'response-1' : 'forged'
          }
          return Reflect.get(target, property, receiver)
        }
      }
    )
    expect(normalizeRpcEnvelope(input)).toMatchObject({ kind: 'response', id: 'response-1' })
    expect(reads).toBe(1)
  })
  it('normalizes discovery and variation routing records with their required fields', () => {
    expect(
      normalizeRpcEnvelope({
        kind: 'discovery',
        id: 'd1',
        version: '1.0',
        acceptVersions: ['1.0'],
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'discovery-query',
            applicationVersion: '1.0',
            senderId: 'a',
            targetId: 'b',
            manual: true,
            sentAt: 1
          }
        }
      })
    ).toMatchObject({ data: { route: { type: 'discovery-query', manual: true, sentAt: 1 } } })
    expect(
      normalizeRpcEnvelope({
        kind: 'discovery',
        id: 'd2',
        version: '1.0',
        acceptVersions: ['1.0'],
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'discovery-response',
            applicationVersion: '1.0',
            senderId: 'b',
            targetId: 'a',
            resolvedTargetId: 'a',
            accepted: true,
            sentAt: 1
          }
        }
      })
    ).toMatchObject({
      data: {
        route: { type: 'discovery-response', resolvedTargetId: 'a', accepted: true, sentAt: 1 }
      }
    })
    expect(
      normalizeRpcEnvelope({
        kind: 'variation',
        id: 'v1',
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'variation',
            applicationVersion: '1.0',
            senderId: 'a',
            targetId: 'b',
            variation: 'ping',
            sentAt: 1
          }
        }
      })
    ).toMatchObject({ data: { route: { type: 'variation', variation: 'ping', sentAt: 1 } } })
    expect(
      normalizeRpcEnvelope({
        kind: 'response',
        id: 'success',
        ok: true,
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'response',
            applicationVersion: '1.0',
            senderId: 'b',
            targetId: 'a',
            method: 'm',
            sentAt: 1
          }
        }
      })
    ).toMatchObject({ kind: 'response', id: 'success', ok: true })
    expect(
      normalizeRpcEnvelope({
        kind: 'response',
        id: 'failure',
        ok: false,
        code: 'FAILED',
        message: 'failed',
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'response',
            applicationVersion: '1.0',
            senderId: 'b',
            targetId: 'a',
            method: 'm',
            sentAt: 1
          }
        }
      })
    ).toMatchObject({ kind: 'response', id: 'failure', ok: false, code: 'FAILED' })
    expect(() =>
      normalizeRpcEnvelope({
        kind: 'discovery',
        id: 'd3',
        version: '1.0',
        acceptVersions: ['1.0'],
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'discovery-query',
            applicationVersion: '1.0',
            senderId: 'a',
            targetId: 'b',
            sentAt: -1
          }
        }
      })
    ).toThrow()
    expect(() =>
      normalizeRpcEnvelope({
        kind: 'discovery',
        id: 'd4',
        version: '1.0',
        acceptVersions: ['1.0'],
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'discovery-response',
            applicationVersion: '1.0',
            senderId: 'b',
            targetId: 'a',
            sentAt: 1
          }
        }
      })
    ).toThrow()
    expect(() =>
      normalizeRpcEnvelope({
        kind: 'variation',
        id: 'v2',
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'variation',
            applicationVersion: '1.0',
            senderId: 'a',
            targetId: 'b',
            sentAt: 1
          }
        }
      })
    ).toThrow()
  })
  it('rejects non-string and empty methods', () => {
    expect(() => assertMethod(1 as never)).toThrow('non-empty')
    expect(() => assertMethod('')).toThrow('non-empty')
  })
})
