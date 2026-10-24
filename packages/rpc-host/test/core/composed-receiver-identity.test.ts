import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { describe, expect, it } from 'vitest'

import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { RpcRouteProfile, type IRpcRequestEnvelope } from '@migaia/rpc-contract'

/** Proves composed provider admission rejects frames not addressed to its receiver identity. */
describe('composed receiver identity admission', () => {
  it('rejects absent, foreign, and forged receiver identities before provider execution', async () => {
    const [clientTransport, providerTransport] = createMemoryTransportPair()
    let executions = 0
    const provider = await createRuntimeEndpointComposition(
      {
        id: 'receiver-provider',
        transport: providerTransport,
        middlewares: [
          connect({
            transport: providerTransport,
            useBaseIdVerifyOnly: false,
            identifier: async ({ senderId }) => senderId === 'receiver-client'
          })
        ]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    provider.provide('count', (context) => {
      executions += 1
      return context.success(null)
    })
    const client = await createRuntimeEndpointComposition(
      {
        id: 'receiver-client',
        targetIds: ['receiver-provider'],
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    try {
      await client.send('receiver-provider', 'count', null)
      expect(executions).toBe(1)
      const base: IRpcRequestEnvelope = {
        kind: 'request',
        id: 'forged-task',
        method: 'count',
        data: {
          route: {
            profile: RpcRouteProfile,
            type: 'request',
            applicationVersion: '1.0',
            senderId: 'someone-else',
            targetId: 'receiver-provider',
            dispatchOnly: true,
            sentAt: Date.now()
          },
          payload: null
        }
      }
      /** Every forged frame changes only the receiver selector under the canonical route. */
      const baseData = base.data
      for (const frame of [
        base,
        {
          ...base,
          data: { ...baseData, route: { ...baseData.route, receiverId: 'foreign-provider' } }
        },
        {
          ...base,
          data: { ...baseData, route: { ...baseData.route, receiverId: 'receiver-provider' } }
        }
      ])
        clientTransport.send(frame)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(executions).toBe(1)
    } finally {
      await Promise.all([client.dispose(), provider.dispose()])
    }
  })
})
