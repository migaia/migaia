import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { defineMessageAdapter } from '../../dist/runtime-adapter/definition.js'
import { readAdapterDeployment } from '../../dist/runtime-adapter/deployment.js'
import { prepareRuntimePeerSourceContext } from '../../dist/remote/runtime-api/peer.js'

describe('cold raw adapter deployment', () => {
  it('opens no physical resource while capturing a registered token and rejects copied tokens', () => {
    /** Physical resources remain unopened until host installation invokes the accepted recipe. */
    const open = vi.fn()
    /** Definition captures raw operations without constructing a callable Peer. */
    const adapter = defineMessageAdapter({ open })
    /** A token contains no claimed source or serialized channel identity. */
    const deployment = adapter.deployment({ connect: 'raw-port' })
    expect(open).not.toHaveBeenCalled()
    expect(Object.isFrozen(deployment)).toBe(true)
    expect(readAdapterDeployment(deployment)).toBeDefined()
    expect(readAdapterDeployment(Object.freeze({ ...deployment }))).toBeUndefined()
    expect(readAdapterDeployment(null)).toBeUndefined()
  })

  it('returns actual admitted channels without constructing either endpoint or Peer facade', async () => {
    /** Both sides use genuine native ports and the existing message handshake owner. */
    const ports = new MessageChannel()
    /** Raw operation definitions retain their concrete port input. */
    const adapter = defineMessageAdapter({ open: (port: typeof ports.port1) => port })
    /** Each deployment captures only its own physical input and remote physical address. */
    const left = adapter.deployment({ connect: ports.port1, peerId: 'right-instance' })
    /** The second deployment shares operations but no opened connection state. */
    const right = adapter.deployment({ connect: ports.port2, peerId: 'left-instance' })
    /** Reports are secondary error observations and cannot substitute for channel completion. */
    const report = vi.fn()
    /** These are the original compiled local offers, not asserted accepted agreements. */
    const channels = await Promise.all([
      readAdapterDeployment(left)!.open({
        ...prepareRuntimePeerSourceContext({ name: 'left', instanceId: 'left-instance' }),
        connectTimeoutMs: 500,
        report
      }),
      readAdapterDeployment(right)!.open({
        ...prepareRuntimePeerSourceContext({ name: 'right', instanceId: 'right-instance' }),
        connectTimeoutMs: 500,
        report
      })
    ])
    try {
      expect(channels.map((channel) => channel.peerId)).toEqual(['right-instance', 'left-instance'])
      for (const channel of channels) {
        // Explicit peerId preserves the original adapter's static admission path.
        expect(channel.agreement.source).toBe('static')
        expect(typeof channel.transport.send).toBe('function')
        expect('request' in channel).toBe(false)
        expect('endpoint' in channel).toBe(false)
      }
    } finally {
      await Promise.all(channels.map((channel) => channel.close()))
      ports.port1.close()
      ports.port2.close()
    }
  })
})
