import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'

import { connect } from '../../dist/core/middleware/connect.js'

import type { IRpcTransport } from '../../dist/core/transport.js'

describe('opaque trace propagation', () => {
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
    const provider = await createRuntimeEndpointComposition(
      {
        id: 'provider',
        transport: providerWire,
        targetIds: ['client'],
        middlewares: [connect({ transport: providerWire })],
        provider: { trace: (context) => context.success(context.trace ?? null) }
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client',
        transport: capture,
        targetIds: ['provider'],
        middlewares: [connect({ transport: capture })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
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
