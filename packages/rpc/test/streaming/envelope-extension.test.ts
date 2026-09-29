import { describe, expect, it } from 'vitest'
import {
  acceptRpcHandshake,
  completeRpcHandshake,
  createRpcHello,
  normalizeRpcEnvelope,
  RpcEnvelopeKind,
  RpcProtocol,
  RpcRouteProfile,
  RpcRouteType
} from '../../src/contract/index.js'
import { normalizeStreamPayload } from '../../src/contract/v1/stream.js'

/** Protocol 1.1 admits stream through the existing field tables. */
describe('streaming A10 envelope extension', () => {
  it('accepts a portable stream frame without changing frozen 1.0 bytes', () => {
    expect(RpcProtocol.minor).toBe(1)
    expect(RpcEnvelopeKind.stream).toBe('stream')
    const envelope = normalizeRpcEnvelope({
      kind: RpcEnvelopeKind.stream,
      id: 'stream-1',
      data: {
        route: {
          profile: RpcRouteProfile,
          type: RpcRouteType.stream,
          applicationVersion: '1',
          senderId: 'peer-a',
          targetId: 'peer-b',
          sentAt: 0
        },
        payload: { event: 'open', seq: 0 }
      }
    })
    expect(envelope.kind).toBe(RpcEnvelopeKind.stream)
    expect(envelope.data.payload).toEqual({ event: 'open', seq: 0 })
    expect(normalizeStreamPayload(envelope.data.payload)).toEqual({ event: 'open', seq: 0 })
  })

  it('negotiates 1.1 with 1.0 using the lower minor', () => {
    const current = {
      versions: [{ major: RpcProtocol.major, minor: RpcProtocol.minor }],
      codecs: ['json'],
      capabilities: ['stream@1'],
      peer: { id: 'new', runtime: 'node' }
    }
    const old = {
      versions: [{ major: 1, minor: 0 }],
      codecs: ['json'],
      capabilities: [],
      peer: { id: 'old', runtime: 'node' }
    }
    const accepted = acceptRpcHandshake(old, createRpcHello(current))
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    expect(accepted.agreement.minor).toBe(0)
    expect(accepted.agreement.capabilities).toEqual([])
    expect(completeRpcHandshake(current, accepted.reply).minor).toBe(0)
  })
})
