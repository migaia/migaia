import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../src/adapters/memory'
import { createEndpoint } from '../src/index'
import { authentication } from '../src/middleware/authentication'
import { connect } from '../src/middleware/connect'
import type { IWebRpcTransport } from '../src/transport'

/** Creates deterministic signed envelopes for integration tests. */
const signed = () =>
  authentication({
    sign: (value) => ({ value, signature: 'trusted' }),
    verify: (frame) => {
      const candidate = frame as { value?: unknown; signature?: string }
      if (candidate.signature !== 'trusted') throw new Error('invalid signature')
      return candidate.value
    }
  })

describe('authentication integration', () => {
  it('protects request and response frames without changing contract data', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createEndpoint({
      id: 'server',
      transport: serverTransport,
      provider: { echo: (context) => context.success(context.data) },
      middlewares: [connect({ transport: serverTransport }), signed()]
    })
    const client = await createEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), signed()]
    })
    await expect(client.send('server', 'echo', { clean: true })).resolves.toEqual({ clean: true })
    await client.dispose()
    await server.dispose()
  })

  it('rejects a forged frame before provider execution', async () => {
    const [clientBase, serverTransport] = createMemoryTransportPair()
    let providerCalls = 0
    const forgedTransport: IWebRpcTransport = {
      ...clientBase,
      send: (value, options) =>
        clientBase.send({ ...(value as object), signature: 'forged' }, options)
    }
    const server = await createEndpoint({
      id: 'server',
      transport: serverTransport,
      provider: {
        echo: (context) => {
          providerCalls += 1
          return context.success(context.data)
        }
      },
      middlewares: [connect({ transport: serverTransport }), signed()]
    })
    const client = await createEndpoint({
      id: 'client',
      transport: forgedTransport,
      middlewares: [connect({ transport: forgedTransport }), signed()]
    })
    await expect(client.send('server', 'echo', 'forged', { timeoutMs: 5 })).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED'
    })
    expect(providerCalls).toBe(0)
    await client.dispose()
    await server.dispose()
  })

  it('rejects unauthenticated transfer lists', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createEndpoint({
      id: 'server',
      transport: serverTransport,
      provider: { echo: (context) => context.success(context.data) },
      middlewares: [connect({ transport: serverTransport }), signed()]
    })
    const client = await createEndpoint({
      id: 'client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), signed()]
    })
    await expect(
      client.send('server', 'echo', 'data', { transfer: [{}], timeoutMs: 100 })
    ).rejects.toMatchObject({ code: 'AUTHENTICATION_FAILED' })
    await client.dispose()
    await server.dispose()
  })
})
