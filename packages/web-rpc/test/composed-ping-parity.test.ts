import { describe, expect, it, vi } from 'vitest'
import { createFullEndpoint } from '../src/full.js'
import { createEndpoint } from '../src/index.js'
import { createMemoryTransportPair } from '../src/adapters/memory.js'
import { connect } from '../src/middleware/connect.js'
import { ping } from '../src/middleware/ping.js'
import { uuid } from '../src/middleware/uuid.js'
import { WebRpcError, WebRpcContractError } from '../src/errors.js'
import { WebRpcMessageKind } from '../src/protocol-constants.js'
import {
  readEndpointDebugSnapshot,
  registerEndpointTimePortObserver,
  type IWebRpcTimePortEvent
} from '../src/internal/test-observer.js'
import type { IWebRpcAbortSignal } from '../src/typing.js'
import type { IWebRpcTransport } from '../src/transport.js'

/**
 * Regression gate for `SOL-CB-R7-P1-001`/`SOL-CB-R7-P1-002`: exercises the composed root
 * (`createEndpoint`/`createFullEndpoint`) so a future regression in the migrated `ping()`
 * capability gate, identifier validation, or per-call `timeoutMs`/`signal` handling fails a test
 * instead of passing silently.
 */
describe('composed root ping() parity', () => {
  it('root createEndpoint is the same value as createFullEndpoint', () => {
    expect(createEndpoint).toBe(createFullEndpoint)
  })

  it('throws MIDDLEWARE_MISSING synchronously when the ping capability is not selected', async () => {
    const [clientTransport] = createMemoryTransportPair()
    const client = await createFullEndpoint({
      id: 'client-no-ping',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport })]
    })
    // `client`'s inferred type correctly has no `ping` member here: with no `ping()` middleware
    // selected, `IFactoryPingCapability<TMiddlewares>` is `false` and `IWebRpcPingEndpointSurface`
    // resolves to `{}` (see src/typing.ts). That is the real, load-bearing negative-capability
    // assertion — it must never be weakened to make this call type-check. This narrow, explicit
    // cast documents that we are deliberately reaching past the type to prove the *runtime* gate
    // rejects a call the *type* already says is impossible.
    const unauthorizedPingCall = client as unknown as {
      ping: (targetId: string) => Promise<boolean>
    }
    try {
      let thrown: unknown
      try {
        unauthorizedPingCall.ping('server')
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(WebRpcError)
      expect((thrown as WebRpcError).code).toBe('MIDDLEWARE_MISSING')
      expect((thrown as WebRpcError).message).toBe('ping middleware is not installed')
    } finally {
      await client.dispose()
    }
  })

  it('throws CONTRACT_INVALID synchronously for an empty targetId', async () => {
    const [clientTransport] = createMemoryTransportPair()
    const client = await createFullEndpoint({
      id: 'client-empty-target',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), ping()]
    })
    try {
      let thrown: unknown
      try {
        client.ping('')
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(WebRpcContractError)
      expect((thrown as WebRpcContractError).code).toBe('CONTRACT_INVALID')
      expect((thrown as WebRpcContractError).message).toBe(
        'targetId must be a non-empty identifier within the limit'
      )
    } finally {
      await client.dispose()
    }
  })

  it('honors a per-call timeoutMs shorter than the fixed legacy default', async () => {
    const [clientTransport] = createMemoryTransportPair()
    const client = await createFullEndpoint({
      id: 'client-fast-timeout',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), ping()]
    })
    try {
      const start = Date.now()
      const settled = await client.ping('unreachable', undefined, { timeoutMs: 25 })
      const elapsed = Date.now() - start
      expect(settled).toBe(false)
      expect(elapsed).toBeLessThan(500)
    } finally {
      await client.dispose()
    }
  })

  it('settles false immediately when the abort signal is already aborted', async () => {
    const [clientTransport] = createMemoryTransportPair()
    const client = await createFullEndpoint({
      id: 'client-aborted-signal',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), ping()]
    })
    try {
      const controller = new AbortController()
      controller.abort()
      await expect(
        client.ping('unreachable', undefined, { signal: controller.signal })
      ).resolves.toBe(false)
    } finally {
      await client.dispose()
    }
  })

  it('settles false when the abort signal fires before the timeout', async () => {
    const [clientTransport] = createMemoryTransportPair()
    const client = await createFullEndpoint({
      id: 'client-abort-races-timeout',
      transport: clientTransport,
      middlewares: [connect({ transport: clientTransport }), ping()]
    })
    try {
      const controller = new AbortController()
      const result = client.ping('unreachable', undefined, {
        timeoutMs: 5000,
        signal: controller.signal
      })
      controller.abort()
      const start = Date.now()
      await expect(result).resolves.toBe(false)
      expect(Date.now() - start).toBeLessThan(500)
    } finally {
      await client.dispose()
    }
  })

  it('settles same-target same-tick pings independently with distinct variation IDs', async () => {
    const fixedNow = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const [baseClientTransport, serverTransport] = createMemoryTransportPair()
    const taskIds: string[] = []
    const clientTransport: IWebRpcTransport = {
      ...baseClientTransport,
      send(message, options) {
        const candidate = message as { readonly kind?: unknown; readonly taskId?: unknown }
        if (candidate.kind === WebRpcMessageKind.variation && typeof candidate.taskId === 'string')
          taskIds.push(candidate.taskId)
        return baseClientTransport.send(message, options)
      }
    }
    let variationId = 0
    try {
      const client = await createFullEndpoint({
        id: 'client-same-tick-ping',
        transport: clientTransport,
        middlewares: [
          connect({ transport: clientTransport }),
          ping(),
          uuid({
            generate: ({ variation }) =>
              variation === 'variation' ? `same-tick-${++variationId}` : `unused-${variation}`
          })
        ] as const
      })
      const server = await createFullEndpoint({
        id: 'server-same-tick-ping',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport }), ping()]
      })
      try {
        await expect(
          Promise.all([client.ping('server-same-tick-ping'), client.ping('server-same-tick-ping')])
        ).resolves.toEqual([true, true])
        expect(taskIds).toHaveLength(2)
        expect(new Set(taskIds).size).toBe(2)
      } finally {
        await client.dispose()
        await server.dispose()
      }
    } finally {
      fixedNow.mockRestore()
    }
  })

  it('rejects a reused UUID before overwriting the first timeout-disabled ping', async () => {
    const [clientTransport] = createMemoryTransportPair()
    let sendCount = 0
    const instrumentedTransport: IWebRpcTransport = {
      ...clientTransport,
      send(message, options) {
        sendCount += 1
        return clientTransport.send(message, options)
      }
    }
    const client = await createFullEndpoint({
      id: 'client-ping-collision',
      transport: instrumentedTransport,
      middlewares: [
        connect({ transport: instrumentedTransport }),
        ping(),
        uuid({ generate: ({ variation }) => `${variation}-constant` })
      ] as const
    })
    const timeEvents: IWebRpcTimePortEvent[] = []
    const unregisterTimeObserver = registerEndpointTimePortObserver(client, (event) => {
      timeEvents.push(event)
    })
    let firstAbortAddCount = 0
    let firstAbortRemoveCount = 0
    const firstSignal: IWebRpcAbortSignal = {
      aborted: false,
      addEventListener: () => {
        firstAbortAddCount += 1
      },
      removeEventListener: () => {
        firstAbortRemoveCount += 1
      }
    }
    let collisionAbortAddCount = 0
    let collisionAbortRemoveCount = 0
    const collisionSignal: IWebRpcAbortSignal = {
      aborted: false,
      addEventListener: () => {
        collisionAbortAddCount += 1
      },
      removeEventListener: () => {
        collisionAbortRemoveCount += 1
      }
    }
    try {
      const first = client.ping('missing-ping-target', undefined, {
        timeoutMs: false,
        signal: firstSignal
      })
      const beforeCollision = readEndpointDebugSnapshot(client)
      const beforeTimeEventCount = timeEvents.length
      const beforeSendCount = sendCount
      const beforeFirstAbortAddCount = firstAbortAddCount
      const beforeFirstAbortRemoveCount = firstAbortRemoveCount
      expect(beforeCollision).toMatchObject({
        discovery: { waiters: 1, timers: 1 }
      })
      expect(beforeTimeEventCount).toBeGreaterThan(0)
      expect(beforeFirstAbortAddCount).toBe(1)
      expect(beforeFirstAbortRemoveCount).toBe(0)
      expect(() =>
        client.ping('missing-ping-target', undefined, {
          timeoutMs: 5_000,
          signal: collisionSignal
        })
      ).toThrow(
        expect.objectContaining({
          code: 'INVALID_CONFIG',
          message: 'UUID conflict: VARIATION:client-ping-collision:variation-constant'
        })
      )
      expect(readEndpointDebugSnapshot(client)).toEqual(beforeCollision)
      expect(timeEvents).toHaveLength(beforeTimeEventCount)
      expect(sendCount).toBe(beforeSendCount)
      expect(firstAbortAddCount).toBe(beforeFirstAbortAddCount)
      expect(firstAbortRemoveCount).toBe(beforeFirstAbortRemoveCount)
      expect(collisionAbortAddCount).toBe(0)
      expect(collisionAbortRemoveCount).toBe(0)
      const disposePromise = client.dispose()
      await expect(first).resolves.toBe(false)
      await disposePromise
      expect(client.dispose()).toBe(disposePromise)
    } finally {
      unregisterTimeObserver()
      await client.dispose()
    }
    expect(firstAbortAddCount).toBe(1)
    expect(firstAbortRemoveCount).toBe(1)
    expect(collisionAbortAddCount).toBe(0)
    expect(collisionAbortRemoveCount).toBe(0)
  })
})
