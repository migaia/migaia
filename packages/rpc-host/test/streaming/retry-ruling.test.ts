/** R20 keeps the original one-consumption stream even when complete retry instances are selected. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import {
  RpcCallFeatureKind,
  type IRpcRetryFeature,
  type IRpcAttempt
} from '@migaia/rpc-contract/interfaces'
import { coreMemoryServer } from '../host/core-fixture.js'

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
    /** A complete caller-owned policy would visibly enter if StreamChannel selected retry. */
    const retry: IRpcRetryFeature = {
      kind: RpcCallFeatureKind.retry,
      run<T>(attempt: IRpcAttempt<T>): Promise<T> {
        state.retryEntries += 1
        return attempt.invoke(attempt.signal, attempt.remainingMs)
      }
    }
    /** The actual transport also supplies the policy; stream must suppress both selection levels. */
    const server = coreMemoryServer('caller', 'stream-retry-caller', 'memory', [retry])
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
