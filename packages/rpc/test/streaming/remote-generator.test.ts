import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { connect } from '../../src/core/middleware/connect.js'
import { streamRoots } from './fixture.js'

/** A1 requires one producer next for each caller pull and preserves the generator return value. */
describe('streaming A1 remote generators', () => {
  it('delivers three values lazily from a synchronous generator', async () => {
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
    let produced = 0
    server.stream.provide('count', function* () {
      for (const value of ['a', 'b', 'c']) {
        produced += 1
        yield value
      }
      return 'r'
    })
    server.stream.provide('asyncCount', async function* () {
      yield 1
      yield 2
      return 3
    })
    server.stream.provide('invalid', (() => 'not iterable') as never)
    try {
      const iterator = client.stream.open('server', 'count', null)
      expect(produced).toBe(0)
      expect(await iterator.next()).toEqual({ done: false, value: 'a' })
      expect(produced).toBe(1)
      expect(await iterator.next()).toEqual({ done: false, value: 'b' })
      expect(produced).toBe(2)
      expect(await iterator.next()).toEqual({ done: false, value: 'c' })
      expect(produced).toBe(3)
      expect(await iterator.next()).toEqual({ done: true, value: 'r' })
      const asyncIterator = client.stream.open('server', 'asyncCount', null)
      expect(await asyncIterator.next()).toEqual({ done: false, value: 1 })
      expect(await asyncIterator.next()).toEqual({ done: false, value: 2 })
      expect(await asyncIterator.next()).toEqual({ done: true, value: 3 })
      await expect(client.stream.open('server', 'invalid', null).next()).rejects.toMatchObject({
        code: 'PAYLOAD_INVALID'
      })
      expect(() =>
        server.stream.provide('count', function* () {
          yield 0
        })
      ).toThrow(expect.objectContaining({ code: 'PROVIDER_DUPLICATED' }))
      expect(() => server.provide('count', (context) => context.success('wrong'))).toThrow(
        expect.objectContaining({ code: 'PROVIDER_DUPLICATED' })
      )
      const unopened = client.stream.open('server', 'count', null)
      expect(await unopened.return?.()).toEqual({ done: true, value: undefined })
      const reason = new Error('local stop')
      await expect(client.stream.open('server', 'count', null).throw?.(reason)).rejects.toBe(reason)
      const active = client.stream.open('server', 'count', null)
      expect(await active.next()).toEqual({ done: false, value: 'a' })
      await client.stream.dispose()
      await expect(active.next()).rejects.toMatchObject({ code: 'CANCELLED' })
      await server.stream.dispose()
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
