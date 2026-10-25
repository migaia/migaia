import { describe, expect, it } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

/** Delivers no old item twice after the canonical transport reports disconnection. */
describe('streaming disconnect', () => {
  it('ends the pending and future pulls with one sticky unknown-result error', async () => {
    /** The producer remains in its original next until the real carrier disconnects. */
    let resume!: () => void
    /** Only business production is held; the fixture owns no alternate dispatcher. */
    const blocked = new Promise<void>((resolve) => {
      resume = resolve
    })
    /** Public namespace traffic uses the existing connected native carrier pair. */
    const fixture = await connectedCoreHosts(
      {
        count: async function* () {
          yield 'a'
          await blocked
          yield 'b'
        }
      },
      {},
      () => undefined
    )
    try {
      /** One actual target returns the original lazy iterator. */
      const iterator = fixture.b.memory.stream('count', null) as AsyncIterableIterator<unknown>
      expect(await iterator.next()).toEqual({ done: false, value: 'a' })
      /** Disconnection interrupts a genuine outstanding pull. */
      const pending = iterator.next()
      await fixture.pair[0].close()
      /** The first rejection must remain sticky by identity for later pulls. */
      let failure: unknown
      try {
        await pending
      } catch (error) {
        failure = error
      }
      expect(failure).toMatchObject({ code: 'STREAM_RESULT_UNKNOWN' })
      await expect(iterator.next()).rejects.toBe(failure)
      resume()
    } finally {
      resume()
      await fixture.close()
    }
  })
})
