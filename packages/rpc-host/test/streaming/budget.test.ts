import { describe, expect, it } from 'vitest'
import { measurePortableStreamValue, RpcStreamLimit } from '@migaia/rpc-contract'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { connectedCoreHosts } from '../host/core-fixture.js'

/** Compares the portable value budget with producer-side rejection before sending. */
describe('streaming portable value budget', () => {
  it('accepts exactly 16 KiB and rejects the next byte and undefined yields', async () => {
    expect(measurePortableStreamValue('x'.repeat(16382))).toBe(RpcStreamLimit.maxItemValueBytes)
    expect(measurePortableStreamValue('x'.repeat(16383))).toBe(RpcStreamLimit.maxItemValueBytes + 1)
    /** Public provider compilation advertises the original generators before either handshake. */
    const { a: client, close } = await connectedCoreHosts(
      {},
      {
        exact: function* () {
          yield 'x'.repeat(16382)
        },
        exceed: function* () {
          yield 'x'.repeat(16383)
        },
        undefined: function* () {
          yield undefined as never
        }
      },
      undefined,
      { create: () => new RpcJsonCarrierCodec(), nativeBinary: false }
    )
    try {
      const exact = client.memory!.streamTo('b', 'exact', null)
      expect(await exact.next()).toEqual({ done: false, value: 'x'.repeat(16382) })
      expect(await exact.next()).toEqual({ done: true, value: undefined })
      await expect(client.memory!.streamTo('b', 'exceed', null).next()).rejects.toMatchObject({
        code: 'PAYLOAD_INVALID'
      })
      await expect(client.memory!.streamTo('b', 'undefined', null).next()).rejects.toMatchObject({
        code: 'PAYLOAD_INVALID'
      })
    } finally {
      await close()
    }
  })

  it('interleaves a normal request while delivering more than 16 MiB as bounded items', async () => {
    const value = 'x'.repeat(16382)
    let produced = 0
    /** The same genuine provider owns every yielded item and the interleaved ordinary request. */
    const { a: client, close } = await connectedCoreHosts(
      {},
      {
        chunks: function* () {
          for (let index = 0; index < 1025; index += 1) {
            produced += 1
            yield value
          }
        },
        ping: (_value, context) => context.success('pong')
      }
    )
    try {
      const iterator = client.memory!.streamTo('b', 'chunks', null)
      expect(await iterator.next()).toEqual({ done: false, value })
      expect(await client.memory!.send('b', 'ping', null)).toBe('pong')
      expect(produced).toBeLessThan(1025)
      for (let index = 1; index < 1025; index += 1)
        expect(await iterator.next()).toEqual({ done: false, value })
      expect(await iterator.next()).toEqual({ done: true, value: undefined })
      expect(produced * 16382).toBeGreaterThan(16 * 1024 * 1024)
    } finally {
      await close()
    }
  }, 30_000)
})
