/** Wrong-credit input reaches the original stream consumer through actual public Hosts. */
import { describe, expect, it, vi } from 'vitest'
import {
  RpcWireKind,
  RpcWireStreamFinish,
  type IRpcSemanticFrame
} from '@migaia/rpc-contract/protocol'
import { connectedCoreHosts } from '../host/core-fixture.js'

/** Wrong-credit item must fail only its pending caller pull. */
describe('streaming credit order', () => {
  it('identifies finish received for an ordinary cancellable stream', async () => {
    /** A valid ordinary stream has no before-start finish permission. */
    const fixture = await connectedCoreHosts({
      values: function* () {
        yield 1
      }
    })
    /** The genuine first pull is replaced with one grammar-valid but mode-invalid finish event. */
    const write = fixture.pair[1].write
    /** Routing, id and task stay those of the actual stream; only its finish permission is invalid. */
    const fault = vi.spyOn(fixture.pair[1], 'write').mockImplementation((frame, options) => {
      const message = frame.data as IRpcSemanticFrame
      if (message.kind === RpcWireKind.stream && message.stream.event === 'pull')
        return write(
          { ...frame, data: { ...message, stream: { event: RpcWireStreamFinish, seq: 0 } } },
          options
        )
      return write(frame, options)
    })
    try {
      /** The real provider refuses the incoming finish through its normal error terminal. */
      const stream = fixture.b.memory.stream('values', null) as AsyncIterableIterator<unknown>
      await expect(stream.next()).rejects.toMatchObject({
        code: 'CONTRACT_INVALID',
        message: 'stream finish requires before-start cancellation'
      })
    } finally {
      fault.mockRestore()
      await fixture.close()
    }
  })

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
