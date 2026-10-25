import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'

import { connect } from '../../dist/core/middleware/connect.js'
import { hooks } from '../../dist/core/middleware/hooks.js'
import type { IRpcHookEvent } from '../../dist/core/typing.js'

/** Capacity diagnostics exercise real owners and retain the existing RPC refusal behavior. */
describe('local replay capacity reports', () => {
  it('does not report a cached rejection after actual capacity has returned', async () => {
    /** Expiry can free an accepted tombstone while a later rejected identity remains cached. */
    const scheduler = createManualScheduler()
    /** Real frames are retained only as fixture data for repeating the rejected request. */
    const frames: unknown[] = []
    /** Capacity diagnostics must describe actual limits, not every replay admission false. */
    const events: IRpcHookEvent[] = []
    /** All requests use canonical verified memory peer binding. */
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    /** Default 310-second retention is preserved, with a small existing per-peer option. */
    const server = await createRuntimeEndpointComposition(
      {
        id: 'cached-server',
        transport: serverTransport,
        scheduler,
        providerLimits: { maxReplayEntriesPerPeer: 1 },
        provider: { echo: (context) => context.success(context.data) },
        middlewares: [
          connect({ transport: serverTransport }),
          hooks({
            listeners: (event) => {
              if (event.detail) events.push(event)
            }
          })
        ]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    /** Caller replay clock stays independent from this server's controlled expiry. */
    const client = await createRuntimeEndpointComposition(
      {
        id: 'cached-client',
        transport: clientTransport,
        targetIds: ['cached-server'],
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    /** Records exact incoming frames so repeated identity uses the actual production route. */
    const unsubscribe = serverTransport.subscribe(({ data }) => frames.push(data))
    /** Raw response count lets the unowned repeated response settle before the assertion. */
    const responses: unknown[] = []
    const unsubscribeResponses = clientTransport.subscribe(({ data }) => responses.push(data))
    try {
      await client.send('cached-server', 'echo', null)
      scheduler.advance(309_000)
      await expect(client.send('cached-server', 'echo', null)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      scheduler.advance(500)
      await expect(client.send('cached-server', 'echo', null)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(events).toHaveLength(1)
      scheduler.advance(500)
      await clientTransport.send(frames[2])
      await vi.waitFor(() => expect(responses).toHaveLength(4))
      expect(responses[3]).toMatchObject({ code: 'OVERLOADED', message: 'Provider failed' })
      expect(events).toHaveLength(1)
      await expect(client.send('cached-server', 'echo', 'capacity-returned')).resolves.toBe(
        'capacity-returned'
      )
    } finally {
      unsubscribe()
      unsubscribeResponses()
      await client.dispose()
      await server.dispose()
    }
  })
})
