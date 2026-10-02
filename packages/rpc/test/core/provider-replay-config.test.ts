import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createProviderEndpoint } from '../../src/core/provider.js'
import { createComposedEndpoint } from '../../src/core/composed.js'
import { createFirstPartyRoots } from '../../src/core/internal/first-party-roots.js'
import { connect } from '../../src/core/middleware/connect.js'

describe('provider replay workload configuration', () => {
  it.each([undefined, 1101])(
    '[K255/K256] retains the default 1024 while accepting an explicit %s workload',
    async (maximum) => {
      /** Both peers exercise the canonical provider replay ledger through real routed requests. */
      const [clientTransport, serverTransport] = createMemoryTransportPair()
      /** Only the optional inbound replay limit differs between these two sessions. */
      const server = await createProviderEndpoint({
        id: 'replay-server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport })],
        ...(maximum === undefined ? {} : { providerLimits: { maxReplayEntriesPerPeer: maximum } }),
        provider: { echo: (context) => context.success(context.data) }
      })
      /** Outbound identifiers remain at their existing independent 4096 ceiling. */
      const client = await createComposedEndpoint(
        {
          id: 'replay-client',
          transport: clientTransport,
          targetIds: ['replay-server'],
          middlewares: [connect({ transport: clientTransport })]
        },
        createFirstPartyRoots(new Set(['first-party-outbound'] as const))
      )
      try {
        for (let index = 0; index < (maximum ?? 1024); index++)
          expect(await client.send('replay-server', 'echo', index)).toBe(index)
        await expect(client.send('replay-server', 'echo', null)).rejects.toMatchObject({
          code: 'OVERLOADED'
        })
      } finally {
        await client.dispose()
        await server.dispose()
      }
    }
  )
  it.each([0, -1, 1.5, NaN])('[K256] rejects invalid explicit replay limit %s', async (value) => {
    /** Invalid new configuration rejects before the provider receives any requests. */
    const [, transport] = createMemoryTransportPair()
    await expect(
      createProviderEndpoint({
        id: 'invalid-replay',
        transport,
        middlewares: [connect({ transport })],
        providerLimits: { maxReplayEntriesPerPeer: value }
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })
})
