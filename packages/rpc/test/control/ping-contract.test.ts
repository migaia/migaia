import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope, RpcControl } from '../../src/contract/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createEndpoint } from '../../src/core/index.js'
import { connect } from '../../src/core/middleware/connect.js'
import { hooks } from '../../src/core/middleware/hooks.js'
import { ping } from '../../src/core/middleware/ping.js'
import type { IRpcHookEvent } from '../../src/core/typing.js'
import type { IRpcTransport } from '../../src/core/transport.js'

describe('ping and unknown variation controls (A2)', () => {
  it('exchanges a ping/pong pair and reports unknown controls once per connection', async () => {
    const [clientWire, serverWire] = createMemoryTransportPair()
    const sent: unknown[] = []
    /** Observe both directions without changing the memory transport delivery contract. */
    const captureClient: IRpcTransport = {
      ...clientWire,
      send(message, options) {
        sent.push(message)
        return clientWire.send(message, options)
      }
    }
    const captureServer: IRpcTransport = {
      ...serverWire,
      send(message, options) {
        sent.push(message)
        return serverWire.send(message, options)
      }
    }
    const events: IRpcHookEvent[] = []
    const server = await createEndpoint({
      id: 'server',
      transport: captureServer,
      middlewares: [
        connect({ transport: captureServer }),
        ping(),
        hooks({ listeners: (event) => void events.push(event) })
      ] as const
    })
    const client = await createEndpoint({
      id: 'client',
      transport: captureClient,
      middlewares: [connect({ transport: captureClient }), ping()] as const
    })
    try {
      expect(await client.ping('server', undefined, { timeoutMs: 100 })).toBe(true)
      const controls = sent
        .map((frame) => normalizeRpcEnvelope(frame))
        .filter((frame) => frame.kind === 'variation')
      expect(controls.map((frame) => frame.data.route.variation)).toEqual([
        RpcControl.ping,
        RpcControl.pong
      ])
      expect(controls[0]?.id).toBe(controls[1]?.id)
      const first = controls[0]
      expect(first?.kind).toBe('variation')
      if (first?.kind !== 'variation') return
      const unknown = {
        ...first,
        id: 'reboot-1',
        data: { ...first.data, route: { ...first.data.route, variation: 'reboot' } }
      }
      await clientWire.send(unknown)
      await clientWire.send({ ...unknown, id: 'reboot-2' })
      await vi.waitFor(() => {
        expect(events.filter((event) => event.name === 'protocol.unknown-field')).toEqual([
          expect.objectContaining({ field: 'variation:reboot' })
        ])
      })
      expect(events.filter((event) => event.name === 'failure')).toHaveLength(0)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
