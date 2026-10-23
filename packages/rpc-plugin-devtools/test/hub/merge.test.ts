import { describe, expect, it, vi } from 'vitest'
import type { IRpcDevtoolsTimelineEvent } from '../../src/hub/types.js'
import { createRpcDevtoolsHub } from '../../src/hub/index.js'
import {
  compareTimelineEvents,
  mergeTimeline,
  type IHubTimelineSource
} from '../../src/hub/timeline.js'
import { createHubTarget, retainTargetEvent } from '../../src/hub/targets.js'
import { event, fakeTarget, type ITestClock } from './helpers.js'

describe('hub merge complexity and bounded retention', () => {
  it('merges three 100,000-event targets within the n ceil(log2 k) + n comparator bound', async () => {
    /**
     * Exactly three retained sequences are the merge workload; maxEvents avoids this cell's
     * eviction.
     */
    const count = 100_000
    /** Known clock removes local timing jitter from the comparison workload. */
    const clock: ITestClock = { now: 0 }
    /** Both alignment endpoints observe the same fixed monotonic time. */
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    /** Each target has enough retention for the complete merge event set. */
    const hub = createRpcDevtoolsHub({ maxEvents: count })
    /** Internal sequence inputs use the same production merger and count only comparator operations. */
    const sources: IHubTimelineSource[] = []
    try {
      for (let index = 0; index < 3; index++) {
        /** Interleaved timestamps make all three heap heads participate throughout the merge. */
        const inputs = Array.from({ length: count }, (_, position) =>
          event(position + 1, position * 3 + index)
        )
        /** Names provide deterministic tie-break identity without encoding ordering in arrival. */
        const name = `target-${index}`
        await hub.addTarget(name, fakeTarget(inputs, { clock }).client)
        /** Stored wrappers are reused by the direct production merge seam and public query. */
        const events = hub.timeline({ targets: [name] })
        expect(events).toHaveLength(count)
        expect(events[0].event).toBe(inputs[0])
        expect(events.at(-1)?.event).toBe(inputs.at(-1))
        sources.push({ name, events, head: 0, count })
      }
      /** Count comparator invocations without adding a hub public API or per-event instrumentation. */
      let comparisons = 0
      /** Explicit comparator is the same production order relation with one integer count attached. */
      const merged = mergeTimeline(sources, undefined, (left, right) => {
        comparisons++
        return compareTimelineEvents(left, right)
      })
      expect(merged).toHaveLength(count * 3)
      expect(comparisons).toBeLessThanOrEqual(
        merged.length * Math.ceil(Math.log2(3)) + merged.length
      )
      console.info(
        JSON.stringify({
          acceptance: 'merge',
          targets: 3,
          events: merged.length,
          comparisons,
          comparatorBound: merged.length * Math.ceil(Math.log2(3)) + merged.length
        })
      )
      for (let index = 0; index < merged.length; index++)
        expect(merged[index].alignedAt).toBe(index)
      /**
       * Public timeline exercises the same complete workload and returns existing wrapper
       * references.
       */
      const publicMerged = hub.timeline()
      expect(publicMerged).toHaveLength(count * 3)
      for (let index = 0; index < merged.length; index++)
        expect(publicMerged[index]).toBe(merged[index])
    } finally {
      await hub.close()
      now.mockRestore()
    }
  }, 30_000)

  it('evicts oldest references from interaction and trace indexes at maxEvents', async () => {
    /** One key survives partial eviction; another vanishes completely from its trace index. */
    const inputs = [
      event(1, 1, { senderId: 'A', messageId: 'shared', trace: 'T' }),
      event(2, 2, { senderId: 'A', messageId: '2', trace: 'old' }),
      event(3, 3, { senderId: 'A', messageId: 'shared', trace: 'T' }),
      event(4, 4, { senderId: 'A', messageId: '4', trace: 'new' })
    ]
    /** A two-element ring must retain only the final two original wire-event references. */
    const hub = createRpcDevtoolsHub({ maxEvents: 2 })
    await hub.addTarget('A', fakeTarget(inputs).client)
    expect(hub.timeline().map((item) => item.event)).toEqual([inputs[2], inputs[3]])
    expect(hub.timeline()[0].event).toBe(inputs[2])
    expect(hub.interactions('old')).toEqual([])
    expect(
      hub
        .interactions()
        .map((item) => item.key)
        .sort()
    ).toEqual(['A:4', 'A:shared'])
    expect(hub.interactions('T')[0].events[0].event).toBe(inputs[2])
    for (const item of hub.interactions()) {
      expect(item.events).toHaveLength(1)
      expect(item.events[0].event.seq).toBeGreaterThan(2)
    }
    await hub.removeTarget('A')
    expect(hub.timeline()).toEqual([])
    expect(hub.interactions()).toEqual([])
    await hub.close()
  })

  it('counts each ring eviction exactly once through the canonical storage owner', () => {
    /**
     * The private production target owner exposes retention counters without changing the frozen
     * API.
     */
    const target = createHubTarget('A', 2)
    /** Four stored wrappers overflow a ring of two by exactly two events. */
    const inputs: IRpcDevtoolsTimelineEvent[] = Array.from({ length: 4 }, (_, index) => ({
      target: 'A',
      alignedAt: index,
      uncertaintyMs: undefined,
      event: event(index + 1, index)
    }))
    expect(retainTargetEvent(target, inputs[0])).toBeUndefined()
    expect(retainTargetEvent(target, inputs[1])).toBeUndefined()
    expect(retainTargetEvent(target, inputs[2])).toBe(inputs[0])
    expect(retainTargetEvent(target, inputs[3])).toBe(inputs[1])
    expect(target.evicted).toBe(2)
    expect(target.count).toBe(2)
  })
})
