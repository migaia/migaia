import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { connect } from '../../src/core/middleware/connect.js'
import { streamRoots } from './fixture.js'

/** A9 delivers no old item twice after the canonical transport reports disconnection. */
describe('streaming A9 disconnect', () => {
  it('ends the pending and future pulls with one sticky unknown-result error', async () => {
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
    let resume!: () => void
    const blocked = new Promise<void>((resolve) => {
      resume = resolve
    })
    server.stream.provide('count', async function* () {
      yield 'a'
      await blocked
      yield 'b'
    })
    try {
      const iterator = client.stream.open('server', 'count', null)
      expect(await iterator.next()).toEqual({ done: false, value: 'a' })
      const pending = iterator.next()
      serverTransport.close()
      let failure: unknown
      try {
        await pending
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({ code: 'STREAM_RESULT_UNKNOWN' })
      await expect(iterator.next()).rejects.toBe(failure)
      resume()
    } finally {
      resume()
      await client.dispose()
      await server.dispose()
    }
  })
})
