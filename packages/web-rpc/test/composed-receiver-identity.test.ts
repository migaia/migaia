import { describe, expect, it } from 'vitest'
import { createClientEndpoint } from '../src/client.js'
import { createProviderEndpoint } from '../src/provider.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { connect } from '../src/middleware/connect.js'
import type { IRpcRequestEnvelope } from '@migaia/rpc-contract'

/** Proves composed provider admission rejects frames not addressed to its receiver identity. */
describe('composed receiver identity admission', () => {
  it('rejects absent, foreign, and forged receiver identities before provider execution', async () => {
    const [clientTransport, providerTransport] = createMemoryTransportPair()
    let executions = 0
    const provider = await createProviderEndpoint({
      id: 'receiver-provider',
      transport: providerTransport,
      middlewares: [
        connect({
          transport: providerTransport,
          useBaseIdVerifyOnly: false,
          identifier: async ({ senderId }) => senderId === 'receiver-client'
        })
      ]
    })
    provider.provide('count', (context) => {
      executions += 1
      return context.success(null)
    })
    const client = await createClientEndpoint({
      id: 'receiver-client',
      targetIds: ['receiver-provider'],
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    })
    try {
      await client.send('receiver-provider', 'count', null)
      expect(executions).toBe(1)
      const base: IRpcRequestEnvelope = {
        kind: 'request',
        id: 'forged-task',
        method: 'count',
        data: {
          webRpc: {
            profile: 'web-rpc.route.v1',
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
      /** Test fixture is a known routing record despite IRpcEnvelope's portable-value union. */
      const baseData = base.data as { readonly webRpc: Record<string, unknown> }
      for (const frame of [
        base,
        {
          ...base,
          data: { ...baseData, webRpc: { ...baseData.webRpc, receiverId: 'foreign-provider' } }
        },
        {
          ...base,
          data: { ...baseData, webRpc: { ...baseData.webRpc, receiverId: 'receiver-provider' } }
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
