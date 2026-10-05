import { expect, it } from 'vitest'
import { connected } from './fixture.js'

it('[A43] cold query reads original client pending size without counting provider executions', async () => {
  /** A genuine pending request remains in the canonical registry until its original response. */
  let release!: () => void
  /** The provider barrier makes the query's logical in-flight count deterministic. */
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  /** Actual provider entry distinguishes a queued send from a transmitted pending operation. */
  let entered!: () => void
  /** This signal is fixture-only and creates no endpoint observer or counter update. */
  const started = new Promise<void>((resolve) => {
    entered = resolve
  })
  /** The existing source pair exercises real request/pending/provider owners on both endpoints. */
  const fixture = await connected(
    {},
    {
      hold: async () => {
        entered()
        await held
        return 42
      }
    }
  )
  /** Retain the original Promise so finally can settle it before closing the endpoint. */
  const request = fixture.peers[0].request('hold')
  try {
    /** Cold reads must not dispatch hidden business or management requests. */
    await started
    /** Type erasure allows a real semantic RED before the new detail field declaration exists. */
    const detail = (await fixture.peers[0].describe()) as unknown as {
      connections: { counters: { inFlight?: { value: number; scope: string; unit: string } } }[]
    }
    expect(
      detail.connections[0]!.counters.inFlight,
      '[A43] canonical pending Map.size'
    ).toMatchObject({
      value: 1,
      scope: 'endpoint-client',
      unit: 'calls'
    })
    /** The same physical channel's receiver owns a provider, rather than a client pending request. */
    const receiver = (await fixture.peers[1].describe()) as unknown as typeof detail
    expect(receiver.connections[0]!.counters.inFlight?.value).toBe(0)
    release()
    expect(await request).toBe(42)
    /** Settlement removes the original Map member; query does not rebuild it from a history. */
    const settled = (await fixture.peers[0].describe()) as unknown as typeof detail
    expect(settled.connections[0]!.counters.inFlight?.value).toBe(0)
  } finally {
    release()
    await Promise.allSettled([request])
    await fixture.close()
  }
})
