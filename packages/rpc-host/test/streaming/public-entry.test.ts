/** The original public stream delivery uses the sole Host namespace instead of deleted roots. */
import { expect, it, vi } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'

it('delivers the original stream items through the complete public Host entry', async () => {
  /** Both real Hosts install their original raw memory carriers and complete actual handshakes. */
  const fixture = await connectedCoreHosts({
    one: function* () {
      yield 'value'
    }
  })
  try {
    /** Exactly one accepted provider selects the ordinary iterator rather than broadcast output. */
    const values = fixture.b.memory.stream('one', null) as AsyncIterableIterator<unknown>
    expect(await values.next()).toEqual({ done: false, value: 'value' })
    expect(await values.next()).toEqual({ done: true, value: undefined })
  } finally {
    await fixture.b.close()
    await fixture.a.close()
  }
})

it.each([false, true])(
  'unopened stream termination performs no physical work (throw=%s)',
  async (thrown) => {
    /** Actual provider entry must remain absent when its public lazy iterator terminates unopened. */
    const provider = vi.fn(function* () {
      yield 'unreachable'
    })
    /** Both hosts and the original raw pair remain available to observe physical write count. */
    const fixture = await connectedCoreHosts({ cold: provider })
    /** Observe only post-construction native writes, without replacing the physical operation. */
    const write = vi.spyOn(fixture.pair[1], 'write')
    try {
      /** The terminated iterator previously retained this original input even though no IO occurred. */
      const iterator = fixture.b.memory.stream(
        'cold',
        'x'.repeat(64 * 1024)
      ) as AsyncIterableIterator<unknown>
      /** A thrown primary remains exactly the caller's object on the unopened path. */
      const reason = new Error('unopened stream throw')
      if (thrown) await expect(iterator.throw!(reason)).rejects.toBe(reason)
      else expect(await iterator.return!('closed')).toEqual({ done: true, value: 'closed' })
      expect(await iterator.next()).toEqual({ done: true, value: undefined })
      expect(provider).not.toHaveBeenCalled()
      expect(write).not.toHaveBeenCalled()
    } finally {
      write.mockRestore()
      await fixture.close()
    }
  }
)

it.each(['item', 'end'] as const)(
  'R18 public sender rejects an oversized %s without hanging',
  async (event) => {
    /** Actual JSON media owns the sole sender measurement before native write. */
    const fixture = await connectedCoreHosts(
      {
        oversized: function* () {
          if (event === 'item') yield 'x'.repeat(16383)
          else return 'x'.repeat(16383)
        }
      },
      {},
      () => undefined,
      { create: () => new RpcJsonCarrierCodec(), nativeBinary: false }
    )
    try {
      const values = fixture.b.memory.stream('oversized', null) as AsyncIterableIterator<unknown>
      await expect(values.next()).rejects.toMatchObject({
        source: 'rpc.endpoint',
        code: 'PAYLOAD_INVALID'
      })
    } finally {
      await fixture.close()
    }
  }
)
