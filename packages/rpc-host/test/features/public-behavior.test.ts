import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost } from '@migaia/rpc-host'
import { chunkFeature } from '@migaia/rpc-host/plugins/chunk'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { linkPolicy } from '@migaia/rpc-host/plugins/link-policy'
import { retryFeature } from '@migaia/rpc-host/features/retry'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { coreMemoryServer } from '../host/core-fixture.ts'

/** The original provider timer resolves the same value after exactly its original 30 ms delay. */
function resolveWait(resolve: (value: string) => void): void {
  setTimeout(() => resolve('done'), 30)
}

/** Keep the original Promise/timer behavior outside test registration callback nesting. */
function wait(): Promise<string> {
  return new Promise(resolveWait)
}

/** The original non-idempotent provider remains unresolved until its physical source is retired. */
function pendingEffect(): Promise<never> {
  return new Promise<never>(() => undefined)
}

// Negotiate real chunk hooks over the canonical encoded medium.
it('passes a large payload through the canonical chunk root without duplicate feature admission', async () => {
  /** Both endpoints use the actual SDK JSON codec so chunk sees the real encoded frame. */
  const server = coreMemoryServer('server', 'server', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** Cold flow installation precedes the native transport's sole handshake. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [chunkFeature(), server.transport]
  })
  /** The remote installation negotiates that same extension, without an adapter facade. */
  const client = await server.connect('client', {
    plugins: [chunkFeature()],
    provide: { echo: (value: unknown) => value }
  })
  try {
    /** Preserve the original payload size and exact returned string. */
    const payload = 'large-payload-'.repeat(40_000)
    expect(await host.memory.request('echo', payload)).toBe(payload)
  } finally {
    await client.host.close()
    await host.close()
  }
})

// Paired actual auth hooks must sign and verify equally often.
it('uses canonical authentication transforms on a real connected request and response', async () => {
  /** One shared original callback pair records both physical directions independently. */
  const sign = vi.fn((value: unknown) => value)
  /** The original verifier count must equal real signing after startup is excluded. */
  const verify = vi.fn((value: unknown) => value)
  /** Both genuine installations capture the same transform callbacks. */
  const authentication = { sign, verify }
  /** The real codec owns prepared metadata and restore, rather than a test transform codec. */
  const server = coreMemoryServer('server', 'server', 'memory', [], [], {
    create: () => new RpcJsonCarrierCodec(),
    nativeBinary: false
  })
  /** Authentication is the actual flow plugin, installed before native startup. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [authFeature(authentication), server.transport]
  })
  /** The opposite public Host executes the same original provider and authentication pair. */
  const client = await server.connect('client', {
    plugins: [authFeature(authentication)],
    provide: { echo: (value: unknown) => value }
  })
  try {
    sign.mockClear()
    verify.mockClear()
    expect(await host.memory.request('echo', 42)).toBe(42)
    expect(sign.mock.calls.length).toBeGreaterThan(0)
    expect(verify.mock.calls.length).toBe(sign.mock.calls.length)
  } finally {
    await client.host.close()
    await host.close()
  }
})

// Maps host defaults to transport, feature fallback to link policy.
it('keeps call then transport then link-policy timeout precedence', async () => {
  /** The old host-level 500 ms default is the native transport's complete timeout instance. */
  const server = coreMemoryServer('server', 'server', 'memory', [timeoutFeature({ ms: 500 })])
  /** The old 5 ms feature fallback is the actual link policy beneath transport selection. */
  const host = await createRpcHost({
    ...server.options,
    plugins: [linkPolicy({ features: [timeoutFeature({ ms: 5 })] }), server.transport]
  })
  /** Preserve the original 30 ms provider duration rather than changing timing expectations. */
  const client = await server.connect('client', {
    provide: { wait }
  })
  try {
    expect(await host.memory.request('wait')).toBe('done')
    await expect(
      host.memory.request('wait', undefined, { timeout: timeoutFeature({ ms: 5 }) })
    ).rejects.toMatchObject({ code: 'DEADLINE_EXCEEDED' })
  } finally {
    await client.host.close()
    await host.close()
  }
  /** Omitted transport timeout inherits the same original 5 ms fallback. */
  const fallback = coreMemoryServer('fallback')
  /** No numeric call option or root policy field stands in for the executing instance. */
  const inherited = await createRpcHost({
    ...fallback.options,
    plugins: [linkPolicy({ features: [timeoutFeature({ ms: 5 })] }), fallback.transport]
  })
  /** The second original provider uses the same 30 ms duration. */
  const peer = await fallback.connect('client', {
    provide: { wait }
  })
  try {
    await expect(inherited.memory.request('wait')).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED'
    })
    expect(
      await inherited.memory.request('wait', undefined, { timeout: timeoutFeature({ ms: 500 }) })
    ).toBe('done')
  } finally {
    await peer.host.close()
    await inherited.close()
  }
})

// Keep the original unknown-result code even if current source is RED.
it('reports an unknown non-idempotent result after physical departure instead of replaying it', async () => {
  /** Ordinary listener sessions expose no fabricated generation or readiness authority. */
  const server = coreMemoryServer('server', 'server', 'memory', [retryFeature()])
  /** The actual selected retry feature executes through the public namespace. */
  const host = await createRpcHost(server.options)
  /** Original provider entry proves the physical request arrived before departure. */
  let started!: () => void
  /** The original gate is resolved by business execution, never by a synthetic send receipt. */
  const executing = new Promise<void>((resolve) => {
    started = resolve
  })
  /** Non-idempotent work remains pending until the real physical endpoint disappears. */
  const business = vi.fn(() => {
    started()
    return pendingEffect()
  })
  /** One actual remote public Host owns this provider. */
  const client = await server.connect('client', { provide: { effect: business } })
  try {
    /** Observe rejection immediately while preserving the original 500 ms logical budget. */
    const result = host.memory
      .request('effect', undefined, { timeout: timeoutFeature({ ms: 500 }) })
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

// Preserve both real listener reconnect and caller-abort branches.
it.each(['reconnect', 'abort'] as const)(
  'waits for the real same-name session after an idempotent request departs (%s)',
  async (outcome) => {
    /** The original listener accepts both physical generations on one public Host. */
    const server = coreMemoryServer('server', 'server', 'memory', [retryFeature()])
    /** Retry borrows the listener's actual ready/exit events rather than a managed launcher. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [server.transport]
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
    /** This exact accepted handle completes after its real retirement signal reaches retry. */
    const departed = server.lookup('client')!.handle.closed
    /** Only the original call owns this cancellation reason. */
    const controller = new AbortController()
    /** Native cause identity distinguishes caller cancellation from internal waiter cleanup. */
    const reason = new Error('cancel the listener retry while disconnected')
    /** Settlement must stay pending while no replacement has completed its handshake. */
    let settled = false
    /** Observe the logical result immediately, including rejection, without an unhandled loser. */
    const result = host.memory
      .send('client', 'api.effect', 'original-input', {
        timeout: timeoutFeature({ ms: 1_000 }),
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
      await departed
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
        expect(await host.memory.send('client', 'api.ready')).toBe('replacement-ready')
        expect(secondBusiness).not.toHaveBeenCalled()
      }
      expect(firstBusiness).toHaveBeenCalledTimes(1)
    } finally {
      original.resolve('retired-result')
      await second?.host.close()
      await first.host.close()
      await host.close()
    }
  }
)
