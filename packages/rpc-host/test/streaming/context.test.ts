import { describe, expect, it } from 'vitest'
import type { IRpcContext } from '@migaia/rpc-host'
import { connectedCoreHosts } from '../host/core-fixture.js'

describe('streaming provider context', () => {
  it('passes the original stream context through iterator execution and isolates ordinary requests', async () => {
    /** Context references are observed only through actual public business callbacks. */
    const contexts: { ordinary?: IRpcContext; stream?: IRpcContext } = {}
    /** Provider methods receive the canonical context directly, without a legacy stream wrapper. */
    const fixture = await connectedCoreHosts(
      {
        ordinary: (_params, context) => {
          contexts.ordinary = context
          return context.success('ok')
        },
        stream: function* (params, context) {
          contexts.stream = context
          /** The original native signal survives generator suspension and cleanup unchanged. */
          const signal = context.signal
          expect(context.data).toEqual(params)
          expect(typeof context.dispatchTo).toBe('function')
          try {
            yield 'item'
          } finally {
            expect(context.signal).toBe(signal)
            expect(contexts.stream).toBe(context)
            expect(contexts.ordinary).not.toBe(context)
          }
        }
      },
      {},
      () => undefined
    )
    try {
      expect(await fixture.b.memory.send('a', 'ordinary', { kind: 'ordinary' })).toBe('ok')
      /** One actual peer receives this original payload and context for the full stream lifetime. */
      const iterator = fixture.b.memory.stream('stream', {
        kind: 'stream'
      }) as AsyncIterableIterator<unknown>
      expect(await iterator.next()).toEqual({ done: false, value: 'item' })
      expect(contexts.stream).toBeDefined()
      expect(contexts.stream).not.toBe(contexts.ordinary)
      await iterator.return?.()
    } finally {
      await fixture.close()
    }
  })
})
