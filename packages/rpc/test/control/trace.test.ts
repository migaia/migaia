import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { connect } from '../../src/core/middleware/connect.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import type { IRpcTransport } from '../../src/core/transport.js'

describe('opaque trace propagation (A8)', () => {
  it('passes trace to the provider and rejects invalid values before sending', async () => {
    const [clientWire, providerWire] = createMemoryTransportPair()
    const sent: unknown[] = []
    const capture: IRpcTransport = {
      ...clientWire,
      send(message, options) {
        sent.push(message)
        return clientWire.send(message, options)
      }
    }
    const provider = await createProviderEndpoint({
      id: 'provider',
      transport: providerWire,
      targetIds: ['client'],
      middlewares: [connect({ transport: providerWire })],
      provider: { trace: (context) => context.success(context.trace ?? null) }
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: capture,
      targetIds: ['provider'],
      middlewares: [connect({ transport: capture })]
    })
    try {
      expect(await client.send('provider', 'trace', null, { trace: '00-abc-01' })).toBe('00-abc-01')
      expect(await client.send('provider', 'trace', null)).toBeNull()
      const prior = sent.length
      expect(() => client.send('provider', 'trace', null, { trace: 'x'.repeat(257) })).toThrow(
        expect.objectContaining({ code: 'CONTRACT_INVALID' })
      )
      expect(() => client.send('provider', 'trace', null, { trace: 'x\ny' })).toThrow(
        expect.objectContaining({ code: 'CONTRACT_INVALID' })
      )
      expect(sent).toHaveLength(prior)
    } finally {
      await client.dispose()
      await provider.dispose()
    }
  })
})
