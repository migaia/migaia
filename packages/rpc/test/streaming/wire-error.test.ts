import { describe, expect, it } from 'vitest'
import { RpcCoreErrorCode, RpcError } from '../../src/core/errors.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { connect } from '../../src/core/middleware/connect.js'
import { streamRoots } from './fixture.js'

/** A5 preserves delivered values and then a sticky restored failure graph. */
describe('streaming A5 error graph', () => {
  it('retains the producer cause and rejects later next with the same remote instance', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
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
    const original = new RpcError(RpcCoreErrorCode.internal, 'producer failed', new Error('root'))
    server.stream.provide('fail', function* () {
      yield 'a'
      yield 'b'
      throw original
    })
    try {
      const iterator = client.stream.open('server', 'fail', null)
      expect(await iterator.next()).toEqual({ done: false, value: 'a' })
      expect(await iterator.next()).toEqual({ done: false, value: 'b' })
      let failure: unknown
      try {
        await iterator.next()
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        source: '@migaia/rpc/core',
        code: 'INTERNAL',
        name: 'RpcError',
        message: 'producer failed',
        cause: { message: 'root' }
      })
      expect((failure as Error).stack).toBe(original.stack)
      await expect(iterator.next()).rejects.toBe(failure)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('keeps the producer failure first when iterator cleanup also fails', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
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
    const primary = new RpcError(RpcCoreErrorCode.internal, 'primary')
    const cleanup = new Error('cleanup')
    server.stream.provide('cleanup-fail', () => ({
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          throw primary
        },
        return: async () => {
          throw cleanup
        }
      })
    }))
    try {
      const iterator = client.stream.open('server', 'cleanup-fail', null)
      let received: unknown
      try {
        await iterator.next()
      } catch (error) {
        received = error
      }
      expect(received).toBeInstanceOf(AggregateError)
      expect((received as AggregateError).errors[0]).toMatchObject({
        source: '@migaia/rpc/core',
        code: 'INTERNAL',
        message: primary.message,
        stack: primary.stack
      })
      expect((received as AggregateError).errors[1]).toMatchObject({
        message: cleanup.message,
        stack: cleanup.stack
      })
      await expect(iterator.next()).rejects.toBe(received)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('transfers a 64 KiB stack under wire-error limits rather than the item budget', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
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
    const original = {
      source: '@migaia/rpc/core',
      code: RpcCoreErrorCode.internal,
      name: 'RpcError',
      message: 'large trace',
      stack: 's'.repeat(65_536)
    }
    server.stream.provide('large-trace', function* () {
      throw original
    })
    try {
      await expect(client.stream.open('server', 'large-trace', null).next()).rejects.toMatchObject({
        code: 'INTERNAL',
        stack: original.stack
      })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
