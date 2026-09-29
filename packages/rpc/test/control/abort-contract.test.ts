import { describe, expect, it, vi } from 'vitest'
import {
  normalizeRpcEnvelope,
  RpcControl,
  RpcRouteProfile,
  RpcRouteType
} from '../../src/contract/index.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { abort } from '../../src/core/middleware/abort.js'
import { connect } from '../../src/core/middleware/connect.js'
import { hooks } from '../../src/core/middleware/hooks.js'
import type { IRpcHookEvent } from '../../src/core/typing.js'
import type { IRpcTransport } from '../../src/core/transport.js'

describe('abort control envelope and remote reason (A1)', () => {
  it('reports malformed remote reasons while still aborting the running provider', async () => {
    /** Each malformed payload crosses the variation envelope before owner-specific decoding. */
    let deep: Record<string, unknown> = {
      source: 'peer',
      code: 'STOP',
      name: 'Error',
      message: 'stop',
      stack: 'peer-stack'
    }
    for (let index = 0; index < 70; index += 1)
      deep = {
        source: 'peer',
        code: 'STOP',
        name: 'Error',
        message: 'stop',
        stack: 'peer-stack',
        cause: deep
      }
    const invalidData = {
      source: 'peer',
      code: 'STOP',
      name: 'Error',
      message: 'stop',
      stack: 'peer-stack',
      data: { $rpc: 'bytes', base64url: '!' }
    }
    for (const [payload, violation] of [
      [deep, 'depth'],
      [invalidData, 'dataPortable']
    ] as const) {
      const [clientWire, providerWire] = createMemoryTransportPair()
      const sent: unknown[] = []
      const capture: IRpcTransport = {
        ...clientWire,
        send(message, options) {
          sent.push(message)
          return clientWire.send(message, options)
        }
      }
      const events: IRpcHookEvent[] = []
      let started!: () => void
      const providerStarted = new Promise<void>((resolve) => {
        started = resolve
      })
      let observed!: (value: unknown) => void
      const providerAborted = new Promise<unknown>((resolve) => {
        observed = resolve
      })
      const provider = await createProviderEndpoint({
        id: 'provider',
        transport: providerWire,
        middlewares: [
          connect({ transport: providerWire }),
          abort(),
          hooks({ listeners: (event) => void events.push(event) })
        ],
        provider: {
          slow: async (context) => {
            started()
            await new Promise<void>((resolve) =>
              context.signal.addEventListener('abort', () => resolve(), { once: true })
            )
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
        const pending = client.send('provider', 'slow', null, { timeoutMs: false })
        pending.catch(() => undefined)
        await providerStarted
        const request = sent
          .map((value) => normalizeRpcEnvelope(value))
          .find((value) => value.kind === 'request')
        expect(request?.kind).toBe('request')
        if (request?.kind !== 'request') continue
        const route = request.data.route
        const malformed = {
          kind: 'variation',
          id: request.id,
          data: {
            route: {
              profile: route.profile,
              type: RpcRouteType.variation,
              applicationVersion: route.applicationVersion,
              senderId: route.senderId,
              targetId: route.targetId,
              receiverId: route.receiverId,
              sentAt: route.sentAt,
              variation: RpcControl.abort
            },
            payload
          }
        }
        expect(normalizeRpcEnvelope(malformed)).toMatchObject({ kind: 'variation' })
        await clientWire.send(malformed)
        const reason = (await providerAborted) as {
          violation?: string
          code?: string
          cause?: unknown
        }
        expect(reason).toBeInstanceOf(TypeError)
        expect(reason).toMatchObject({
          code: 'INVALID_WIRE_ERROR',
          violation
        })
        if (violation === 'depth') expect(reason.cause).toBe(payload)
        else expect(reason.cause).toMatchObject({ code: 'INVALID_ENVELOPE' })
        await vi.waitFor(() =>
          expect(
            events.filter((event) => event.name === 'failure' && event.code === 'PROTOCOL_INVALID')
          ).toHaveLength(1)
        )
      } finally {
        await client.dispose()
        await provider.dispose()
      }
    }
  })

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
