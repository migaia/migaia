/** Wrong-credit input reaches the original stream consumer through actual public Hosts. */
import { describe, expect, it, vi } from 'vitest'
import { RpcWireKind, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { connectedCoreHosts } from '../host/core-fixture.js'

/** Wrong-credit item must fail only its pending caller pull. */
describe('streaming credit order', () => {
  it('rejects an item with a sequence different from the pending pull', async () => {
    /** Both native subscriptions and the provider stream are genuine owners. */
    const fixture = await connectedCoreHosts(
      {},
      {
        count: function* () {
          yield 'wrong'
        }
      },
      () => undefined
    )
    /** Keep the original receiverless native writer; no parallel transport or stream owner exists. */
    const write = fixture.pair[1].write
    /** Change only the original invalid sequence at the same physical item handoff. */
    const fault = vi.spyOn(fixture.pair[1], 'write').mockImplementation((frame, options) => {
      if (frame.kind === 'message') {
        /** The fixture's existing identity codec exposes its actual semantic frame. */
        const message = frame.data as IRpcSemanticFrame
        if (message.kind === RpcWireKind.stream && message.stream.event === 'item')
          return write(
            { ...frame, data: { ...message, stream: { ...message.stream, seq: 2 } } },
            options
          )
      }
      return write(frame, options)
    })
    try {
      /** The actual single accepted provider selects the ordinary public iterator. */
      const stream = fixture.a.memory.stream('count', null) as AsyncIterableIterator<unknown>
      await expect(stream.next()).rejects.toMatchObject({
        code: 'INVALID_STREAM',
        violation: 'seq',
        pointer: '/seq'
      })
    } finally {
      fault.mockRestore()
      await fixture.close()
    }
  })
})
