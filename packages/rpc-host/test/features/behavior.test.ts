import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost } from '../../dist/index.js'
import {
  chunkFeature,
  authFeature,
  retryFeature,
  timeoutFeature
} from '../../dist/features/index.js'
import { memoryServer } from '../host/fixture.js'

describe('installed public RPC features', () => {
  it('passes a large payload through the canonical chunk root without duplicate feature admission', async () => {
    const server = memoryServer('server')
    const host = await createRpcHost({
      ...server.options,
      plugins: [server.transport, chunkFeature()]
    })
    const client = await server.connect('client', { provide: { echo: (value: unknown) => value } })
    try {
      const payload = 'large-payload-'.repeat(40_000)
      expect(await host.request('echo', payload)).toBe(payload)
    } finally {
      await client.host.close()
      await host.close()
    }
  })

  it('uses canonical authentication transforms on a real connected request and response', async () => {
    const sign = vi.fn((value: unknown) => value)
    const verify = vi.fn((value: unknown) => value)
    const authentication = { sign, verify }
    const server = memoryServer('server')
    const host = await createRpcHost({
      ...server.options,
      plugins: [server.transport, authFeature(authentication)]
    })
    const client = await server.connect('client', {
      authentication,
      provide: { echo: (value: unknown) => value }
    })
    try {
      sign.mockClear()
      verify.mockClear()
      expect(await host.request('echo', 42)).toBe(42)
      expect(sign.mock.calls.length).toBeGreaterThan(0)
      expect(verify.mock.calls.length).toBe(sign.mock.calls.length)
    } finally {
      await client.host.close()
      await host.close()
    }
  })

  it('keeps call then host then feature timeout precedence through the original timeout middleware', async () => {
    const server = memoryServer('server')
    const host = await createRpcHost({
      ...server.options,
      defaultTimeoutMs: 500,
      plugins: [server.transport, timeoutFeature({ ms: 5 })]
    })
    const client = await server.connect('client', {
      provide: { wait: () => new Promise((resolve) => setTimeout(() => resolve('done'), 30)) }
    })
    try {
      expect(await host.request('wait')).toBe('done')
      await expect(host.request('wait', undefined, { timeoutMs: 5 })).rejects.toMatchObject({
        code: 'DEADLINE_EXCEEDED'
      })
    } finally {
      await client.host.close()
      await host.close()
    }
    const fallback = memoryServer('fallback')
    const inherited = await createRpcHost({
      ...fallback.options,
      plugins: [fallback.transport, timeoutFeature({ ms: 5 })]
    })
    const peer = await fallback.connect('client', {
      provide: { wait: () => new Promise((resolve) => setTimeout(() => resolve('done'), 30)) }
    })
    try {
      await expect(inherited.request('wait')).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
      expect(await inherited.request('wait', undefined, { timeoutMs: 500 })).toBe('done')
    } finally {
      await peer.host.close()
      await inherited.close()
    }
  })

  it('reports an unknown non-idempotent result after physical departure instead of replaying it', async () => {
    const server = memoryServer('server')
    const host = await createRpcHost({
      ...server.options,
      plugins: [server.transport, retryFeature()]
    })
    let started!: () => void
    const executing = new Promise<void>((resolve) => {
      started = resolve
    })
    const business = vi.fn(() => {
      started()
      return new Promise<never>(() => undefined)
    })
    const client = await server.connect('client', { provide: { effect: business } })
    try {
      const result = host
        .request('effect', undefined, { timeoutMs: 500 })
        .catch((error: unknown) => error)
      await executing
      client.pair[1].close()
      expect(await result).toMatchObject({ code: 'REMOTE_RESULT_UNKNOWN' })
      expect(business).toHaveBeenCalledTimes(1)
    } finally {
      await client.host.close()
      await host.close()
    }
  })

  it.each(['reconnect', 'abort'] as const)(
    'waits for the real same-name session after an idempotent request departs (%s)',
    async (outcome) => {
      /** The original listener accepts both physical generations on one public Host. */
      const server = memoryServer('server')
      /** Retry borrows the listener's actual ready/exit events rather than a managed launcher. */
      const host = await createRpcHost({
        ...server.options,
        plugins: [server.transport, retryFeature()]
      })
      /** Only this real provider declaration grants replay after an unknown result. */
      const contract = {
        schemaVersion: 1,
        plugin: 'api',
        features: {
          work: {
            methods: {
              effect: { mode: 'request', idempotent: true },
              ready: { mode: 'request', idempotent: false }
            }
          }
        }
      } as const
      /** The provider must execute before its physical carrier is retired. */
      const entered = deferred<void>()
      /** Hold the first result until cleanup, so it cannot win over real departure. */
      const original = deferred<string>()
      /** One call in the old generation is observable independently of the replay. */
      const firstBusiness = vi.fn(() => {
        entered.resolve()
        return original.promise
      })
      /** A new handshake must install a distinct physical instance under the same public name. */
      const first = await server.connect(
        'client',
        { contract, provide: { api: { effect: firstBusiness, ready: () => 'first-ready' } } },
        'client-first'
      )
      /** Only the original call owns this cancellation reason. */
      const controller = new AbortController()
      /** Native cause identity distinguishes caller cancellation from internal waiter cleanup. */
      const reason = new Error('cancel the listener retry while disconnected')
      /** Public exit is emitted after the existing retry owner registers its readiness waiter. */
      const departed = deferred<void>()
      /** Retain just this event subscription for normal test cleanup. */
      const removeExit = host.on('exit', (event) => {
        if (event.name === 'client') departed.resolve()
      })
      /** Settlement must stay pending while no replacement has completed its handshake. */
      let settled = false
      /** Observe the logical result immediately, including rejection, without an unhandled loser. */
      const result = host
        .send('client', 'api.effect', 'original-input', {
          timeoutMs: 1_000,
          idempotencyKey: 'listener-retry',
          signal: controller.signal
        })
        .then(
          (value) => {
            settled = true
            return value
          },
          (error: unknown) => {
            settled = true
            return error
          }
        )
      /** Count replacement business independently of both old work and a control round trip. */
      const secondBusiness = vi.fn((value: unknown) => ({ recovered: value }))
      /** The finally block closes any successfully acquired replacement host. */
      let second: Awaited<ReturnType<typeof server.connect>> | undefined
      try {
        await entered.promise
        first.pair[1].close()
        await departed.promise
        expect(settled).toBe(false)
        expect(firstBusiness).toHaveBeenCalledTimes(1)
        if (outcome === 'abort') {
          controller.abort(reason)
          /** The caller's original abort reason must survive the readiness wait unchanged. */
          const failure = await result
          expect(failure).toMatchObject({ code: 'CANCELLED', cause: reason })
          expect((failure as Error).cause).toBe(reason)
        }
        second = await server.connect(
          'client',
          {
            contract,
            provide: { api: { effect: secondBusiness, ready: () => 'replacement-ready' } }
          },
          'client-second'
        )
        expect(second.host.self.instanceId).toBe('client-second')
        if (outcome === 'reconnect') {
          expect(await result).toEqual({ recovered: 'original-input' })
          expect(secondBusiness).toHaveBeenCalledTimes(1)
        } else {
          // This real round trip also lets any incorrectly retained readiness replay become visible.
          expect(await host.send('client', 'api.ready')).toBe('replacement-ready')
          expect(secondBusiness).not.toHaveBeenCalled()
        }
        expect(firstBusiness).toHaveBeenCalledTimes(1)
      } finally {
        original.resolve('retired-result')
        removeExit()
        await second?.host.close()
        await first.host.close()
        await host.close()
      }
    }
  )
})
