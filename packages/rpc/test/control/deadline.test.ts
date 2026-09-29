import { createManualScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it, vi } from 'vitest'
import { normalizeRpcEnvelope } from '../../src/contract/index.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createEndpointKernel } from '../../src/core/endpoint-kernel.js'
import { prepareEndpoint } from '../../src/core/internal/endpoint-bootstrap.js'
import { RpcOutboundAttachment } from '../../src/core/internal/outbound-attachment.js'
import { RpcPortName } from '../../src/core/internal/plugin-shared-keys.js'
import { connect } from '../../src/core/middleware/connect.js'
import { timeout } from '../../src/core/middleware/timeout.js'
import type { IRpcTransport } from '../../src/core/transport.js'
import type { IRpcAbortSignal } from '../../src/core/typing.js'

describe('provider relative deadline (A6)', () => {
  it('subtracts receiver resolution delay from the outbound wire budget', async () => {
    const scheduler = createManualScheduler()
    const wallClock = { timestamp: () => 0 }
    const [transport, peer] = createMemoryTransportPair()
    const kernel = createEndpointKernel(transport, undefined, scheduler, wallClock)
    const deferred = await prepareEndpoint(
      { id: 'client', transport, scheduler, wallClock, middlewares: [] },
      { deferMiddlewareInstall: true }
    )
    const prepared = await deferred.finalize(
      [],
      async (operation) => await operation(),
      (key) => (key === RpcPortName.connect ? { uniqueTargetId: 'client' } : undefined),
      () => 0
    )
    const outbound = new RpcOutboundAttachment(kernel, prepared)
    let releaseReceiver!: () => void
    const receiver = new Promise<{ readonly receiverId: string }>((resolve) => {
      releaseReceiver = () => resolve({ receiverId: 'provider' })
    })
    outbound.setReceiverResolver(() => receiver)
    let sent: unknown
    const unsubscribe = peer.subscribe(({ data }) => {
      sent = data
    })
    try {
      const pending = outbound.send('provider', 'check', null, { timeoutMs: 100 })
      pending.catch(() => undefined)
      scheduler.advance(30)
      releaseReceiver()
      await vi.waitFor(() => expect(sent).toBeDefined())
      expect(normalizeRpcEnvelope(sent)).toMatchObject({
        kind: 'request',
        data: { route: { timeoutMs: 70, sentAt: 0 } }
      })
      scheduler.advance(70)
      await expect(pending).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
    } finally {
      unsubscribe()
      kernel.beginClose()
      await kernel.resources.releaseAll()
    }
  })

  it('omits disabled deadlines and clears a settled provider timer', async () => {
    const providerScheduler = createManualScheduler()
    const clientScheduler = createManualScheduler()
    const [clientWire, providerWire] = createMemoryTransportPair()
    const sent: unknown[] = []
    const capture: IRpcTransport = {
      ...clientWire,
      send(message, options) {
        sent.push(message)
        return clientWire.send(message, options)
      }
    }
    let providerSignal: IRpcAbortSignal | undefined
    const provider = await createProviderEndpoint({
      id: 'provider',
      transport: providerWire,
      scheduler: providerScheduler,
      middlewares: [connect({ transport: providerWire })],
      provider: {
        check: (context) => {
          providerSignal = context.signal
          return context.success(context.signal.aborted)
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: capture,
      scheduler: clientScheduler,
      middlewares: [connect({ transport: capture }), timeout()]
    })
    try {
      expect(await client.send('provider', 'check', null, { timeoutMs: false })).toBe(false)
      const disabled = sent
        .map((value) => normalizeRpcEnvelope(value))
        .find((value) => value.kind === 'request')
      expect(disabled?.kind).toBe('request')
      if (disabled?.kind !== 'request') return
      expect(disabled.data.route.timeoutMs).toBeUndefined()
      providerScheduler.advance(1_000_000)
      clientScheduler.advance(1_000_000)
      expect(providerSignal?.aborted).toBe(false)
      const baseline = providerScheduler.pendingCount
      expect(await client.send('provider', 'check', null, { timeoutMs: 100 })).toBe(false)
      await vi.waitFor(() => expect(providerScheduler.pendingCount).toBe(baseline))
    } finally {
      await client.dispose()
      await provider.dispose()
    }
  })

  it('presents an injected zero deadline as an already aborted provider signal', async () => {
    const [clientWire, providerWire] = createMemoryTransportPair()
    const sent: unknown[] = []
    const capture: IRpcTransport = {
      ...clientWire,
      send(message, options) {
        sent.push(message)
        return clientWire.send(message, options)
      }
    }
    let observed!: (value: boolean) => void
    const called = new Promise<boolean>((resolve) => {
      observed = resolve
    })
    let calls = 0
    const provider = await createProviderEndpoint({
      id: 'provider',
      transport: providerWire,
      middlewares: [connect({ transport: providerWire })],
      provider: {
        check: (context) => {
          calls += 1
          if (calls === 2) observed(context.signal.aborted)
          return context.success(null)
        }
      }
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: capture,
      middlewares: [connect({ transport: capture })]
    })
    try {
      await client.send('provider', 'check', null)
      const request = sent
        .map((value) => normalizeRpcEnvelope(value))
        .find((value) => value.kind === 'request')
      expect(request?.kind).toBe('request')
      if (request?.kind !== 'request') return
      await clientWire.send({
        ...request,
        id: 'zero-deadline',
        data: {
          ...request.data,
          route: { ...request.data.route, timeoutMs: 0 }
        }
      })
      expect(await called).toBe(true)
    } finally {
      await client.dispose()
      await provider.dispose()
    }
  })

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
