import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { normalizeWebRpcRoutingData } from '../src/internal/routing-data.js'
import { assertContractMethod as assertMethod } from '../src/internal/contract.js'

describe('wire boundary', () => {
  it('accepts only request, response, variation envelopes', () => {
    expect(
      normalizeRpcEnvelope({
        kind: 'request',
        id: 't',
        method: 'm',
        data: {
          webRpc: {
            profile: 'web-rpc.route.v1',
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
          webRpc: {
            profile: 'web-rpc.route.v1',
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
      normalizeWebRpcRoutingData({
        webRpc: {
          profile: 'web-rpc.route.v1',
          type: 'variation',
          applicationVersion: '1.0',
          senderId: 'a',
          targetId: 'b',
          variation: 'ping',
          sentAt: 0
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
      { kind: 'response', id: 'response-1', ok: true, data: null },
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
      normalizeWebRpcRoutingData({
        webRpc: {
          profile: 'web-rpc.route.v1',
          type: 'discovery-query',
          applicationVersion: '1.0',
          senderId: 'a',
          targetId: 'b',
          manual: true,
          sentAt: 1
        }
      })
    ).toMatchObject({ webRpc: { type: 'discovery-query', manual: true, sentAt: 1 } })
    expect(
      normalizeWebRpcRoutingData({
        webRpc: {
          profile: 'web-rpc.route.v1',
          type: 'discovery-response',
          applicationVersion: '1.0',
          senderId: 'b',
          targetId: 'a',
          resolvedTargetId: 'a',
          accepted: true,
          sentAt: 1
        }
      })
    ).toMatchObject({
      webRpc: { type: 'discovery-response', resolvedTargetId: 'a', accepted: true, sentAt: 1 }
    })
    expect(
      normalizeWebRpcRoutingData({
        webRpc: {
          profile: 'web-rpc.route.v1',
          type: 'variation',
          applicationVersion: '1.0',
          senderId: 'a',
          targetId: 'b',
          variation: 'ping',
          sentAt: 1
        }
      })
    ).toMatchObject({ webRpc: { type: 'variation', variation: 'ping', sentAt: 1 } })
    expect(
      normalizeRpcEnvelope({ kind: 'response', id: 'success', ok: true, data: null })
    ).toMatchObject({ kind: 'response', id: 'success', ok: true, data: null })
    expect(
      normalizeRpcEnvelope({
        kind: 'response',
        id: 'failure',
        ok: false,
        code: 'FAILED',
        message: 'failed'
      })
    ).toMatchObject({ kind: 'response', id: 'failure', ok: false, code: 'FAILED' })
    expect(
      normalizeWebRpcRoutingData({
        webRpc: {
          profile: 'web-rpc.route.v1',
          type: 'discovery-query',
          applicationVersion: '1.0',
          senderId: 'a',
          targetId: 'b',
          sentAt: -1
        }
      })
    ).toBeUndefined()
    expect(
      normalizeWebRpcRoutingData({
        webRpc: {
          profile: 'web-rpc.route.v1',
          type: 'discovery-response',
          applicationVersion: '1.0',
          senderId: 'b',
          targetId: 'a',
          sentAt: 1
        }
      })
    ).toBeUndefined()
    expect(
      normalizeWebRpcRoutingData({
        webRpc: {
          profile: 'web-rpc.route.v1',
          type: 'variation',
          applicationVersion: '1.0',
          senderId: 'a',
          targetId: 'b',
          sentAt: 1
        }
      })
    ).toBeUndefined()
  })
  it('rejects non-string and empty methods', () => {
    expect(() => assertMethod(1 as never)).toThrow('non-empty')
    expect(() => assertMethod('')).toThrow('non-empty')
  })
})
