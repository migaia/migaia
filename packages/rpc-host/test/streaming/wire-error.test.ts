/** Original stream error graphs cross actual public namespaces and the canonical shared wire owner. */
import { describe, expect, it } from 'vitest'
import { RpcError } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { connectedCoreHosts } from '../host/core-fixture.js'

/** Preserves delivered values and then a sticky restored failure graph. */
describe('streaming error graph', () => {
  it('retains the producer cause and rejects later next with the same remote instance', async () => {
    const original = new RpcError(RpcCoreErrorCode.internal, 'producer failed', new Error('root'))
    /** The actual provider is compiled before this pair's one native handshake. */
    const { a: server, b: client } = await connectedCoreHosts(
      {
        fail: function* () {
          yield 'a'
          yield 'b'
          throw original
        }
      },
      {},
      () => undefined
    )
    try {
      const iterator = client.memory.stream('fail', null) as AsyncIterableIterator<unknown>
      expect(await iterator.next()).toEqual({ done: false, value: 'a' })
      expect(await iterator.next()).toEqual({ done: false, value: 'b' })
      let failure: unknown
      try {
        await iterator.next()
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({
        source: 'rpc.endpoint',
        code: 'INTERNAL',
        name: 'RpcError',
        message: 'producer failed',
        cause: { message: 'root' }
      })
      expect((failure as Error).stack).toBe(original.stack)
      await expect(iterator.next()).rejects.toBe(failure)
    } finally {
      await client.close()
      await server.close()
    }
  })

  it('keeps the producer failure first when iterator cleanup also fails', async () => {
    const primary = new RpcError(RpcCoreErrorCode.internal, 'primary')
    const cleanup = new Error('cleanup')
    /** One provider iteration exposes its original failing next and return operations. */
    const producer = {
      next: async () => {
        throw primary
      },
      return: async () => {
        throw cleanup
      }
    }
    /** The fixture owns only native iteration; production owns stream protocol and cleanup. */
    const iterable = { [Symbol.asyncIterator]: () => producer }
    /** Provider execution and iterator return keep their separate exact original failures. */
    const { a: server, b: client } = await connectedCoreHosts(
      {
        'cleanup-fail': () => iterable
      },
      {},
      () => undefined
    )
    try {
      const iterator = client.memory.stream('cleanup-fail', null) as AsyncIterableIterator<unknown>
      let received: unknown
      try {
        await iterator.next()
      } catch (error) {
        received = error
      }
      expect(received).toBeInstanceOf(AggregateError)
      expect((received as AggregateError).errors[0]).toMatchObject({
        source: 'rpc.endpoint',
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
      await client.close()
      await server.close()
    }
  })

  it('transfers a 64 KiB stack under wire-error limits rather than the item budget', async () => {
    const original = {
      source: 'rpc.endpoint',
      code: RpcCoreErrorCode.internal,
      name: 'RpcError',
      message: 'large trace',
      stack: 's'.repeat(65_536)
    }
    /** One real Session carries the original error graph outside the item byte budget. */
    const { a: server, b: client } = await connectedCoreHosts(
      {
        'large-trace': function* () {
          throw original
        }
      },
      {},
      () => undefined
    )
    try {
      await expect(
        (client.memory.stream('large-trace', null) as AsyncIterableIterator<unknown>).next()
      ).rejects.toMatchObject({
        code: 'INTERNAL',
        stack: original.stack
      })
    } finally {
      await client.close()
      await server.close()
    }
  })
})
