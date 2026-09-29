import { describe, expect, it } from 'vitest'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { connect } from '../../src/core/middleware/connect.js'
import { abort } from '../../src/core/middleware/abort.js'
import { readEndpointDebugSnapshot } from '../../src/core/internal/test-observer.js'
import type { IRpcContext, IRpcProviderResult } from '../../src/core/typing.js'

/** Settle the test provider even when cancellation preceded its listener registration. */
function hangUntilAborted(context: IRpcContext): Promise<IRpcProviderResult> {
  if (context.signal.aborted) return Promise.resolve(context.failed('aborted', 'CANCELLED'))
  return new Promise((resolve) =>
    context.signal.addEventListener(
      'abort',
      () => resolve(context.failed('aborted', 'CANCELLED')),
      {
        once: true
      }
    )
  )
}

/**
 * Regression gate for `SOL-CB-R9-P1-001`: a caller that settles a `send()` early (local abort
 * signal, or local `timeoutMs` expiry) must notify the remote provider to cancel its active
 * controller — exactly like legacy `notifyRemoteAbort()` — and the deferred outbound `send()` must
 * re-check settlement before actually transmitting the request, exactly like legacy's `if
 * (settlement.isSettled()) return` guard before `this.#send(...)`. Without both fixes, a
 * chunked/slow request that the caller already abandoned can still reach the remote provider. The
 * fixture handles an already-aborted signal at entry, as a provider must, while the endpoint
 * assertions still require the local deadline and remote controller cleanup to converge.
 */
describe('composed remote cancellation on caller-side settlement', () => {
  it('notifies the remote and leaves zero active controllers after a local timeoutMs expiry', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createProviderEndpoint({
      id: 'cancel-timeout-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), abort()],
      provider: { hang: hangUntilAborted }
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
      provider: { hang: hangUntilAborted }
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
