import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope } from '../../src/contract/index.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { connect } from '../../src/core/middleware/connect.js'
import { timeout } from '../../src/core/middleware/timeout.js'
import type { IRpcTransport } from '../../src/core/transport.js'
import type { IRpcAbortSignal } from '../../src/core/typing.js'

describe('provider relative deadline (A6)', () => {
  it('aborts at the monotonic deadline even without the abort control capability', async () => {
    const scheduler = createManualScheduler()
    const wallClock = { timestamp: () => 0 }
    const [clientWire, providerWire] = createMemoryTransportPair()
    /** Capture the wire request before identity transport delivers it. */
    let requestFrame: unknown
    const capture: IRpcTransport = {
      ...clientWire,
      send(message, options) {
        if ((message as { kind?: unknown }).kind === 'request') requestFrame = message
        return clientWire.send(message, options)
      }
    }
    /** Provider admission makes its signal available before manual time advances. */
    let started!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let providerSignal: IRpcAbortSignal | undefined
    const provider = await createProviderEndpoint({
      id: 'provider',
      transport: providerWire,
      scheduler,
      wallClock,
      middlewares: [connect({ transport: providerWire })],
      provider: {
        hang: (context) => {
          providerSignal = context.signal
          started()
          return new Promise<never>(() => undefined)
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: capture,
      scheduler,
      wallClock,
      middlewares: [connect({ transport: capture }), timeout()]
    })
    try {
      const result = client.send('provider', 'hang', null, { timeoutMs: 100 })
      result.catch(() => undefined)
      await providerStarted
      expect(normalizeRpcEnvelope(requestFrame)).toMatchObject({
        kind: 'request',
        data: { route: { timeoutMs: 100, sentAt: 0 } }
      })
      scheduler.advance(99)
      expect(providerSignal?.aborted).toBe(false)
      scheduler.advance(1)
      expect(providerSignal?.aborted).toBe(true)
      expect(providerSignal?.reason).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      await expect(result).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    } finally {
      await client.dispose()
      await provider.dispose()
    }
  })
})
