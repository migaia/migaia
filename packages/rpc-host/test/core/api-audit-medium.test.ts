import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { RpcCapability } from '@migaia/rpc-contract'
import { expect, it } from 'vitest'
import { connect } from '../../dist/core/middleware/connect.js'

import { createRuntimeApiEndpoint } from '../../dist/core/runtime-api-endpoint.js'
import { defineMiddleware } from '../../dist/core/middleware.js'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'

it('publishes the binding disposal settlement before one synchronous reentry', async () => {
  /** The bound operation is allowed to synchronously join disposal before returning its Promise. */
  let calls = 0
  /** A reentrant observer must receive the same facade-owned settlement. */
  let nested: Promise<void> | undefined
  /** These complete public binding operations need no physical transport. */
  const endpoint = createRuntimeApiEndpoint({
    binding: {
      ready: Promise.resolve(),
      request: async () => undefined,
      notify: async () => undefined,
      stream: { open: () => (async function* () {})() },
      dispose() {
        calls++
        if (calls === 1) nested = endpoint.dispose()
        return Promise.resolve()
      }
    }
  })
  /** The public facade owns a stable Promise even while the binding is executing synchronously. */
  const closing = endpoint.dispose()
  await closing
  expect(calls).toBe(1)
  expect(nested).toBe(closing)
  expect(endpoint.dispose()).toBe(closing)
})

it('classifies the original middleware installation failure at the endpoint boundary', async () => {
  /** The application callback's original native instance and stack remain intact. */
  const original = new Error('audit installation failed')
  /** This middleware is admitted through its ordinary native descriptor. */
  const middleware = defineMiddleware('audit-install', () => ({
    install() {
      throw original
    }
  }))
  /** Construction rollback owns the actual local memory transport. */
  const [left, right] = createMemoryTransportPair()
  try {
    await expect(
      createRuntimeEndpointComposition(
        {
          id: 'audit-install',
          transport: left,
          middlewares: [connect({ transport: left }), middleware]
        },
        { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
      ).installing
    ).rejects.toBe(original)
    expect(original).toMatchObject({ source: 'rpc.endpoint', code: 'CALLBACK_FAILED' })
  } finally {
    left.close()
    right.close()
  }
})

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
