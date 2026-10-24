import { RpcCapability } from '@migaia/rpc-contract'
import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { describe, expect, it } from 'vitest'

import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { ping } from '../../dist/core/middleware/ping.js'
import { abort } from '../../dist/core/middleware/abort.js'

/**
 * Regression gate: the legacy endpoint only replies to an inbound `ping` variation
 * (`src/endpoint.ts:2703`, `#features.ping === true`) or honors an inbound `abort` variation
 * (`src/endpoint.ts:2690-2692`, `#features.abort === true`) when the _receiving_ side selected the
 * matching capability middleware — the variation route itself stays registered either way (one
 * always-listening receiver), only the side effect is gated. These tests prove both the enabled and
 * disabled configuration for each capability against the canonical composed root.
 */
describe('composed inbound variation capability gating', () => {
  it('replies pong only when the receiver selected the ping() middleware', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createRuntimeEndpointComposition(
      {
        id: 'server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport }), ping()]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), ping()]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    try {
      await expect(client.ping!('server', undefined, { timeoutMs: 2000 })).resolves.toBe(true)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('never replies pong when the receiver did not select the ping() middleware', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createRuntimeEndpointComposition(
      {
        id: 'server-no-ping',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport })]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client-vs-no-ping',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), ping()]
      },
      { agreement: { capabilities: [RpcCapability.ping] }, peerId: '' }
    ).installing
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
    const server = await createRuntimeEndpointComposition(
      {
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
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'abort-enabled-client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), abort()]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
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
      expect(observedReason).toBeInstanceOf(Error)
      expect((observedReason as Error & { readonly data: unknown }).data).toEqual(abortReason)
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
    const server = await createRuntimeEndpointComposition(
      {
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
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'abort-disabled-client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport }), abort()]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
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
