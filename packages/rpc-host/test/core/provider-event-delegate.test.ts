import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { describe, expect, it } from 'vitest'

import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { connect } from '../../dist/core/middleware/connect.js'

describe('provider event dispatch delegate', () => {
  it('delivers dispatch-only frames to the provider-owned listener registry', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createRuntimeEndpointComposition(
      {
        id: 'event-server',
        transport: serverTransport,
        targetIds: ['event-client'],
        middlewares: [connect({ transport: serverTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'event-client',
        transport: clientTransport,
        targetIds: ['event-server'],
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
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
