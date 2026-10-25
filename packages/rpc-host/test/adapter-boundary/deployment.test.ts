import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { createRpcMessageCarrier, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import type { IRpcSessionHandle } from '@migaia/rpc-contract/interfaces'
import { readRpcDefinition } from '../../dist/sdk/metadata.js'

describe('cold raw adapter deployment', () => {
  it('opens no physical resource while capturing a registered token and rejects copied tokens', () => {
    /** Physical resources remain unopened until host installation invokes the accepted recipe. */
    const open = vi.fn()
    /** Definition captures raw operations without constructing a callable Peer. */
    const adapter = defineTransportPlugin({ name: 'raw-message', namespace: 'raw', open })
    /** A token contains no claimed source or serialized channel identity. */
    const deployment = adapter
    expect(open).not.toHaveBeenCalled()
    expect(Object.isFrozen(deployment)).toBe(true)
    expect(readRpcDefinition(deployment)).toBeDefined()
    expect(readRpcDefinition(Object.freeze({ ...deployment }))).toBeUndefined()
    expect(readRpcDefinition(null)).toBeUndefined()
  })

  it('returns actual admitted channels without constructing either endpoint or Peer facade', async () => {
    /** Both sides use genuine native ports and the existing message handshake owner. */
    const ports = new MessageChannel()
    /** Reports are secondary error observations and cannot substitute for channel completion. */
    const report = vi.fn()
    /** SDK carriers own native listeners/cleanup; neither carrier invents a negotiation result. */
    const carriers = [ports.port1, ports.port2].map((port, index) =>
      createRpcMessageCarrier({
        id: `raw-${index}`,
        nativeBinary: true,
        report,
        io: {
          send(value, transfer, options) {
            options?.onWriteStart?.()
            port.postMessage(value, transfer === undefined ? undefined : [...transfer])
          },
          onMessage(listener) {
            port.on('message', listener)
            return () => {
              port.off('message', listener)
            }
          },
          onClose(listener) {
            port.on('close', listener)
            return () => {
              port.off('close', listener)
            }
          },
          close() {
            port.close()
          }
        }
      })
    )
    /** Only actual Session attachment can mint these accepted lifecycle handles. */
    const channels: IRpcSessionHandle[] = []
    /** Both real Hosts exchange the canonical hello/accept over their independent native ports. */
    const hosts = await Promise.all(
      carriers.map((carrier, index) =>
        createRpcHost({
          self: {
            name: index === 0 ? 'left' : 'right',
            instanceId: index === 0 ? 'left-instance' : 'right-instance'
          },
          report,
          plugins: [
            defineTransportPlugin({
              name: 'raw-message',
              namespace: 'raw',
              async open(context) {
                /** Native attachment provides the real readiness and peer-identity receipt. */
                const channel = context.attach(carrier, {
                  expectedPeerId: index === 0 ? 'right-instance' : 'left-instance'
                })
                channels[index] = channel
                await channel.ready
                return { dispose: () => undefined }
              }
            })
          ]
        })
      )
    )
    try {
      /** Bilateral Session readiness is the sole current owner of accepted identity. */
      const views = await Promise.all(channels.map((channel) => channel.ready))
      expect(views.map((view) => view.peerId)).toEqual(['right-instance', 'left-instance'])
      for (const carrier of carriers) {
        // BC3 retires agreement.source; real bilateral readiness proves the original explicit peer.
        expect(typeof carrier.write).toBe('function')
        expect('request' in carrier).toBe(false)
        expect('endpoint' in carrier).toBe(false)
      }
    } finally {
      await Promise.all(hosts.map((host) => host.close()))
      ports.port1.close()
      ports.port2.close()
    }
  })
})
