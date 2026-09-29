import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { connect } from '../../src/core/middleware/connect.js'
import { hooks } from '../../src/core/middleware/hooks.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import type { IRpcTransport } from '../../src/core/transport.js'
import type { IRpcHookEvent } from '../../src/core/typing.js'

describe('endpoint unknown-field report (A4)', () => {
  it('keeps processing additive route fields and warns once per admitted connection', async () => {
    const [clientWire, providerWire] = createMemoryTransportPair()
    let request: unknown
    const capture: IRpcTransport = {
      ...clientWire,
      send(message, options) {
        if ((message as { kind?: unknown }).kind === 'request') request = message
        return clientWire.send(message, options)
      }
    }
    const events: IRpcHookEvent[] = []
    let calls = 0
    const provider = await createProviderEndpoint({
      id: 'provider',
      transport: providerWire,
      middlewares: [
        connect({ transport: providerWire }),
        hooks({ listeners: (event) => void events.push(event) })
      ],
      provider: { count: (context) => context.success(++calls) }
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: capture,
      middlewares: [connect({ transport: capture })]
    })
    try {
      expect(await client.send('provider', 'count', null)).toBe(1)
      const frame = request as {
        readonly kind: string
        readonly id: string
        readonly data: { readonly route: Record<string, unknown> }
      }
      for (let index = 0; index < 3; index += 1)
        await clientWire.send({
          ...frame,
          id: `extra-${index}`,
          data: { ...frame.data, route: { ...frame.data.route, x: index } }
        })
      await vi.waitFor(() => expect(calls).toBe(4))
      expect(events.filter((event) => event.name === 'protocol.unknown-field')).toEqual([
        expect.objectContaining({ field: 'request/data/route#x' })
      ])
    } finally {
      await client.dispose()
      await provider.dispose()
    }
  })
})
