import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import { expect, it } from 'vitest'
import { connect } from '../../dist/core/middleware/connect.js'

import { createMemoryTransportPair } from '../fixtures/memory-transport.js'

it.each([true, false])(
  'keeps native AbortError and the exact reason (pre-aborted=%s)',
  async (preAborted) => {
    /** A normal manual endpoint exposes the public query operation without private state access. */
    const [left, right] = createMemoryTransportPair()
    /** Caller-owned cancellation must remain reachable without changing the original native reason. */
    const reason = new Error('audit discovery cancellation')
    /** A genuine native controller provides the supported signal domain. */
    const controller = new AbortController()
    if (preAborted) controller.abort(reason)
    /** Manual mode ensures no automatic discovery changes the cancellation path. */
    const endpoint = await createRuntimeEndpointComposition(
      {
        id: 'manual-client',
        transport: left,
        middlewares: [connect({ transport: left, discoveryMode: 'manual' })]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    try {
      /** Both pre-admission and active-waiter cancellation use the same supported public query. */
      const pending = endpoint.connect
        .query('remote', { signal: controller.signal })
        .catch((error: unknown) => error)
      if (!preAborted) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        controller.abort(reason)
      }
      /** Cancellation is observed before any test-owned physical cleanup. */
      const failure = await pending
      expect(failure).toBeInstanceOf(DOMException)
      expect(failure).toMatchObject({
        name: 'AbortError',
        source: 'rpc.endpoint',
        code: 'CANCELLED',
        cause: reason
      })
    } finally {
      await endpoint.dispose()
      left.close()
      right.close()
    }
  }
)
