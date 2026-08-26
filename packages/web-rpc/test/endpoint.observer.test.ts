import { describe, expect, it } from 'vitest'
import { createFullEndpoint } from '../src/full.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { readEndpointDebugSnapshot } from '../src/internal/test-observer.js'
import { connect } from '../src/middleware/connect.js'
import { fullRuntimeOwnerKeys } from './fixtures/tree-shaking/runtime-owner-topology.js'

describe('endpoint test-only lifecycle observer', () => {
  it('proves request and registry resources return to zero after disposal', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createFullEndpoint({
      id: 'server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success(context.data) }
    })
    const client = await createFullEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    })

    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'active',
      pending: 0,
      pingPending: 0,
      activeControllers: 0,
      chunks: 0,
      owners: fullRuntimeOwnerKeys
    })
    await expect(client.send('server', 'echo', 'value')).resolves.toBe('value')
    await client.dispose()
    await server.dispose()

    expect(readEndpointDebugSnapshot(client)).toMatchObject({
      phase: 'disposed',
      pending: 0,
      pingPending: 0,
      activeControllers: 0,
      chunks: 0,
      providers: 0,
      events: 0,
      hooks: 0,
      resources: 0,
      discovery: {
        local: 0,
        remote: 0,
        waiters: 0,
        tasks: 0,
        timers: 0,
        manualWaiters: 0,
        inboundQueries: 0,
        inboundTimers: 0
      }
    })
  })
})
