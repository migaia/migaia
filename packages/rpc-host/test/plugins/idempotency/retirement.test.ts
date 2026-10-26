/** Carrier-owned idempotency entries retire with their connection; shared scopes retain outcomes. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { createRpcIdempotencyStore, idempotency } from '@migaia/rpc-host/plugins/idempotency'
import { coreMemoryServer } from '../../host/core-fixture.js'

it.each(['carrier', 'principal', 'custom'] as const)(
  'retires only connection-owned outcomes when a %s scope disconnects',
  async (mode) => {
    /** The sole slot makes retained scope ownership visible through normal capacity admission. */
    const store = createRpcIdempotencyStore({ maxEntries: 1 })
    const server = coreMemoryServer('retirement-server')
    /** Provider effects distinguish carrier re-execution from shared-scope replay. */
    let calls = 0
    const host = await createRpcHost({
      ...server.options,
      plugins: [
        idempotency({ store, ...(mode === 'custom' ? { scope: () => 'shared-scope' } : {}) }),
        ...(mode === 'principal'
          ? [auth({ verifyCredentials: () => ({ principalId: 'verified-owner' }) })]
          : []),
        server.transport
      ],
      provide: { echo: () => ++calls }
    })
    /** Every connecting host is finally owned even when the expected admission fails. */
    const clients: Awaited<ReturnType<typeof server.connect>>[] = []
    try {
      const first = await server.connect('retirement-first', {
        plugins: mode === 'principal' ? [auth({ credentials: 'fixture-credential' })] : []
      })
      clients.push(first)
      expect(
        await first.host.memory.send('retirement-server', 'echo', undefined, {
          idempotencyKey: 'retired-key'
        })
      ).toBe(1)
      await first.host.close()
      const second = await server.connect('retirement-second', {
        plugins: mode === 'principal' ? [auth({ credentials: 'fixture-credential' })] : []
      })
      clients.push(second)
      expect(
        await second.host.memory.send('retirement-server', 'echo', undefined, {
          idempotencyKey: 'retired-key'
        })
      ).toBe(mode === 'carrier' ? 2 : 1)
      expect(calls).toBe(mode === 'carrier' ? 2 : 1)
      /** Shared outcomes keep their capacity charge rather than silently freeing or rerunning. */
      await expect(
        second.host.memory.send('retirement-server', 'echo', undefined, {
          idempotencyKey: 'fresh-key'
        })
      ).rejects.toMatchObject({ code: 'OVERLOADED' })
    } finally {
      await Promise.all([...clients.map((client) => client.host.close()), host.close()])
    }
  }
)
