import { describe, expect, it } from 'vitest'
import { createProviderEndpoint } from '../src/provider.js'
import { createClientEndpoint } from '../src/client.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { connect } from '../src/middleware/connect.js'
import { abort } from '../src/middleware/abort.js'
import { readEndpointDebugSnapshot } from '../src/internal/test-observer.js'

/**
 * Regression gate for `SOL-CB-R9-P1-001`: a caller that settles a `send()` early (local abort
 * signal, or local `timeoutMs` expiry) must notify the remote provider to cancel its active
 * controller — exactly like legacy `notifyRemoteAbort()` — and the deferred outbound `send()` must
 * re-check settlement before actually transmitting the request, exactly like legacy's `if
 * (settlement.isSettled()) return` guard before `this.#send(...)`. Without both fixes, a
 * chunked/slow request that the caller already abandoned still reaches and executes on the remote
 * provider, and the resulting controller is created already-aborted (before the provider's own
 * `abort` listener attaches), so it never resolves and never leaves `activeControllers` — a
 * permanent leak, independently of how many times this test runs.
 */
describe('composed remote cancellation on caller-side settlement', () => {
  it('notifies the remote and leaves zero active controllers after a local timeoutMs expiry', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createProviderEndpoint({
      id: 'cancel-timeout-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), abort()],
      provider: {
        hang: (context) =>
          new Promise((resolve) =>
            context.signal.addEventListener(
              'abort',
              () => resolve(context.failed('aborted', 'CANCELLED')),
              { once: true }
            )
          )
      }
    })
    const client = await createClientEndpoint({
      id: 'cancel-timeout-client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    try {
      const result = await client
        .send('cancel-timeout-server', 'hang', null, { timeoutMs: 40 })
        .then(
          () => 'resolved',
          (error: { readonly code?: string }) => error.code
        )
      expect(result).toBe('DEADLINE_EXCEEDED')
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(readEndpointDebugSnapshot(server)!.activeControllers).toBe(0)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('notifies the remote and leaves zero active controllers after a local signal.abort() fired synchronously right after send()', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createProviderEndpoint({
      id: 'cancel-abort-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), abort()],
      provider: {
        hang: (context) =>
          new Promise((resolve) =>
            context.signal.addEventListener(
              'abort',
              () => resolve(context.failed('aborted', 'CANCELLED')),
              { once: true }
            )
          )
      }
    })
    const client = await createClientEndpoint({
      id: 'cancel-abort-client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    try {
      const controller = new AbortController()
      const pending = client.send('cancel-abort-server', 'hang', null, {
        signal: controller.signal
      })
      controller.abort()
      const result = await pending.then(
        () => 'resolved',
        (error: { readonly code?: string }) => error.code
      )
      expect(result).toBe('CANCELLED')
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(readEndpointDebugSnapshot(server)!.activeControllers).toBe(0)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
