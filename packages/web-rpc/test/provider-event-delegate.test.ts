import { describe, expect, it } from 'vitest'
import { createClientEndpoint } from '../src/client.js'
import { createProviderEndpoint } from '../src/provider.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { connect } from '../src/middleware/connect.js'

describe('provider event dispatch delegate', () => {
  it('delivers dispatch-only frames to the provider-owned listener registry', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createProviderEndpoint({
      id: 'event-server',
      transport: serverTransport,
      targetIds: ['event-client'],
      middlewares: [connect({ transport: serverTransport })]
    })
    const client = await createClientEndpoint({
      id: 'event-client',
      transport: clientTransport,
      targetIds: ['event-server'],
      middlewares: [connect({ transport: clientTransport })]
    })
    const frames: unknown[] = []
    const release = server.on('serialize.frame', (context) => {
      frames.push(context.data)
    })
    try {
      client.dispatch('event-server', 'serialize.frame', { sequence: 4, kind: 'chunk' })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(frames).toEqual([{ sequence: 4, kind: 'chunk' }])
    } finally {
      release()
      await client.dispose()
      await server.dispose()
    }
  })
})
