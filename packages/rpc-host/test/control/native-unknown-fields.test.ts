/** Additive route fields reach the real provider through the sole current wire grammar. */
import { assert, expect, it, vi } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

// Removes warnings, preserving all four original business entries.
it('keeps processing three additive route records after the original directed request', async () => {
  /** Only the original provider entry changes this independent business count. */
  let calls = 0
  /** Every actual diagnostic remains available; no unknown-field report is filtered out. */
  const reports: unknown[] = []
  /** Both public Hosts own genuine bilateral Session admission and the same original carrier. */
  const fixture = await connectedCoreHosts({}, { count: () => ++calls }, (error) =>
    reports.push(error)
  )
  try {
    expect(await fixture.a.memory.send('b', 'count', null)).toBe(1)
    /** Identity media retains the original admitted semantic record without an observer decode. */
    const original = fixture.pair[0].written.find(
      (frame) => frame.kind === 'call' && frame.task.method === 'count'
    )
    assert(original?.kind === 'call')
    for (let index = 0; index < 3; index++)
      await fixture.pair[0].write({
        kind: 'message',
        data: {
          ...original,
          id: `extra-${index}`,
          route: { ...original.route, x: index }
        }
      })
    await vi.waitFor(() => expect(calls).toBe(4))
    /** Deliberately ignores unknown fields without the retired scanner or warning table. */
    expect(reports).toEqual([])
  } finally {
    await fixture.close()
  }
})
