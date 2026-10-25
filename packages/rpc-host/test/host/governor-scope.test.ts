import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { idempotency } from '@migaia/rpc-host/plugins/idempotency'
import { coreMemoryServer } from './core-fixture.js'

describe('accepted host session provider policy', () => {
  it('reuses the original authenticated principal scope after reconnect and isolates a different principal', async () => {
    /** Only actual provider execution may advance this retained business effect. */
    let effects = 0
    /** Different physical callers with the same verified principal must not duplicate this effect. */
    const business = vi.fn(() => ++effects)
    /** Native listener and Session ownership stay with the existing genuine public fixture. */
    const server = coreMemoryServer('server')
    /** Auth alone mints verified Session identity; idempotency owns the principal-keyed outcome. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [
        auth({ verifyCredentials: (value) => ({ principalId: String(value) }) }),
        idempotency(),
        server.transport
      ],
      provide: { service: { business } },
      contract: {
        schemaVersion: 1,
        plugin: 'service',
        features: { api: { methods: { business: { mode: 'request', idempotent: true } } } }
      }
    })
    /** Each actual client sends its own credential through the real handshake verification path. */
    const first = await server.connect('first', { plugins: [auth({ credentials: 'principal-a' })] })
    try {
      expect(
        await first.host.memory.request('service.business', 42, { idempotencyKey: 'one-effect' })
      ).toBe(1)
      await first.host.close()
      /**
       * Reconnect changes physical Session identity while preserving the original verified
       * principal.
       */
      const replacement = await server.connect('replacement', {
        plugins: [auth({ credentials: 'principal-a' })]
      })
      try {
        expect(
          await replacement.host.memory.request('service.business', 42, {
            idempotencyKey: 'one-effect'
          })
        ).toBe(1)
        expect(business).toHaveBeenCalledTimes(1)
        /** A separately verified principal cannot borrow the first principal's retained outcome. */
        const other = await server.connect('other', {
          plugins: [auth({ credentials: 'principal-b' })]
        })
        try {
          expect(
            await other.host.memory.request('service.business', 42, {
              idempotencyKey: 'one-effect'
            })
          ).toBe(2)
          expect(business).toHaveBeenCalledTimes(2)
        } finally {
          await other.host.close()
        }
      } finally {
        await replacement.host.close()
      }
    } finally {
      await first.host.close()
      await host.close()
    }
  })
})
