/** Preserve migrated public routing, fanout and name-admission assertions under namespaces. */
import { deferred } from '@migaia/utils/promise'
import type { IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { createRpcHost } from '@migaia/rpc-host'
import { describe, expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.ts'

/** Fully drain only the concrete returned iterators used by these business assertions. */
async function items(value: AsyncIterable<unknown>) {
  /** Collect the actual iterator values in their original order, without a relay or replay. */
  const result: unknown[] = []
  for await (const item of value) result.push(item)
  return result
}

describe('RPC namespace routing', () => {
  it('uses scalar single-target calls and null-prototype zero/multiple-target settlements', async () => {
    /** The real listener owns accepted physical sources for this namespace oracle. */
    const server = coreMemoryServer('server')
    /** Public construction owns the single native host and its mandatory execution owners. */
    const host = await createRpcHost({
      ...server.options,
      provide: { reverse: (value: string) => [...value].reverse().join('') }
    })
    try {
      expect(await host.memory.request('value')).toEqual({ fulfilled: {}, rejected: {} })
      /** An empty target set must still publish the original null-prototype settlement maps. */
      const zero = await host.memory.group([])
      expect(Object.getPrototypeOf((zero as { fulfilled: object }).fulfilled)).toBeNull()
      /**
       * This accepted direct provider retains its original identity and independently owned
       * cleanup.
       */
      const first = await server.connect('first', {
        provide: {
          value: (value?: unknown) => value ?? 1,
          sequence: async function* () {
            yield 1
            yield 2
          }
        }
      })
      try {
        expect(await host.memory.request('value', 4)).toBe(4)
        expect(await first.host.memory.request('reverse', 'abc')).toBe('cba')
        expect(await items(host.memory.stream('sequence') as AsyncIterable<unknown>)).toEqual([
          1, 2
        ])
        /** A second actual source changes fanout cardinality without replacing the first provider. */
        const second = await server.connect('second', {
          provide: {
            value: () => 9,
            sequence: async function* () {
              yield 9
            }
          }
        })
        try {
          expect(await host.memory.request('value')).toEqual({
            fulfilled: { '["target","first"]': 1, '["target","second"]': 9 },
            rejected: {}
          })
          expect(await host.memory.send('first', 'value', 7)).toBe(7)
          await expect(host.memory.send('nobody', 'value')).rejects.toMatchObject({
            code: 'TARGET_UNKNOWN'
          })
          /** Each fanout entry retains its own original lazy iterator and business sequence. */
          const streams = host.memory.stream('sequence') as {
            fulfilled: Record<string, AsyncIterable<unknown>>
          }
          expect(await items(streams.fulfilled['["target","first"]']!)).toEqual([1, 2])
          expect(await items(streams.fulfilled['["target","second"]']!)).toEqual([9])
        } finally {
          await second.host.close()
        }
      } finally {
        await first.host.close()
      }
    } finally {
      await host.close()
    }
  })

  it('forwards namespace and held capabilities through the canonical provider owner', async () => {
    /** The gateway is a real public listener, not a synthetic forward relay. */
    const b = coreMemoryServer('b')
    /** Public construction owns the single native host and its mandatory execution owners. */
    const host = await createRpcHost(b.options)
    /** This accepted direct target supplies the capability later held across retirement. */
    const c = await b.connect('c', {
      provide: { render: (value: unknown) => ({ rendered: value }) }
    })
    try {
      /**
       * The exact callable retains its original physical generation and cannot retarget a
       * successor.
       */
      const held = host.memory.peers.c!.render!
      host.provide({ render: held })
      /** The source can reach the target only through the gateway host. */
      const a = await b.connect('a')
      try {
        expect(await a.host.memory.send('b', 'c.render', 42)).toEqual({ rendered: 42 })
        expect(await a.host.memory.send('b', 'render', 7)).toEqual({ rendered: 7 })
        await expect(a.host.memory.send('c', 'render', 1)).rejects.toMatchObject({
          code: 'TARGET_UNKNOWN'
        })
        await expect(a.host.memory.send('b', 'c.missing', 1)).rejects.toMatchObject({
          code: 'PROVIDER_NOT_FOUND'
        })
        /** A method absent from the current direct directory is refused locally before forwarding. */
        await expect(a.host.memory.send('b', 'nobody.render', 1)).rejects.toMatchObject({
          code: 'PROVIDER_NOT_FOUND'
        })
        await c.host.close()
        /** Rejects the withdrawn dotted method locally once the current directory arrives. */
        await vi.waitFor(() => expect(a.host.memory.peers.b).not.toHaveProperty('c.render'))
        await expect(a.host.memory.send('b', 'c.render', 1)).rejects.toMatchObject({
          code: 'PROVIDER_NOT_FOUND'
        })
        /** The same display name now refers to a new real accepted physical generation. */
        const replacement = await b.connect('c', { provide: { render: () => 'new' } }, 'c-new')
        try {
          await expect(held()).rejects.toMatchObject({ code: 'TARGET_UNKNOWN' })
          expect(await host.memory.peers.c!.render!()).toBe('new')
        } finally {
          await replacement.host.close()
        }
      } finally {
        await a.host.close()
      }
    } finally {
      await c.host.close()
      await host.close()
    }
  })

  it('rejects a live same-name newcomer while the original remains callable', async () => {
    /** The real listener owns accepted physical sources for this namespace oracle. */
    const server = coreMemoryServer('server')
    /** Public construction owns the single native host and its mandatory execution owners. */
    const host = await createRpcHost(server.options)
    /** This accepted direct provider retains its original identity and independently owned cleanup. */
    const first = await server.connect('client', { provide: { value: () => 1 } }, 'original')
    try {
      await expect(
        server.connect('client', { provide: { value: () => 2 } }, 'duplicate')
      ).rejects.toMatchObject({ code: 'HOST_PEER_NAME_DUPLICATE' })
      expect(await host.memory.send('client', 'value')).toBe(1)
    } finally {
      await first.host.close()
      await host.close()
    }
  })
  it('refuses a colliding physical identity without retiring the original session or its calls', async () => {
    /** The original accepted client keeps one actual provider operation in progress. */
    const entered = deferred<void>()
    /** Only the original provider controls completion of its pending operation. */
    const resumed = deferred<void>()
    /** A real listener owns both physical attempts and its one endpoint inventory. */
    const server = coreMemoryServer('identity-server')
    /** The first accepted session must survive the later source admission failure. */
    const host = await createRpcHost(server.options)
    /** Display names differ, so this is physical-id admission rather than same-name arbitration. */
    const first = await server.connect(
      'original-name',
      {
        provide: {
          value: () => 'original',
          pending: async () => {
            entered.resolve()
            await resumed.promise
            return 'original-completion'
          }
        }
      },
      'shared-physical-id'
    )
    /** Observe either settlement immediately without swallowing a failure from the final oracle. */
    const pending = host.memory.send('original-name', 'pending').then(
      (value) => ({ value }),
      (error: unknown) => ({ error })
    )
    try {
      await entered.promise
      await expect(
        server.connect(
          'different-name',
          { provide: { value: () => 'candidate' } },
          'shared-physical-id'
        )
      ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'CAPABILITY_CONFLICT' })
      expect(Object.keys(host.memory.peers)).toEqual(['original-name'])
      expect(await host.memory.send('original-name', 'value')).toBe('original')
      resumed.resolve()
      expect(await pending).toEqual({ value: 'original-completion' })
    } finally {
      resumed.resolve()
      await first.host.close()
      await host.close()
    }
  })
  it('accepts a same-name successor of a physically closed session without probing it', async () => {
    /** The real listener owns accepted physical sources for this namespace oracle. */
    const server = coreMemoryServer('closed-server')
    /** Public construction owns the single native host and its mandatory execution owners. */
    const host = await createRpcHost(server.options)
    /** This accepted direct provider retains its original identity and independently owned cleanup. */
    const first = await server.connect('client', { provide: { value: () => 1 } }, 'closed-first')
    /** Retain the native write receiver while observing actual control frames. */
    const original = first.pair[0].write
    /** Only actual physical ping controls count toward the no-probe assertion. */
    const pings: unknown[] = []
    vi.spyOn(first.pair[0], 'write').mockImplementation((frame, options) => {
      /** Inspect the actual sole semantic control, rather than the deleted variation wrapper. */
      const message = frame.data as IRpcSemanticFrame
      if (message.kind === 'control' && message.operation === 'ping') pings.push(frame)
      return original(frame, options)
    })
    try {
      await first.host.close()
      expect(first.pair[0].closed).toBe(true)
      /** A second actual source changes fanout cardinality without replacing the first provider. */
      const second = await server.connect(
        'client',
        { provide: { value: () => 2 } },
        'closed-second'
      )
      try {
        expect(await host.memory.send('client', 'value')).toBe(2)
        expect(pings).toHaveLength(0)
      } finally {
        await second.host.close()
      }
    } finally {
      vi.restoreAllMocks()
      await first.host.close()
      await host.close()
    }
  })

  it('selects the longest live peer prefix before its method and withdraws only the retired prefix', async () => {
    /** The real gateway accepts two names whose prefixes overlap on an advertised business path. */
    const server = coreMemoryServer('gateway')
    /** Any fallback to the shorter peer is observable as actual business execution. */
    const lower = vi.fn(() => 42)
    /** One public host owns all three accepted direct sessions. */
    const host = await createRpcHost(server.options)
    /** This real method is hidden while the longer admitted peer name remains live. */
    const shorter = await server.connect('a', { provide: { b: { c: lower } } })
    /** A missing method on the longest peer must not silently choose another business target. */
    const longer = await server.connect('a.b', { provide: { other: () => true } })
    /** The source has no direct physical access to either target. */
    const caller = await server.connect('caller')
    try {
      await expect(caller.host.memory.send('gateway', 'a.b.c')).rejects.toMatchObject({
        code: 'PROVIDER_NOT_FOUND'
      })
      expect(lower).toHaveBeenCalledTimes(0)
      await longer.host.close()
      /** The shorter real method becomes selectable only after the revised directory is visible. */
      await vi.waitFor(() => expect(caller.host.memory.peers.gateway).toHaveProperty('a.b.c'))
      expect(await caller.host.memory.send('gateway', 'a.b.c')).toBe(42)
      expect(lower).toHaveBeenCalledTimes(1)
      await shorter.host.close()
      /** The final withdrawal removes this path from the caller's current direct directory. */
      await vi.waitFor(() => expect(caller.host.memory.peers.gateway).not.toHaveProperty('a.b.c'))
      await expect(caller.host.memory.send('gateway', 'a.b.c')).rejects.toMatchObject({
        code: 'PROVIDER_NOT_FOUND'
      })
      expect(lower).toHaveBeenCalledTimes(1)
    } finally {
      await Promise.all([
        caller.host.close(),
        shorter.host.close(),
        longer.host.close(),
        host.close()
      ])
    }
  })
})
