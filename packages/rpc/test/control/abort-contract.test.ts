import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope, RpcControl, RpcRouteProfile } from '../../src/contract/index.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { abort } from '../../src/core/middleware/abort.js'
import { connect } from '../../src/core/middleware/connect.js'
import type { IRpcTransport } from '../../src/core/transport.js'

describe('abort control envelope and remote reason (A1)', () => {
  it('sends a variation frame and preserves a native RangeError on the provider', async () => {
    const [clientWire, providerWire] = createMemoryTransportPair()
    const sent: unknown[] = []
    const capture: IRpcTransport = {
      ...clientWire,
      send(message, options) {
        sent.push(message)
        return clientWire.send(message, options)
      }
    }
    /** Resolve when the provider starts so cancellation occurs during execution. */
    let started!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    /** Resolve after the provider observes the incoming reason. */
    let observed!: (reason: unknown) => void
    const providerAborted = new Promise<unknown>((resolve) => {
      observed = resolve
    })
    const provider = await createProviderEndpoint({
      id: 'provider',
      transport: providerWire,
      middlewares: [connect({ transport: providerWire }), abort()],
      provider: {
        slow: async (context) => {
          started()
          await new Promise<void>((resolve) => {
            context.signal.addEventListener('abort', () => resolve(), { once: true })
          })
          observed(context.signal.reason)
          return context.success('late')
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: capture,
      middlewares: [connect({ transport: capture }), abort()]
    })
    try {
      const controller = new AbortController()
      const result = client.send('provider', 'slow', null, {
        signal: controller.signal,
        timeoutMs: false
      })
      result.catch(() => undefined)
      await providerStarted
      controller.abort(new RangeError('stop'))
      await expect(result).rejects.toMatchObject({ code: 'CANCELLED' })
      const reason = await providerAborted
      expect(reason).toBeInstanceOf(RangeError)
      expect(reason).toMatchObject({ message: 'stop' })
      const variation = sent
        .map((message) => {
          try {
            return normalizeRpcEnvelope(message)
          } catch {
            return undefined
          }
        })
        .find((message) => message?.kind === 'variation')
      expect(variation).toMatchObject({
        kind: 'variation',
        data: { route: { profile: RpcRouteProfile, variation: RpcControl.abort } }
      })
      expect(variation?.id).toBe(
        sent
          .map((message) => {
            try {
              return normalizeRpcEnvelope(message)
            } catch {
              return undefined
            }
          })
          .find((message) => message?.kind === 'request')?.id
      )
    } finally {
      await client.dispose()
      await provider.dispose()
    }
  })
})
