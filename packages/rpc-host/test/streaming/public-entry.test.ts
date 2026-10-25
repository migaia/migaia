/** The original public stream delivery uses the sole Host namespace instead of deleted roots. */
import { expect, it } from 'vitest'
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
