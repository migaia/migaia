import { MessageChannel } from 'node:worker_threads'
import { expect, it, vi } from 'vitest'

it('native endpoint reports the seeded genuine allocator exhaustion once with the original error', async () => {
  /**
   * Inject only the internal starting counter; the real nonce allocator and error brand remain
   * intact.
   */
  const allocator = await vi.importActual<
    typeof import('../../dist/core/internal/native-default-id.js')
  >('../../dist/core/internal/native-default-id.js')
  vi.doMock('../../dist/core/internal/native-default-id.js', () => ({
    ...allocator,
    createNativeDefaultAllocator: (
      config: Parameters<typeof allocator.createNativeDefaultAllocator>[0],
      _start: bigint,
      report: (error: unknown) => void
    ) => allocator.createNativeDefaultAllocator(config, 0xffffffffffffffffn, report)
  }))
  /**
   * Real Node messaging supplies the resource; private registration models the canonical launch
   * owner's receipt.
   */
  const { port1, port2 } = new MessageChannel()
  try {
    const { registerNativeReplayOwner } = await import('../../dist/core/internal/native-replay.js')
    registerNativeReplayOwner(port1, {
      alive: () => true,
      exclusive: () => port1.listenerCount('message') <= 1
    })
    const { createNodeMessagePortTransport } =
      await import('../../dist/core/adapters/message-port.js')
    /** Adapts the exact privately registered Node resource without a caller-defined wrapper. */
    const transport = createNodeMessagePortTransport(port1)
    /** No exhausted allocation may reach the actual native physical writer. */
    const written = vi.spyOn(port1, 'postMessage')
    const { createRuntimeEndpointComposition } =
      await import('../../dist/core/runtime-api-endpoint.js')
    const { connect } = await import('../../dist/core/middleware/connect.js')
    /** Consumes the real default allocator with only its starting counter seeded. */
    const endpoint = await createRuntimeEndpointComposition(
      {
        id: 'exhausted',
        transport,
        targetIds: ['peer'],
        middlewares: [connect({ transport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    /** The production hook must see the same branded error that rejects the business request. */
    const reported: unknown[] = []
    /** Releases the observer before endpoint disposal. */
    const remove = endpoint.hooks.on((event) => {
      if (event.name === 'failure') reported.push(event.error)
    })
    try {
      /** Captures the business rejection for identity comparison with its diagnostic report. */
      const failure = await endpoint.send('peer', 'echo', null).catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'INVALID_CONFIG' })
      expect(allocator.isNativeDefaultCounterExhaustion(failure)).toBe(true)
      expect(reported).toEqual([failure])
      expect(written).not.toHaveBeenCalled()
    } finally {
      remove()
      await endpoint.dispose()
    }
  } finally {
    vi.doUnmock('../../dist/core/internal/native-default-id.js')
    port1.close()
    port2.close()
  }
})
