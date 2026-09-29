import { describe, expect, it } from 'vitest'
import { createClientEndpoint } from '../../src/core/client.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createRpcIdempotencyStore } from '../../src/core/index.js'
import { connect } from '../../src/core/middleware/connect.js'
import { abort } from '../../src/core/middleware/abort.js'

describe('keyed provider execution (A7)', () => {
  it('keeps method tuples distinct and reports retained-result tombstones', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createProviderEndpoint({
      id: 'server',
      transport: serverTransport,
      targetIds: ['client'],
      idempotency: { store: createRpcIdempotencyStore({ maxOutcomeBytes: 10 }) },
      middlewares: [connect({ transport: serverTransport })]
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: clientTransport,
      targetIds: ['server'],
      middlewares: [connect({ transport: clientTransport })]
    })
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
    const server = await createProviderEndpoint({
      id: 'server',
      transport: serverTransport,
      targetIds: ['client'],
      middlewares: [connect({ transport: serverTransport })]
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: clientTransport,
      targetIds: ['server'],
      middlewares: [connect({ transport: clientTransport })]
    })
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
    } finally {
      await client.dispose()
      await server.dispose()
    }
  })

  it('makes an overlapping duplicate wait for the owner result', async () => {
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    const server = await createProviderEndpoint({
      id: 'server',
      transport: serverTransport,
      targetIds: ['client'],
      middlewares: [connect({ transport: serverTransport })]
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: clientTransport,
      targetIds: ['server'],
      middlewares: [connect({ transport: clientTransport })]
    })
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
    const server = await createProviderEndpoint({
      id: 'server',
      transport: serverTransport,
      targetIds: ['client'],
      middlewares: [connect({ transport: serverTransport }), abort()]
    })
    const client = await createClientEndpoint({
      id: 'client',
      transport: clientTransport,
      targetIds: ['server'],
      middlewares: [connect({ transport: clientTransport }), abort()]
    })
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
