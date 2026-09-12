import { describe, expect, it } from 'vitest'
import { createComposedEndpoint } from '../src/core.js'
import { createProviderEndpoint } from '../src/provider.js'
import { createClientEndpoint } from '../src/client.js'
import {
  createFirstPartyRoots,
  type IWebRpcFirstPartyRootName
} from '../src/internal/first-party-roots.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { connect } from '../src/middleware/connect.js'
import { ping } from '../src/middleware/ping.js'
import { abort } from '../src/middleware/abort.js'

/**
 * Regression gate for `SOL-CB-R8-P1-002`: the legacy endpoint only replies to an inbound `ping`
 * variation (`src/endpoint.ts:2703`, `#features.ping === true`) or honors an inbound `abort`
 * variation (`src/endpoint.ts:2690-2692`, `#features.abort === true`) when the _receiving_ side
 * selected the matching capability middleware — the variation route itself stays registered either
 * way (one always-listening receiver), only the side effect is gated. These tests prove both the
 * enabled and disabled configuration for each capability against the canonical composed root.
 */
describe('composed inbound variation capability gating', () => {
  it('replies pong only when the receiver selected the ping() middleware', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createComposedEndpoint(
      {
        id: 'server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport }), ping()]
      },
      createFirstPartyRoots(new Set<IWebRpcFirstPartyRootName>(['first-party-control']))
    )
    const client = await createComposedEndpoint(
      {
        id: 'client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), ping()]
      },
      createFirstPartyRoots(new Set<IWebRpcFirstPartyRootName>(['first-party-control']))
    )
    try {
      await expect(client.ping!('server', undefined, { timeoutMs: 2000 })).resolves.toBe(true)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('never replies pong when the receiver did not select the ping() middleware', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createComposedEndpoint(
      {
        id: 'server-no-ping',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport })]
      },
      createFirstPartyRoots(new Set<IWebRpcFirstPartyRootName>(['first-party-control']))
    )
    const client = await createComposedEndpoint(
      {
        id: 'client-vs-no-ping',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), ping()]
      },
      createFirstPartyRoots(new Set<IWebRpcFirstPartyRootName>(['first-party-control']))
    )
    try {
      await expect(client.ping!('server-no-ping', undefined, { timeoutMs: 60 })).resolves.toBe(
        false
      )
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('cancels an active provider task only when the receiver selected the abort() middleware', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let observedAborted: boolean | undefined
    let observedReason: unknown
    let started: (() => void) | undefined
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const server = await createProviderEndpoint({
      id: 'abort-enabled-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport }), abort()],
      provider: {
        slow: async (context) => {
          started?.()
          await new Promise<void>((resolve) => {
            if (context.signal.aborted) {
              resolve()
              return
            }
            context.signal.addEventListener('abort', () => resolve(), { once: true })
            setTimeout(resolve, 400)
          })
          observedAborted = context.signal.aborted
          observedReason = context.signal.reason
          return context.success(undefined)
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'abort-enabled-client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    try {
      const controller = new AbortController()
      const request = client.send('abort-enabled-server', 'slow', null, {
        signal: controller.signal,
        timeoutMs: false
      })
      request.catch(() => undefined)
      await startedPromise
      const abortReason = { reason: ['active', { route: 'portable' }] }
      controller.abort(abortReason)
      await expect(request).rejects.toSatisfy(
        (error: unknown) => (error as { readonly cause?: unknown }).cause === abortReason
      )
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(observedAborted).toBe(true)
      expect(observedReason).toEqual({ reason: ['active', { route: 'portable' }] })
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('never cancels an active provider task when the receiver did not select the abort() middleware', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    let observedAborted: boolean | undefined
    let started: (() => void) | undefined
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve
    })
    const server = await createProviderEndpoint({
      id: 'abort-disabled-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: {
        slow: async (context) => {
          started?.()
          await new Promise<void>((resolve) => {
            if (context.signal.aborted) {
              resolve()
              return
            }
            context.signal.addEventListener('abort', () => resolve(), { once: true })
            setTimeout(resolve, 200)
          })
          observedAborted = context.signal.aborted
          return context.success(undefined)
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'abort-disabled-client',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
    try {
      const controller = new AbortController()
      const request = client.send('abort-disabled-server', 'slow', null, {
        signal: controller.signal,
        timeoutMs: false
      })
      request.catch(() => undefined)
      await startedPromise
      controller.abort()
      await new Promise((resolve) => setTimeout(resolve, 350))
      expect(observedAborted).toBe(false)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
