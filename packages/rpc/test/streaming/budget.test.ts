import { describe, expect, it } from 'vitest'
import { measurePortableStreamValue, RpcStreamLimit } from '../../src/contract/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { connect } from '../../src/core/middleware/connect.js'
import { streamRoots } from './fixture.js'

/** A6 compares the portable value budget with producer-side rejection before sending. */
describe('streaming A6 portable value budget', () => {
  it('accepts exactly 16 KiB and rejects the next byte and undefined yields', async () => {
    expect(measurePortableStreamValue('x'.repeat(16382))).toBe(RpcStreamLimit.maxItemValueBytes)
    expect(measurePortableStreamValue('x'.repeat(16383))).toBe(RpcStreamLimit.maxItemValueBytes + 1)
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
    server.stream.provide('exact', function* () {
      yield 'x'.repeat(16382)
    })
    server.stream.provide('exceed', function* () {
      yield 'x'.repeat(16383)
    })
    server.stream.provide('undefined', function* () {
      yield undefined as never
    })
    try {
      const exact = client.stream.open('server', 'exact', null)
      expect(await exact.next()).toEqual({ done: false, value: 'x'.repeat(16382) })
      expect(await exact.next()).toEqual({ done: true, value: undefined })
      await expect(client.stream.open('server', 'exceed', null).next()).rejects.toMatchObject({
        code: 'PAYLOAD_INVALID'
      })
      await expect(client.stream.open('server', 'undefined', null).next()).rejects.toMatchObject({
        code: 'PAYLOAD_INVALID'
      })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('interleaves a normal request while delivering more than 16 MiB as bounded items', async () => {
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
    const value = 'x'.repeat(16382)
    let produced = 0
    server.stream.provide('chunks', function* () {
      for (let index = 0; index < 1025; index += 1) {
        produced += 1
        yield value
      }
    })
    server.provide('ping', (context) => context.success('pong'))
    try {
      const iterator = client.stream.open('server', 'chunks', null)
      expect(await iterator.next()).toEqual({ done: false, value })
      expect(await client.send('server', 'ping', null)).toBe('pong')
      expect(produced).toBeLessThan(1025)
      for (let index = 1; index < 1025; index += 1)
        expect(await iterator.next()).toEqual({ done: false, value })
      expect(await iterator.next()).toEqual({ done: true, value: undefined })
      expect(produced * 16382).toBeGreaterThan(16 * 1024 * 1024)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  }, 30_000)
})
