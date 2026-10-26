/** Actual public dispatch consumes the sole keyed store and verified principal/Session facts. */
import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { createRpcIdempotencyStore, idempotency } from '@migaia/rpc-host/plugins/idempotency'
import { limits } from '@migaia/rpc-host/plugins/limits'
import { coreMemoryServer } from '../../host/core-fixture.js'

/** These public fixture credentials are shared only by the real verifier and actual clients. */
const principals = { alice: 'principal-alice', bob: 'principal-bob' }

it('withdraws cancelled pending claims without retaining their waiters or cancelling the owner', async () => {
  /** Hold the first provider while repeated public requests join its logical key. */
  const release = deferred<void>()
  const entered = deferred<void>()
  /** Observe the canonical stored entry without adding a production diagnostic surface. */
  let stored: { waiters: Set<unknown> } | undefined
  /** Native methods remain the sole storage operations behind these observations. */
  const mapSet = Map.prototype.set
  const setAdd = Set.prototype.add
  /** Count registration independently from cleanup, including the expected failing implementation. */
  let registrations = 0
  const mapSpy = vi
    .spyOn(Map.prototype, 'set')
    .mockImplementation(function (this: Map<unknown, unknown>, key, value) {
      if (key === 'cancelled-key' && value?.waiters instanceof Set) stored = value
      return Reflect.apply(mapSet, this, [key, value])
    })
  const setSpy = vi
    .spyOn(Set.prototype, 'add')
    .mockImplementation(function (this: Set<unknown>, value) {
      if (this === stored?.waiters) registrations += 1
      return Reflect.apply(setAdd, this, [value])
    })
  /** Every replay and waiter belongs to the real public store installed on the server. */
  const store = createRpcIdempotencyStore()
  const server = coreMemoryServer('waiter-server')
  /** Provider entry distinguishes waiter cancellation from cancellation of the original owner. */
  let calls = 0
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotency({ store }), server.transport],
    provide: {
      hold: async () => {
        calls += 1
        entered.resolve()
        await release.promise
        return 42
      },
      barrier: () => true
    }
  })
  const client = await server.connect('waiter-client')
  /** Observe each request immediately so cleanup cannot leave a fixture rejection unhandled. */
  const pending: Promise<unknown>[] = []
  try {
    const owner = client.host.memory.send('waiter-server', 'hold', undefined, {
      idempotencyKey: 'cancelled-key'
    })
    pending.push(owner)
    void owner.catch(() => undefined)
    await entered.promise
    expect(stored?.waiters).toBeInstanceOf(Set)
    for (let index = 0; index < 32; index++) {
      /** Each caller owns cancellation of its waiter, never the provider's original execution. */
      const cancel = new AbortController()
      const duplicate = client.host.memory.send('waiter-server', 'hold', undefined, {
        idempotencyKey: 'cancelled-key',
        signal: cancel.signal
      })
      pending.push(duplicate)
      void duplicate.catch(() => undefined)
      await vi.waitFor(() => expect(registrations).toBe(index + 1))
      cancel.abort()
      await expect(duplicate).rejects.toMatchObject({ code: 'CANCELLED' })
      await client.host.memory.send('waiter-server', 'barrier')
    }
    expect(registrations).toBe(32)
    await vi.waitFor(() => expect(stored!.waiters.size).toBe(0))
    expect(calls).toBe(1)
    /** A surviving waiter must still receive the owner's terminal outcome. */
    const survivor = client.host.memory.send('waiter-server', 'hold', undefined, {
      idempotencyKey: 'cancelled-key'
    })
    pending.push(survivor)
    await vi.waitFor(() => expect(registrations).toBe(33))
    release.resolve()
    expect(await Promise.all([owner, survivor])).toEqual([42, 42])
    expect(stored!.waiters.size).toBe(0)
    expect(calls).toBe(1)
  } finally {
    mapSpy.mockRestore()
    setSpy.mockRestore()
    release.resolve()
    await Promise.allSettled(pending)
    await Promise.all([client.host.close(), host.close()])
  }
})

