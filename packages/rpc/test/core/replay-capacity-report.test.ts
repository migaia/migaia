import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/scheduler'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createFirstPartyRoots } from '../../src/core/internal/first-party-roots.js'
import { connect } from '../../src/core/middleware/connect.js'
import { hooks } from '../../src/core/middleware/hooks.js'
import type { IRpcHookEvent } from '../../src/core/typing.js'
import type { IRpcProviderRejection } from '../../src/core/provider-admission.js'

/** Capacity diagnostics exercise real owners and retain the existing RPC refusal behavior. */
describe('local replay capacity reports', () => {
  it('[L3b] shares one constant report budget across inbound and outbound namespaces', async () => {
    /** Both directions on this endpoint read one supported monotonic clock. */
    const scheduler = createManualScheduler()
    /** Real bidirectional peers isolate only the first endpoint's existing quotas. */
    const [firstTransport, secondTransport] = createMemoryTransportPair()
    /** Record only the first endpoint's local capacity evidence. */
    const events: IRpcHookEvent[] = []
    /** Provider and outbound features share the same canonical endpoint diagnostic owner. */
    const roots = createFirstPartyRoots(
      new Set(['first-party-outbound', 'first-party-provider'] as const)
    )
    /** Tiny optional capacities make both namespaces exhaust without changing defaults. */
    const first = await createComposedEndpoint(
      {
        id: 'budget-first',
        transport: firstTransport,
        targetIds: ['budget-second'],
        scheduler,
        replay: { maxEntries: 1 },
        providerLimits: { maxReplayEntriesPerPeer: 1 },
        provider: { echo: (context) => context.success(context.data) },
        middlewares: [
          connect({ transport: firstTransport }),
          hooks({
            listeners: (event) => {
              if (event.detail) events.push(event)
            }
          })
        ]
      },
      roots
    )
    /** The opposite endpoint keeps ordinary replay defaults throughout. */
    const second = await createComposedEndpoint(
      {
        id: 'budget-second',
        transport: secondTransport,
        targetIds: ['budget-first'],
        provider: { echo: (context) => context.success(context.data) },
        middlewares: [connect({ transport: secondTransport })]
      },
      roots
    )
    try {
      await second.send('budget-first', 'echo', null)
      await expect(second.send('budget-first', 'echo', null)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      await first.send('budget-second', 'echo', null)
      await expect(first.send('budget-second', 'echo', null)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(events.map((event) => event.detail!.namespace)).toEqual(['inbound'])
      scheduler.advance(1_000)
      await expect(first.send('budget-second', 'echo', null)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(events.map((event) => event.detail!.namespace)).toEqual(['inbound', 'outbound'])
    } finally {
      await first.dispose()
      await second.dispose()
    }
  })

  it('[L3b] does not report a cached rejection after actual capacity has returned', async () => {
    /** Expiry can free an accepted tombstone while a later rejected identity remains cached. */
    const scheduler = createManualScheduler()
    /** Real frames are retained only as fixture data for repeating the rejected request. */
    const frames: unknown[] = []
    /** Capacity diagnostics must describe actual limits, not every replay admission false. */
    const events: IRpcHookEvent[] = []
    /** All requests use canonical verified memory peer binding. */
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    /** Default 310-second retention is preserved, with a small existing per-peer option. */
    const server = await createProviderEndpoint({
      id: 'cached-server',
      transport: serverTransport,
      scheduler,
      providerLimits: { maxReplayEntriesPerPeer: 1 },
      provider: { echo: (context) => context.success(context.data) },
      middlewares: [
        connect({ transport: serverTransport }),
        hooks({
          listeners: (event) => {
            if (event.detail) events.push(event)
          }
        })
      ]
    })
    /** Caller replay clock stays independent from this server's controlled expiry. */
    const client = await createComposedEndpoint(
      {
        id: 'cached-client',
        transport: clientTransport,
        targetIds: ['cached-server'],
        middlewares: [connect({ transport: clientTransport })]
      },
      createFirstPartyRoots(new Set(['first-party-outbound'] as const))
    )
    /** Records exact incoming frames so repeated identity uses the actual production route. */
    const unsubscribe = serverTransport.subscribe(({ data }) => frames.push(data))
    /** Raw response count lets the unowned repeated response settle before the assertion. */
    const responses: unknown[] = []
    const unsubscribeResponses = clientTransport.subscribe(({ data }) => responses.push(data))
    try {
      await client.send('cached-server', 'echo', null)
      scheduler.advance(309_000)
      await expect(client.send('cached-server', 'echo', null)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      scheduler.advance(500)
      await expect(client.send('cached-server', 'echo', null)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(events).toHaveLength(1)
      scheduler.advance(500)
      await clientTransport.send(frames[2])
      await vi.waitFor(() => expect(responses).toHaveLength(4))
      expect(responses[3]).toMatchObject({ code: 'OVERLOADED', message: 'Provider failed' })
      expect(events).toHaveLength(1)
      await expect(client.send('cached-server', 'echo', 'capacity-returned')).resolves.toBe(
        'capacity-returned'
      )
    } finally {
      unsubscribe()
      unsubscribeResponses()
      await client.dispose()
      await server.dispose()
    }
  })

  it('[L3b] reports outbound exhaustion once per endpoint interval without rebuilding errors', async () => {
    /** Manual monotonic time isolates the report interval from wall-clock and replay retention. */
    const scheduler = createManualScheduler()
    /** Real memory peers execute one request before its released id occupies the whole budget. */
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    /** Record physical requests, so local refusal cannot masquerade as a remote refusal. */
    const received: unknown[] = []
    /** Diagnostic error failures must not alter request rejection or dispatch's synchronous throw. */
    const reporterFailure = new Error('capacity reporter fixture failure')
    /** Captures reporter invocations without allowing its throw to interrupt the response path. */
    const reporter = vi.fn(() => {
      throw reporterFailure
    })
    /** Only capacity hook events are counted; unrelated endpoint hooks remain available. */
    const events: IRpcHookEvent[] = []
    /** Provider replay and wire behavior remain unmodified for this outbound capacity fixture. */
    const server = await createProviderEndpoint({
      id: 'capacity-server',
      transport: serverTransport,
      middlewares: [connect({ transport: serverTransport })],
      provider: { echo: (context) => context.success(context.data) }
    })
    /** Optional public replay configuration isolates exhaustion without changing product defaults. */
    const client = await createComposedEndpoint(
      {
        id: 'capacity-client',
        transport: clientTransport,
        targetIds: ['capacity-server'],
        scheduler,
        replay: { maxEntries: 1 },
        middlewares: [
          connect({ transport: clientTransport }),
          hooks({
            listeners: (event) => {
              if (event.detail) events.push(event)
            },
            onHookError: reporter
          })
        ]
      },
      createFirstPartyRoots(new Set(['first-party-outbound', 'first-party-one-way'] as const))
    )
    /** Raw delivery proves refusal never writes an additional payload or diagnostic frame. */
    const unsubscribe = serverTransport.subscribe(({ data }) => received.push(data))
    try {
      expect(await client.send('capacity-server', 'echo', 'first')).toBe('first')
      /** Exact caller object is also the locally reported error, including its original stack. */
      const refusal = await client
        .send('capacity-server', 'echo', 'secret-capacity-payload')
        .catch((error: unknown) => error)
      expect(refusal).toMatchObject({
        source: '@migaia/rpc/core',
        code: 'OVERLOADED',
        message: 'Replay window is full'
      })
      expect(events).toHaveLength(1)
      expect(events[0]!.error).toBe(refusal)
      expect(events[0]!.detail).toEqual({
        namespace: 'outbound',
        reason: 'outboundReplayFull',
        occupancy: 1,
        limit: 1
      })
      expect(Object.isFrozen(events[0]!.detail)).toBe(true)
      expect(reporter).toHaveBeenCalledTimes(1)
      for (let index = 0; index < 3; index++)
        expect(() => client.dispatch('capacity-server', 'echo', 'secret-dispatch-payload')).toThrow(
          'Replay window is full'
        )
      expect(() => client.sendOneWay('capacity-server', 'echo', 'secret-oneway-payload')).toThrow(
        'Replay window is full'
      )
      scheduler.advance(999)
      await expect(client.send('capacity-server', 'echo', null)).rejects.toMatchObject({
        code: 'OVERLOADED'
      })
      expect(events).toHaveLength(1)
      scheduler.advance(1)
      expect(() => client.dispatch('capacity-server', 'echo', null)).toThrow(
        'Replay window is full'
      )
      await Promise.resolve()
      expect(events).toHaveLength(2)
      expect(reporter).toHaveBeenCalledTimes(2)
      expect(received).toHaveLength(1)
      expect(JSON.stringify(events.map((event) => event.detail))).not.toContain('secret-')
    } finally {
      unsubscribe()
      await client.dispose()
      await server.dispose()
    }
  })

  it.each(['none', 'ok', 'throw', 'reject'] as const)(
    '[L3b] inbound request and one-way refusal preserve callback and wire behavior: %s',
    async (mode) => {
      /** Report rate limiting uses a supported injected monotonic scheduler. */
      const scheduler = createManualScheduler()
      /** Real peer bindings are admitted by canonical memory transport owners. */
      const [clientTransport, serverTransport] = createMemoryTransportPair()
      /** Preserve the exact observer cause for the existing INTERNAL failure report. */
      const original = new Error('capacity observer fixture failure')
      /** Existing rejection callback retains its call count and original returned Promise. */
      const observer = vi.fn((_notice: IRpcProviderRejection) => {
        if (mode === 'throw') throw original
        if (mode === 'reject') return Promise.reject(original)
      })
      /** All diagnostics are observed through production hook delivery. */
      const events: IRpcHookEvent[] = []
      /** A failing diagnostic sink cannot prevent the original observer or the RPC response. */
      const reporter = vi.fn(() => {
        throw original
      })
      /** Per-peer capacity is intentionally small through an existing optional public parameter. */
      const server = await createProviderEndpoint({
        id: 'ledger-server',
        transport: serverTransport,
        scheduler,
        middlewares: [
          connect({ transport: serverTransport }),
          hooks({
            listeners: (event) => {
              if (event.name === 'failure') events.push(event)
            },
            onHookError: reporter
          })
        ],
        providerLimits: {
          maxReplayEntriesPerPeer: 1,
          ...(mode === 'none' ? {} : { onRejected: observer })
        },
        provider: { echo: (context) => context.success(context.data) }
      })
      /** Request and one-way use the same actual provider replay admission. */
      const client = await createComposedEndpoint(
        {
          id: 'ledger-client',
          transport: clientTransport,
          targetIds: ['ledger-server'],
          middlewares: [connect({ transport: clientTransport })]
        },
        createFirstPartyRoots(new Set(['first-party-outbound', 'first-party-one-way'] as const))
      )
      /** Raw responses distinguish the unchanged request error from silent one-way refusal. */
      const replies: unknown[] = []
      const unsubscribe = clientTransport.subscribe(({ data }) => replies.push(data))
      try {
        expect(await client.send('ledger-server', 'echo', null)).toBe(null)
        replies.length = 0
        await expect(
          client.send('ledger-server', 'echo', 'secret-request-payload')
        ).rejects.toMatchObject({ code: 'OVERLOADED', message: 'Provider failed' })
        await client.sendOneWay('ledger-server', 'echo', 'secret-oneway-payload')
        await vi.waitFor(() => expect(observer).toHaveBeenCalledTimes(mode === 'none' ? 0 : 2))
        expect(replies).toHaveLength(1)
        expect(replies[0]).toMatchObject({
          kind: 'response',
          ok: false,
          code: 'OVERLOADED',
          message: 'Provider failed'
        })
        /** Local capacity remains observable even when the optional rejection callback is absent. */
        const capacity = events.filter((event) => event.detail !== undefined)
        expect(capacity).toHaveLength(1)
        expect(capacity[0]!.error).toMatchObject({
          source: '@migaia/rpc/core',
          code: 'OVERLOADED',
          message: 'Request replay ledger is full'
        })
        expect(capacity[0]!.detail).toEqual({
          namespace: 'inbound',
          reason: 'replayLedgerFull',
          occupancy: 1,
          limit: 4096,
          peerOccupancy: 1,
          peerLimit: 1
        })
        expect(Object.isFrozen(capacity[0]!.detail)).toBe(true)
        for (const [notice] of observer.mock.calls) {
          expect(Object.keys(notice).sort()).toEqual([
            'controllerKey',
            'method',
            'reason',
            'verifiedPeerKey'
          ])
          expect(notice.reason).toBe('replayLedgerFull')
        }
        if (mode === 'throw' || mode === 'reject') {
          await vi.waitFor(() =>
            expect(events.filter((event) => event.code === 'INTERNAL')).toHaveLength(2)
          )
          for (const event of events.filter((event) => event.code === 'INTERNAL'))
            expect(event.error).toMatchObject({ cause: original, code: 'INTERNAL' })
        }
        scheduler.advance(1_000)
        await expect(client.send('ledger-server', 'echo', null)).rejects.toMatchObject({
          code: 'OVERLOADED'
        })
        expect(events.filter((event) => event.detail !== undefined)).toHaveLength(2)
        expect(JSON.stringify(events.map((event) => event.detail))).not.toContain('secret-')
      } finally {
        unsubscribe()
        await client.dispose()
        await server.dispose()
      }
    }
  )
})
