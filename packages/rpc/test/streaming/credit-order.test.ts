import { describe, expect, it } from 'vitest'
import { RpcRouteProfile } from '../../src/contract/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { connect } from '../../src/core/middleware/connect.js'
import { streamRoots } from './fixture.js'

/** A3 wrong-credit item must fail only its pending caller pull. */
describe('streaming A3 credit order', () => {
  it('rejects an item with a sequence different from the pending pull', async () => {
    const [clientTransport, peer] = createMemoryTransportPair()
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: clientTransport,
        targetIds: ['server'],
        middlewares: [connect({ transport: clientTransport })]
      },
      streamRoots()
    )
    const peerSend = (id: string, event: string, seq: number, value?: string): void => {
      void peer.send({
        kind: 'stream',
        id,
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'stream',
            applicationVersion: '1.0',
            senderId: 'server',
            targetId: 'client',
            sentAt: 0
          },
          payload: { event, seq, ...(value === undefined ? {} : { value }) }
        }
      })
    }
    const unsubscribe = peer.subscribe(({ data }) => {
      const frame = data as { kind?: string; id?: string; data?: { payload?: { event?: string } } }
      if (frame.kind === 'request' && frame.id) peerSend(frame.id, 'open', 0)
      if (frame.kind === 'stream' && frame.id && frame.data?.payload?.event === 'pull')
        peerSend(frame.id, 'item', 2, 'wrong')
    })
    try {
      await expect(client.stream.open('server', 'count', null).next()).rejects.toMatchObject({
        code: 'INVALID_STREAM',
        violation: 'seq',
        pointer: '/seq'
      })
    } finally {
      unsubscribe()
      await client.dispose()
    }
  })
})
