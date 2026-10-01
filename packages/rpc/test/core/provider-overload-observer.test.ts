import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { connect } from '../../src/core/middleware/connect.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createFirstPartyRoots } from '../../src/core/internal/first-party-roots.js'
import type { IRpcProviderRejection } from '../../src/core/provider-admission.js'
import { hooks } from '../../src/core/middleware/hooks.js'

/** Exercises the optional owner observer through real core request admission and responses. */
describe('provider concurrency observer', () => {
  it.each(['none', 'ok', 'throw', 'reject'] as const)(
    '[K215] preserves request and one-way refusals with observer: %s',
    async (mode) => {
      /** Real provider work occupies the single concurrency lease until cleanup. */
      let finish!: () => void
      /** The held call proves an overload cannot execute a second provider. */
      const held = new Promise<void>((resolve) => {
        finish = resolve
      })
      /** Keep the exact observer error available to the canonical failure hook. */
      const original = new Error('observer fixture failure')
      /** Record local observer calls independently of provider executions. */
      const observer = vi.fn((_rejection: IRpcProviderRejection) => {
        if (mode === 'throw') throw original
        if (mode === 'reject') return Promise.reject(original)
      })
      /** Collect the existing hook channel rather than changing the refusal result. */
      const reports: unknown[] = []
      /** Provider entry is the exact business boundary denied by concurrency admission. */
      const provider = vi.fn(
        async (context: Parameters<import('../../src/core/typing.js').IRpcProvider>[0]) => {
          await held
          return context.success('done')
        }
      )
      /** Memory transport uses the same production provider owner as native endpoints. */
      const [clientTransport, serverTransport] = createMemoryTransportPair()
      /** The optional callback does not change either configured concurrency limit. */
      const server = await createProviderEndpoint({
        id: 'overload-server',
        transport: serverTransport,
        middlewares: [
          connect({ transport: serverTransport }),
          hooks({
            listeners: (event) => {
              if (event.name === 'failure') reports.push(event)
            }
          })
        ],
        providerLimits: {
          maxGlobal: 1,
          maxPerPeer: 1,
          ...(mode === 'none' ? {} : { onRejected: observer })
        },
        provider: { hold: provider }
      })
      /** A real sender decodes the unchanged canonical OVERLOADED response. */
      const client = await createComposedEndpoint(
        {
          id: 'overload-client',
          transport: clientTransport,
          targetIds: ['overload-server'],
          middlewares: [connect({ transport: clientTransport })]
        },
        createFirstPartyRoots(new Set(['first-party-outbound', 'first-party-one-way'] as const))
      )
      /** Observe raw replies to distinguish request refusal from silent one-way rejection. */
      const replies: unknown[] = []
      const unsubscribe = clientTransport.subscribe(({ data }) => {
        replies.push(data)
      })
      /** The admitted request remains in flight while both refusals arrive. */
      const first = client.send('overload-server', 'hold', null)
      try {
        await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(1))
        for (let attempt = 0; attempt < 2; attempt += 1)
          await expect(client.send('overload-server', 'hold', null)).rejects.toMatchObject({
            code: 'OVERLOADED'
          })
        await client.sendOneWay('overload-server', 'hold', 'secret-fixture-payload')
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(observer).toHaveBeenCalledTimes(mode === 'none' ? 0 : 3)
        for (const [rejection] of observer.mock.calls) {
          expect(Object.keys(rejection).sort()).toEqual([
            'controllerKey',
            'method',
            'reason',
            'verifiedPeerKey'
          ])
          expect(rejection).toMatchObject({ method: 'hold', reason: 'concurrency' })
          expect(JSON.stringify(rejection)).not.toContain('secret-fixture-payload')
          expect(Object.isFrozen(rejection)).toBe(true)
        }
        expect(provider).toHaveBeenCalledTimes(1)
        expect(replies).toHaveLength(2)
        for (const response of replies)
          expect(response).toMatchObject({
            kind: 'response',
            ok: false,
            code: 'OVERLOADED',
            message: 'Provider failed'
          })
        if (mode === 'throw' || mode === 'reject') {
          expect(reports).toHaveLength(3)
          for (const report of reports)
            expect(report).toMatchObject({
              code: 'INTERNAL',
              error: { code: 'INTERNAL', source: '@migaia/rpc/core', cause: original }
            })
        } else expect(reports).toEqual([])
        finish()
        await expect(first).resolves.toBe('done')
      } finally {
        unsubscribe()
        finish()
        await first.catch(() => undefined)
        await client.dispose()
        await server.dispose()
      }
    }
  )
})
