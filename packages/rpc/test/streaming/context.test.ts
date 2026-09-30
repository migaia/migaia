import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { ProviderExecutor } from '../../src/core/internal/provider-executor.js'
import { connect } from '../../src/core/middleware/connect.js'
import type { IRpcContext } from '../../src/core/typing.js'
import { streamRoots } from './fixture.js'

describe('streaming K185 provider context', () => {
  it('passes the core-created stream context by identity and isolates ordinary requests', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const contextCreation = vi.spyOn(ProviderExecutor.prototype, 'createContext')
    const server = await createComposedEndpoint(
      {
        id: 'server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport })]
      },
      streamRoots()
    )
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport })]
      },
      streamRoots()
    )
    let ordinaryContext: IRpcContext | undefined
    let streamContext: IRpcContext | undefined
    server.provide('ordinary', (context) => {
      ordinaryContext = context
      return context.success('ok')
    })
    server.stream.provide('stream', (params, { signal, context }) => {
      streamContext = context
      expect(context.signal).toBe(signal)
      expect(context.data).toEqual(params)
      expect(typeof context.dispatchTo).toBe('function')
      return (function* () {
        yield 'item'
      })()
    })
    try {
      expect(await client.send('server', 'ordinary', { kind: 'ordinary' })).toBe('ok')
      const iterator = client.stream.open('server', 'stream', { kind: 'stream' })
      expect(await iterator.next()).toEqual({ done: false, value: 'item' })
      expect(streamContext).toBeDefined()
      expect(streamContext).not.toBe(ordinaryContext)
      const coreContext = contextCreation.mock.results
        .map((result) => result.value as IRpcContext)
        .find((context) => (context.data as { kind?: string })?.kind === 'stream')
      expect(streamContext).toBe(coreContext)
      expect(ordinaryContext).not.toBe(coreContext)
      await iterator.return?.()
    } finally {
      await client.dispose()
      await server.dispose()
      contextCreation.mockRestore()
    }
  })
})
