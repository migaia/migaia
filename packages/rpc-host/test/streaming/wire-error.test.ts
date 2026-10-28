/** Original stream error graphs cross actual public namespaces and the canonical shared wire owner. */
import { describe, expect, it } from 'vitest'
import { RpcError } from '@migaia/rpc-contract/errors'
import { RpcStreamEvent } from '@migaia/rpc-contract'
import type { IRpcContext } from '@migaia/rpc-host'
import type { IAbortSignal } from '@migaia/utils/promise'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { connectedCoreHosts } from '../host/core-fixture.ts'

/** Preserves delivered values and then a sticky restored failure graph. */
describe('streaming error graph', () => {
  it('keeps a business CANCELLED label as a failed terminal without aborting its provider signal', async () => {
    /** A public business error label grants no native cancellation or cached terminal authority. */
    const original = new RpcError(
      RpcCoreErrorCode.cancelled,
      'business-labelled cancellation',
      new TypeError('business cause')
    )
    /** This is the real provider invocation's original signal, not a caller substitute. */
    let signal: IAbortSignal | undefined
    /** The existing native pair owns actual public stream dispatch, restore and cleanup. */
    const fixture = await connectedCoreHosts(
      {
        labelled: function* (_payload: unknown, context: IRpcContext) {
          signal = context.signal
          throw original
        }
      },
      {},
      () => undefined
    )
    try {
      /** The genuine lazy iterator starts the original business and receives its exact diagnostic. */
      const iterator = fixture.b.memory.stream('labelled') as AsyncIterableIterator<unknown>
      await expect(iterator.next()).rejects.toMatchObject({
        code: RpcCoreErrorCode.cancelled,
        message: original.message,
        stack: original.stack,
        cause: { name: 'TypeError', message: 'business cause' }
      })
      /** Original semantic write data already passed the codec; observation performs no decode. */
      const terminal = fixture.pair[0].written.find(
        (frame) => frame.kind === 'stream' && frame.stream.event !== RpcStreamEvent.open
      )
      expect(terminal).toMatchObject({ kind: 'stream', stream: { event: 'fail' } })
      expect(signal?.aborted).toBe(false)
    } finally {
      await fixture.close()
    }
  })

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
