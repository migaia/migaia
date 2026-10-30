/** Keeps the original one-consumption stream even when complete retry instances are selected. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { retryFeature } from '@migaia/rpc-host/features/retry'
import { coreMemoryServer } from '../host/core-fixture.ts'

it.each(['before-value', 'after-value'] as const)(
  'does not enter retry policy when a stream fails %s',
  async (mode) => {
    /** These counters observe the actual feature and provider entries, rather than private tables. */
    const state = {
      mode,
      attempts: 0,
      retryEntries: 0,
      failure: new Error('stream provider failed'),
      reports: [] as Array<{ error: unknown; code: unknown }>
    }
    /** Consuming the call's retry options would expose an unintended scalar-policy selection. */
    const retry = {
      get attempts(): number {
        state.retryEntries += 1
        return 2
      }
    }
    /** The actual transport also supplies the policy; stream must suppress both selection levels. */
    const server = coreMemoryServer('caller', 'stream-retry-caller', 'memory', {
      replay: retryFeature({ attempts: 2 })
    })
    /** Both public Hosts retain their original native Session and stream producer. */
    const host = await createRpcHost(server.options)
    /** The provider owns its one generator and its original failure value. */
    const peer = await server.connect('provider', {
      report: (error) => state.reports.push({ error, code: Reflect.get(error as object, 'code') }),
      provide: {
        values: async function* () {
          state.attempts += 1
          if (state.mode === 'after-value') yield 'value'
          throw state.failure
        }
      }
    })
    try {
      /** The per-call complete instance is intentionally present as well as the installed instance. */
      const stream = host.memory.stream('values', undefined, {
        retry
      }) as AsyncIterableIterator<unknown>
      if (mode === 'after-value')
        expect(await stream.next()).toEqual({ done: false, value: 'value' })
      await expect(stream.next()).rejects.toMatchObject({ code: 'INTERNAL' })
      expect(state.attempts).toBe(1)
      expect(state.retryEntries).toBe(0)
      expect(state.reports).toEqual([{ error: state.failure, code: 'INTERNAL' }])
    } finally {
      await peer.host.close()
      await host.close()
    }
  }
)
