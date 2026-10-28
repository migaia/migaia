import { describe, expect, it } from 'vitest'
import { RpcAbortError } from '@migaia/rpc-contract/errors'
import { connectedCoreHosts } from '../host/core-fixture.ts'

/** Requires one producer next for each caller pull and preserves the generator return value. */
describe('streaming remote generators', () => {
  it('delivers three values lazily from a synchronous generator', async () => {
    /** The application counter observes actual production rather than receiver buffering. */
    let produced = 0
    /** Scalar and stream handlers share the same genuine public provider catalog. */
    const fixture = await connectedCoreHosts(
      {
        count: function* () {
          for (const value of ['a', 'b', 'c']) {
            produced += 1
            yield value
          }
          return 'r'
        },
        asyncCount: async function* () {
          yield 1
          yield 2
          return 3
        },
        invalid: () => 'not iterable'
      },
      {},
      () => undefined
    )
    try {
      /** A single genuine peer keeps each public stream result scalar. */
      const iterator = fixture.b.memory.stream('count', null) as AsyncIterableIterator<unknown>
      expect(produced).toBe(0)
      expect(await iterator.next()).toEqual({ done: false, value: 'a' })
      expect(produced).toBe(1)
      expect(await iterator.next()).toEqual({ done: false, value: 'b' })
      expect(produced).toBe(2)
      expect(await iterator.next()).toEqual({ done: false, value: 'c' })
      expect(produced).toBe(3)
      expect(await iterator.next()).toEqual({ done: true, value: 'r' })
      /** Async generators preserve the same item and terminal return values. */
      const asyncIterator = fixture.b.memory.stream(
        'asyncCount',
        null
      ) as AsyncIterableIterator<unknown>
      expect(await asyncIterator.next()).toEqual({ done: false, value: 1 })
      expect(await asyncIterator.next()).toEqual({ done: false, value: 2 })
      expect(await asyncIterator.next()).toEqual({ done: true, value: 3 })
      await expect(
        (fixture.b.memory.stream('invalid', null) as AsyncIterableIterator<unknown>).next()
      ).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' })
      expect(() =>
        fixture.a.provide({
          count: function* () {
            yield 0
          }
        })
      ).toThrow(expect.objectContaining({ code: 'PROVIDER_DUPLICATED' }))
      expect(() => fixture.a.provide({ count: () => 'wrong' })).toThrow(
        expect.objectContaining({ code: 'PROVIDER_DUPLICATED' })
      )
      /** Returning before the first pull does not create remote work. */
      const unopened = fixture.b.memory.stream('count', null) as AsyncIterableIterator<unknown>
      expect(await unopened.return?.()).toEqual({ done: true, value: undefined })
      /** Caller throw keeps its exact local identity before opening a stream. */
      const reason = new Error('local stop')
      await expect(
        (fixture.b.memory.stream('count', null) as AsyncIterableIterator<unknown>).throw?.(reason)
      ).rejects.toBe(reason)
      /** Replace the retired stream facade lifetime with caller cancellation authority. */
      const controller = new AbortController()
      /** Cancellation still terminates already active public work with the original code. */
      const active = fixture.b.memory.stream('count', null, {
        signal: controller.signal
      }) as AsyncIterableIterator<unknown>
      expect(await active.next()).toEqual({ done: false, value: 'a' })
      controller.abort(new RpcAbortError())
      await expect(active.next()).rejects.toMatchObject({ code: 'CANCELLED' })
    } finally {
      await fixture.close()
    }
  })
})
