import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createEndpoint } from '../../src/core/index.js'
import { connect } from '../../src/core/middleware/connect.js'
import { RpcRouteProfile, RpcRouteType } from '../../src/contract/index.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { streamRoots } from './fixture.js'

/** A recognized stream kind without an installed route is a protocol failure. */
describe('streaming A2 unclaimed route', () => {
  it('rejects a peer without stream@1 before sending an initial request', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let sent = 0
    const counted = {
      ...clientTransport,
      send(message: unknown) {
        sent += 1
        return clientTransport.send(message)
      }
    }
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: counted,
        middlewares: [connect({ transport: counted })]
      },
      streamRoots({ supports: () => false })
    )
    const server = await createComposedEndpoint(
      {
        id: 'server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport })]
      },
      streamRoots()
    )
    try {
      await expect(client.stream.open('server', 'count', null).next()).rejects.toMatchObject({
        code: 'CAPABILITY_CONFLICT'
      })
      expect(sent).toBe(0)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('reports one protocol failure for an admitted stream frame', async () => {
    const [transport, peer] = createMemoryTransportPair()
    const endpoint = await createEndpoint({
      id: 'local',
      transport,
      middlewares: [connect({ transport })]
    })
    const failures: unknown[] = []
    endpoint.hooks.on((event) => {
      if (event.name === 'failure') failures.push(event.error)
    })
    try {
      await peer.send({
        kind: 'stream',
        id: 'stream-1',
        data: {
          route: {
            profile: RpcRouteProfile,
            type: RpcRouteType.stream,
            applicationVersion: '1',
            senderId: 'peer',
            targetId: 'local',
            sentAt: 0
          },
          payload: { event: 'open', seq: 0 }
        }
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(failures).toHaveLength(1)
      expect(failures[0]).toMatchObject({ code: 'PROTOCOL_INVALID' })
    } finally {
      await endpoint.dispose()
    }
  })
})