it('claims once across one principal and treats a different own-key order as a conflicting body', async () => {
  /** This real provider gate makes overlapping claims observable without a store/controller stub. */
  const release = deferred<void>()
  const entered = deferred<void>()
  /** Provider effects distinguish execution from store replay on another accepted connection. */
  let calls = 0
  /** The same installed store serves all genuinely authenticated native Sessions. */
  const server = coreMemoryServer('keyed-server')
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      idempotency(),
      auth({ verifyCredentials: (credential) => ({ principalId: String(credential) }) }),
      server.transport
    ],
    provide: {
      echo: async () => {
        calls += 1
        if (calls === 1) {
          entered.resolve()
          await release.promise
        }
        return calls
      },
      barrier: () => true
    }
  })
  /** Every actual caller closes even if an earlier assertion stops the business sequence. */
  const clients: Awaited<ReturnType<typeof server.connect>>[] = []
  /** Observing the original joined Promise immediately prevents a fixture unhandled rejection. */
  let joined: Promise<unknown> | undefined
  try {
    const alice = await server.connect('alice-one', {
      plugins: [auth({ credentials: principals.alice })]
    })
    clients.push(alice)
    const sibling = await server.connect('alice-two', {
      plugins: [auth({ credentials: principals.alice })]
    })
    clients.push(sibling)
    const first = alice.host.memory.send(
      'keyed-server',
      'echo',
      { a: 1, b: 2 },
      {
        idempotencyKey: 'shared-key'
      }
    )
    await entered.promise
    const duplicate = sibling.host.memory.send(
      'keyed-server',
      'echo',
      { a: 1, b: 2 },
      {
        idempotencyKey: 'shared-key'
      }
    )
    joined = Promise.all([first, duplicate])
    void joined.catch(() => undefined)
    /** A later ordinary call on the duplicate's same Session crosses its actual dispatch ingress. */
    await sibling.host.memory.send('keyed-server', 'barrier')
    expect(calls).toBe(1)
    release.resolve()
    expect(await joined).toEqual([1, 1])
    await expect(
      sibling.host.memory.send(
        'keyed-server',
        'echo',
        { b: 2, a: 1 },
        {
          idempotencyKey: 'shared-key'
        }
      )
    ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'CONTRACT_INVALID' })
    expect(calls).toBe(1)
    expect(
      await sibling.host.memory.send(
        'keyed-server',
        'echo',
        { b: 2, a: 1 },
        {
          idempotencyKey: 'fresh-key'
        }
      )
    ).toBe(2)
    const bob = await server.connect('bob', { plugins: [auth({ credentials: principals.bob })] })
    clients.push(bob)
    expect(
      await bob.host.memory.send(
        'keyed-server',
        'echo',
        { a: 1, b: 2 },
        {
          idempotencyKey: 'shared-key'
        }
      )
    ).toBe(3)
    expect(calls).toBe(3)
  } finally {
    release.resolve()
    await joined?.catch(() => undefined)
    await Promise.all([...clients.map((client) => client.host.close()), host.close()])
  }
})

it('keeps concurrency local to each real Session even when their authenticated principal matches', async () => {
  /** Both original providers remain occupied until the fixture's business cleanup releases them. */
  const release = deferred<void>()
  const firstEntered = deferred<void>()
  const bothEntered = deferred<void>()
  /** This observes actual simultaneous provider entry, not originating client Promise counts. */
  let active = 0
  const server = coreMemoryServer('session-limit-server')
  const host = await createRpcHost({
    ...server.options,
    plugins: [
      limits({ maxGlobal: 2, maxPerPeer: 1 }),
      auth({ verifyCredentials: () => ({ principalId: principals.alice }) }),
      server.transport
    ],
    provide: {
      hold: async (_value, context) => {
        active += 1
        firstEntered.resolve()
        if (active === 2) bothEntered.resolve()
        try {
          await release.promise
          return {
            principalId: context.principalId,
            connectionId: context.connectionId,
            sessionId: context.sessionId
          }
        } finally {
          active -= 1
        }
      }
    }
  })
  /** Same-principal connections remain different native owners and finally-owned real Hosts. */
  const clients: Awaited<ReturnType<typeof server.connect>>[] = []
  const pending: Promise<unknown>[] = []
  try {
    const first = await server.connect('first-session', {
      plugins: [auth({ credentials: principals.alice })]
    })
    clients.push(first)
    const second = await server.connect('second-session', {
      plugins: [auth({ credentials: principals.alice })]
    })
    clients.push(second)
    pending.push(first.host.memory.send('session-limit-server', 'hold'))
    void pending[0]!.catch(() => undefined)
    await firstEntered.promise
    await expect(first.host.memory.send('session-limit-server', 'hold')).rejects.toMatchObject({
      code: 'OVERLOADED'
    })
    pending.push(second.host.memory.send('session-limit-server', 'hold'))
    void pending[1]!.catch(() => undefined)
    await bothEntered.promise
    expect(active).toBe(2)
    release.resolve()
    expect(await Promise.all(pending)).toEqual([
      {
        principalId: principals.alice,
        connectionId: first.pair[0].id,
        sessionId: first.pair[0].id
      },
      {
        principalId: principals.alice,
        connectionId: second.pair[0].id,
        sessionId: second.pair[0].id
      }
    ])
  } finally {
    release.resolve()
    await Promise.allSettled(pending)
    await Promise.all([...clients.map((client) => client.host.close()), host.close()])
  }
})

it('seals and replays only the original actual stream final completion without retaining yields', async () => {
  /** Only actual generator construction changes this business count. */
  let starts = 0
  const server = coreMemoryServer('stream-key-server')
  const host = await createRpcHost({
    ...server.options,
    plugins: [idempotency(), server.transport]
  })
  const client = await server.connect('stream-caller', {
    plugins: [idempotency()],
    provide: {
      values: async function* () {
        starts += 1
        yield 1
        yield 2
        return 42
      }
    }
  })
  try {
    const first = host.memory.stream('values', undefined, {
      cancel: 'before-start',
      idempotencyKey: 'stream-completion'
    }) as AsyncIterator<unknown>
    expect(await first.next()).toEqual({ done: false, value: 1 })
    expect(await first.next()).toEqual({ done: false, value: 2 })
    expect(await first.next()).toEqual({ done: true, value: 42 })
    expect(await host.memory.outcome('stream-completion')).toMatchObject({
      state: 'done',
      outcome: { mode: 'stream', completion: { ok: true, result: 42 } }
    })
    const replay = host.memory.stream('values', undefined, {
      cancel: 'before-start',
      idempotencyKey: 'stream-completion'
    }) as AsyncIterator<unknown>
    expect(await replay.next()).toEqual({ done: true, value: 42 })
    expect(starts).toBe(1)
  } finally {
    await Promise.all([client.host.close(), host.close()])
  }
})
