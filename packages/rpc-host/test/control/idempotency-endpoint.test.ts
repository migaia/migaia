import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { describe, expect, it, vi } from 'vitest'

import { createMemoryTransportPair } from '../fixtures/memory-transport.js'
import { createRpcIdempotencyStore } from '../../dist/core/idempotency-store.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { abort } from '../../dist/core/middleware/abort.js'
import { readEndpointDebugSnapshot } from '../../dist/core/internal/test-observer.js'

describe('keyed provider execution', () => {
  it('retains a transfer result without detaching the provider buffer', async () => {
    const [clientWire, serverWire] = createMemoryTransportPair()
    const buffer = new Uint8Array([1, 2, 3])
    let calls = 0
    const server = await createRuntimeEndpointComposition(
      {
        id: 'server',
        transport: serverWire,
        middlewares: [connect({ transport: serverWire })],
        provider: {
          bytes: (context) => {
            calls += 1
            return context.success(buffer, { transfer: [buffer.buffer] })
          }
        }
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client',
        transport: clientWire,
        middlewares: [connect({ transport: clientWire })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    try {
      const first = await client.send('server', 'bytes', null, { idempotencyKey: 'bytes' })
      const second = await client.send('server', 'bytes', null, { idempotencyKey: 'bytes' })
      expect(first).toEqual(second)
      expect(buffer.buffer.byteLength).toBe(3)
      expect(calls).toBe(1)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('shares an injected scope across connections and reclaims after owner disposal', async () => {
    const store = createRpcIdempotencyStore()
    const [clientWireA, serverWireA] = createMemoryTransportPair()
    const [clientWireB, serverWireB] = createMemoryTransportPair()
    const idempotency = { store, scope: () => 'shared-session' }
    let started!: () => void
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    let calls = 0
    const serverA = await createRuntimeEndpointComposition(
      {
        id: 'server',
        transport: serverWireA,
        idempotency,
        middlewares: [connect({ transport: serverWireA })],
        provider: {
          count: async (context) => {
            calls += 1
            started()
            await new Promise<void>((resolve) =>
              context.signal.addEventListener('abort', () => resolve(), { once: true })
            )
            return context.success(calls)
          }
        }
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const serverB = await createRuntimeEndpointComposition(
      {
        id: 'server',
        transport: serverWireB,
        idempotency,
        middlewares: [connect({ transport: serverWireB })],
        provider: { count: (context) => context.success(++calls) }
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const clientA = await createRuntimeEndpointComposition(
      {
        id: 'client-a',
        transport: clientWireA,
        middlewares: [connect({ transport: clientWireA })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const clientB = await createRuntimeEndpointComposition(
      {
        id: 'client-b',
        transport: clientWireB,
        middlewares: [connect({ transport: clientWireB })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    try {
      const first = clientA.send<number>('server', 'count', null, { idempotencyKey: 'k' })
      first.catch(() => undefined)
      await firstStarted
      const duplicate = clientB.send<number>('server', 'count', null, { idempotencyKey: 'k' })
      await vi.waitFor(() => expect(readEndpointDebugSnapshot(serverB)?.activeControllers).toBe(1))
      expect(calls).toBe(1)
      await serverA.dispose()
      expect(await duplicate).toBe(2)
      expect(calls).toBe(2)
    } finally {
      await clientA.dispose()
      await clientB.dispose()
      await serverA.dispose()
      await serverB.dispose()
    }
  })

  it('rejects a new key while the bounded store owns an executing request', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createRuntimeEndpointComposition(
      {
        id: 'server',
        transport: serverTransport,
        targetIds: ['client'],
        idempotency: { store: createRpcIdempotencyStore({ maxEntries: 1 }) },
        middlewares: [connect({ transport: serverTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client',
        transport: clientTransport,
        targetIds: ['server'],
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    let count = 0
    let started!: () => void
    let finish!: (value: number) => void
    const providerStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const gate = new Promise<number>((resolve) => {
      finish = resolve
    })
    server.provide('count', async (context) => {
      count += 1
      started()
      return context.success(await gate)
    })
    try {
      const first = client.send<number>('server', 'count', null, { idempotencyKey: 'first' })
      await providerStarted
      await expect(
        client.send<number>('server', 'count', null, { idempotencyKey: 'second' })
      ).rejects.toMatchObject({ code: 'OVERLOADED' })
      expect(count).toBe(1)
      finish(7)
      expect(await first).toBe(7)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('rejects a malformed injected store before constructing a provider endpoint', async () => {
    const [, serverTransport] = createMemoryTransportPair()
    await expect(
      createRuntimeEndpointComposition(
        {
          id: 'server',
          transport: serverTransport,
          idempotency: { store: 1 as never },
          middlewares: [connect({ transport: serverTransport })]
        },
        { agreement: { capabilities: [] }, peerId: '' }
      ).installing
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('keeps method tuples distinct and reports retained-result tombstones', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createRuntimeEndpointComposition(
      {
        id: 'server',
        transport: serverTransport,
        targetIds: ['client'],
        idempotency: { store: createRpcIdempotencyStore({ maxOutcomeBytes: 10 }) },
        middlewares: [connect({ transport: serverTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client',
        transport: clientTransport,
        targetIds: ['server'],
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    let count = 0
    let count2 = 0
    server.provide('count', (context) => {
      count += 1
      return context.success('x'.repeat(20))
    })
    server.provide('count2', (context) => context.success(++count2))
    try {
      expect(await client.send('server', 'count', null, { idempotencyKey: 'same' })).toBe(
        'x'.repeat(20)
      )
      await expect(
        client.send('server', 'count', null, { idempotencyKey: 'same' })
      ).rejects.toMatchObject({ code: 'IDEMPOTENCY_RESULT_UNAVAILABLE' })
      expect(count).toBe(1)
      expect(await client.send('server', 'count2', null, { idempotencyKey: 'same' })).toBe(1)
      expect(count2).toBe(1)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('executes one method/key pair once and replays the result', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createRuntimeEndpointComposition(
      {
        id: 'server',
        transport: serverTransport,
        targetIds: ['client'],
        middlewares: [connect({ transport: serverTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client',
        transport: clientTransport,
        targetIds: ['server'],
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    let count = 0
    server.provide('count', (context) => context.success(++count))
    try {
      expect(await client.send<number>('server', 'count', null, { idempotencyKey: 'k1' })).toBe(1)
      expect(await client.send<number>('server', 'count', null, { idempotencyKey: 'k1' })).toBe(1)
      expect(count).toBe(1)
      expect(await client.send<number>('server', 'count', null, { idempotencyKey: 'k2' })).toBe(2)
      expect(() => client.send<number>('server', 'count', null, { idempotencyKey: '' })).toThrow(
        expect.objectContaining({ code: 'CONTRACT_INVALID' })
      )
      expect(() =>
        client.send<number>('server', 'count', null, { idempotencyKey: 'has space' })
      ).toThrow(expect.objectContaining({ code: 'CONTRACT_INVALID' }))
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('makes an overlapping duplicate wait for the owner result', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createRuntimeEndpointComposition(
      {
        id: 'server',
        transport: serverTransport,
        targetIds: ['client'],
        middlewares: [connect({ transport: serverTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client',
        transport: clientTransport,
        targetIds: ['server'],
        middlewares: [connect({ transport: clientTransport })]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    let count = 0
    let finish: ((value: number) => void) | undefined
    const gate = new Promise<number>((resolve) => {
      finish = resolve
    })
    server.provide('count', async (context) =>
      context.success(
        await gate.then((value) => {
          count += 1
          return value
        })
      )
    )
    try {
      const first = client.send<number>('server', 'count', null, { idempotencyKey: 'k1' })
      const second = client.send<number>('server', 'count', null, { idempotencyKey: 'k1' })
      finish?.(7)
      expect(await Promise.all([first, second])).toEqual([7, 7])
      expect(count).toBe(1)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('releases an aborted owner so a duplicate can execute once', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createRuntimeEndpointComposition(
      {
        id: 'server',
        transport: serverTransport,
        targetIds: ['client'],
        middlewares: [connect({ transport: serverTransport }), abort()]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    const client = await createRuntimeEndpointComposition(
      {
        id: 'client',
        transport: clientTransport,
        targetIds: ['server'],
        middlewares: [connect({ transport: clientTransport }), abort()]
      },
      { agreement: { capabilities: [] }, peerId: '' }
    ).installing
    let count = 0
    let started: (() => void) | undefined
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    server.provide('count', async (context) => {
      count += 1
      if (count === 1) {
        started?.()
        await new Promise<void>((resolve) =>
          context.signal.addEventListener('abort', () => resolve(), { once: true })
        )
      }
      return context.success(count)
    })
    const controller = new AbortController()
    try {
      const first = client.send<number>('server', 'count', null, {
        idempotencyKey: 'k',
        signal: controller.signal
      })
      await firstStarted
      const second = client.send<number>('server', 'count', null, { idempotencyKey: 'k' })
      controller.abort()
      await expect(first).rejects.toMatchObject({ code: 'CANCELLED' })
      expect(await second).toBe(2)
      expect(count).toBe(2)
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })
})
