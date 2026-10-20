import { describe, expect, it, vi } from 'vitest'
import {
  encodeRpcDevtoolsRecord,
  RpcDevtoolsRecordFormat,
  type IRpcDevtoolsStats,
  type IRpcDevtoolsWireEvent
} from '../../src/contract/index.js'
import { createRpcDevtoolsHub } from '../../src/hub/index.js'
import { event, fakeTarget, type ITestClock } from './helpers.js'

/** Build the two-hop trace and its reply records without collector or carrier dependencies. */
function hops(): ReadonlyMap<string, readonly IRpcDevtoolsWireEvent[]> {
  return new Map([
    [
      'A',
      [
        event(1, 10, { senderId: 'A', messageId: 'AB', method: 'first', trace: 'T' }),
        event(2, 40, {
          senderId: 'A',
          messageId: 'AB',
          method: 'first',
          trace: 'T',
          direction: 'inbound',
          kind: 'response'
        })
      ]
    ],
    [
      'B',
      [
        event(1, 11, {
          senderId: 'A',
          messageId: 'AB',
          method: 'first',
          trace: 'T',
          direction: 'inbound'
        }),
        event(2, 20, { senderId: 'B', messageId: 'BC', method: 'second', trace: 'T' }),
        event(3, 22, { senderId: 'B', messageId: 'one-sided', method: 'local' }),
        event(4, 35, {
          senderId: 'B',
          messageId: 'BC',
          method: 'second',
          trace: 'T',
          direction: 'inbound',
          kind: 'response'
        }),
        event(5, 39, {
          senderId: 'A',
          messageId: 'AB',
          method: 'first',
          trace: 'T',
          kind: 'response'
        })
      ]
    ],
    [
      'C',
      [
        event(1, 21, {
          senderId: 'B',
          messageId: 'BC',
          method: 'second',
          trace: 'T',
          direction: 'inbound'
        }),
        event(2, 34, {
          senderId: 'B',
          messageId: 'BC',
          method: 'second',
          trace: 'T',
          kind: 'response'
        })
      ]
    ]
  ])
}

describe('hub correlation and timeline', () => {
  it('joins deferred inbound physical events once within their own target and releases indexes', async () => {
    /** Decrypt cannot identify the carrier until its later admitted envelope has routing identity. */
    const events = [
      event(1, 1, { stage: 'carrier', direction: 'inbound' }),
      event(2, 2, { stage: 'protected', direction: 'inbound', carrierSeq: 1 }),
      event(3, 3, { stage: 'frame', direction: 'inbound', carrierSeq: 1 }),
      event(4, 4, {
        stage: 'envelope',
        direction: 'inbound',
        carrierSeq: 1,
        senderId: 'caller',
        messageId: 'request',
        trace: 'T1'
      }),
      event(5, 5, { stage: 'frame', direction: 'inbound', carrierSeq: 1 }),
      event(6, 6, { stage: 'carrier', senderId: 'caller', messageId: 'request', trace: 'T1' })
    ]
    /** Identical ordinal in another target must never acquire this request's identity. */
    const hub = createRpcDevtoolsHub({ maxEvents: 8 })
    try {
      await hub.addTarget('linked', fakeTarget(events).client)
      await hub.addTarget('unrelated', fakeTarget([event(1, 1, { stage: 'carrier' })]).client)
      expect(hub.timeline({ trace: 'T1' })).toHaveLength(6)
      expect(hub.interactions('T1')[0]!.events).toHaveLength(6)
      expect(hub.timeline({ trace: 'T1' }).map((item) => item.event.seq)).toEqual([
        1, 2, 3, 4, 5, 6
      ])
      expect(events[0]!.trace).toBeUndefined()
      await hub.removeTarget('linked')
      expect(hub.interactions('T1')).toEqual([])
      expect(hub.timeline()).toHaveLength(1)
    } finally {
      await hub.close()
    }
  })
  it('derives sides from request and response roles across same-host endpoints and duplicate targets', async () => {
    /** Same-host endpoints witness the request at both business roles in one collector. */
    const sameHost = [
      event(1, 1, { endpointId: 'caller', senderId: 'caller', messageId: 'local' }),
      event(2, 2, {
        endpointId: 'provider',
        senderId: 'caller',
        messageId: 'local',
        direction: 'inbound'
      })
    ]
    /** Request outbound and response inbound both witness only the caller's business role. */
    const callerOnly = [
      event(3, 3, { endpointId: 'caller', senderId: 'caller', messageId: 'remote' }),
      event(4, 4, {
        endpointId: 'caller',
        senderId: 'caller',
        messageId: 'remote',
        direction: 'inbound',
        kind: 'response'
      })
    ]
    /** Target count must not substitute for evidence of both request participants. */
    const hub = createRpcDevtoolsHub()
    try {
      await hub.addTarget('live', fakeTarget([...sameHost, ...callerOnly]).client)
      hub.importRecord(
        'recorded-caller',
        encodeRpcDevtoolsRecord({ header: RpcDevtoolsRecordFormat, events: callerOnly })
      )
      /** Two endpoint witnesses in one target are sufficient to prove a two-sided interaction. */
      const local = hub.interactions().find((item) => item.key === 'caller:local')
      expect(local).toMatchObject({ oneSided: false, targets: ['live'] })
      expect(local?.events).toHaveLength(2)
      /** Repeating caller-side events in an offline target cannot fabricate the provider's side. */
      const remote = hub.interactions().find((item) => item.key === 'caller:remote')
      expect(remote?.oneSided).toBe(true)
      expect(remote?.targets).toEqual(expect.arrayContaining(['live', 'recorded-caller']))
      expect(remote?.events).toHaveLength(4)
    } finally {
      await hub.close()
    }
  })

  it('groups both hops with their replies, retains one-sided interaction and stored references', async () => {
    /** Zero RTT and fixed time isolate correlation from alignment in this oracle. */
    const clock: ITestClock = { now: 0 }
    /** The source event graph is retained by reference across every public query. */
    const inputs = hops()
    /** This spy gives remote and local clocks the same zero offset. */
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    /** Each fake target implements the frozen public service boundary. */
    const hub = createRpcDevtoolsHub()
    try {
      for (const [name, events] of inputs)
        await hub.addTarget(name, fakeTarget(events, { clock }).client)
      /** One trace contains two interactions rather than flattening both hops into one key. */
      const interactions = hub.interactions('T')
      expect(interactions.map((item) => item.key).sort()).toEqual(['A:AB', 'B:BC'])
      for (const interaction of interactions) {
        expect(interaction.events).toHaveLength(4)
        expect(interaction.oneSided).toBe(false)
        expect(new Set(interaction.events.map((item) => item.event.direction))).toEqual(
          new Set(['outbound', 'inbound'])
        )
        expect(interaction.events.filter((item) => item.event.kind === 'response')).toHaveLength(2)
      }
      expect(hub.interactions().find((item) => item.key === 'B:one-sided')).toMatchObject({
        oneSided: true,
        targets: ['B']
      })
      /** Timeline arrays may differ, but each wrapper and its wire event must remain identical. */
      const timeline = hub.timeline({ trace: 'T' })
      expect(timeline).toHaveLength(8)
      for (let i = 1; i < timeline.length; i++)
        expect(timeline[i].alignedAt).toBeGreaterThanOrEqual(timeline[i - 1].alignedAt)
      for (const item of timeline) {
        expect(
          hub
            .timeline({ trace: 'T' })
            .find(
              (candidate) =>
                candidate.target === item.target && candidate.event.seq === item.event.seq
            )
        ).toBe(item)
        expect(inputs.get(item.target)?.find((candidate) => candidate.seq === item.event.seq)).toBe(
          item.event
        )
        expect(
          interactions.find((interaction) => interaction.key === item.interaction)?.events
        ).toContain(item)
      }
    } finally {
      await hub.close()
      now.mockRestore()
    }
  })

  it('returns identical merge order regardless of target arrival order and applies every filter', async () => {
    /** Constant local clock removes non-deterministic request scheduling from this comparison. */
    const clock: ITestClock = { now: 0 }
    /** Both hubs receive the exact same sequence objects in different target insertion orders. */
    const inputs = hops()
    /** Fixed alignment lets the oracle compare actual timestamps without a tolerance. */
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    /** First hub sees A before B before C. */
    const first = createRpcDevtoolsHub()
    /** Second hub sees reverse target arrival order. */
    const second = createRpcDevtoolsHub()
    try {
      for (const name of ['A', 'B', 'C'])
        await first.addTarget(name, fakeTarget(inputs.get(name), { clock }).client)
      for (const name of ['C', 'B', 'A'])
        await second.addTarget(name, fakeTarget(inputs.get(name), { clock }).client)
      expect(first.timeline({ trace: 'T' })).toEqual(second.timeline({ trace: 'T' }))
      expect(
        first
          .timeline({
            targets: ['B'],
            stages: ['message'],
            trace: 'T',
            method: 'second',
            from: 20,
            to: 35,
            limit: 1
          })
          .map((item) => item.event.seq)
      ).toEqual([2])
      expect(
        first
          .timeline({ targets: ['B'], method: 'second', from: 20, to: 35 })
          .map((item) => item.event.seq)
      ).toEqual([2, 4])
      expect(first.timeline({ stages: ['absent'] })).toEqual([])
      expect(first.timeline({ limit: 0 })).toEqual([])
    } finally {
      await first.close()
      await second.close()
      now.mockRestore()
    }
  })

  it('breaks equal-time ties by target name then target sequence', async () => {
    /** Equal times are valid event batches and must never depend on target registration order. */
    const clock: ITestClock = { now: 0 }
    /** Both target descriptions share exactly the same offset. */
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    /** Reverse registration makes the required name tie-break observable. */
    const hub = createRpcDevtoolsHub()
    try {
      await hub.addTarget('B', fakeTarget([event(1, 1), event(2, 1)], { clock }).client)
      await hub.addTarget('A', fakeTarget([event(1, 1), event(2, 1)], { clock }).client)
      expect(hub.timeline().map((item) => `${item.target}:${item.event.seq}`)).toEqual([
        'A:1',
        'A:2',
        'B:1',
        'B:2'
      ])
    } finally {
      await hub.close()
      now.mockRestore()
    }
  })

  it('forwards target stats by identity and sums shared method histogram buckets', async () => {
    /** The contract owns exactly 24 geometric histogram boundaries. */
    const buckets = Array.from({ length: 24 }, (_, index) => 0.0625 * 2 ** index)
    /** First target contributes one success and one failure to the same endpoint/method key. */
    const firstStats: IRpcDevtoolsStats = {
      since: 10,
      methods: [
        {
          endpointId: 'endpoint',
          method: 'read',
          calls: 2,
          failed: 1,
          rejected: 0,
          timedOut: 0,
          aborted: 0,
          latencyBucketsMs: buckets,
          latencyCounts: [1, 1, ...Array<number>(22).fill(0)],
          p50Ms: 0.0625,
          p95Ms: 0.125,
          p99Ms: 0.125
        }
      ]
    }
    /** Second target contributes three calls and independent failure classifications. */
    const secondStats: IRpcDevtoolsStats = {
      since: 5,
      methods: [
        {
          endpointId: 'endpoint',
          method: 'read',
          calls: 3,
          failed: 0,
          rejected: 2,
          timedOut: 1,
          aborted: 1,
          latencyBucketsMs: buckets,
          latencyCounts: [0, 1, 2, ...Array<number>(21).fill(0)],
          p50Ms: 0.25,
          p95Ms: 0.25,
          p99Ms: 0.25
        }
      ]
    }
    /** Aggregate queries use only the targets' existing public stats method. */
    const hub = createRpcDevtoolsHub()
    await hub.addTarget('A', fakeTarget([], { stats: firstStats }).client)
    await hub.addTarget('B', fakeTarget([], { stats: secondStats }).client)
    expect(await hub.stats('A')).toBe(firstStats)
    /** Shared keys aggregate counts rather than appending duplicate method entries. */
    const aggregate = await hub.stats()
    expect(aggregate.since).toBe(5)
    expect(aggregate.methods).toHaveLength(1)
    expect(aggregate.methods[0]).toMatchObject({
      calls: 5,
      failed: 1,
      rejected: 2,
      timedOut: 1,
      aborted: 1,
      latencyBucketsMs: buckets,
      latencyCounts: [1, 2, 2, ...Array<number>(21).fill(0)]
    })
    expect(aggregate.methods[0].p50Ms).toBeGreaterThan(0.0625)
    expect(aggregate.methods[0].p50Ms).toBeLessThanOrEqual(0.125)
    expect(aggregate.methods[0].p99Ms).toBeLessThanOrEqual(0.25)
    await hub.close()
  })

  it('preserves observed maxima when summing open terminal histograms', async () => {
    /** Two real contract rows share a method and each has one observed 300-second sample. */
    const stats: IRpcDevtoolsStats = {
      since: 0,
      methods: [
        {
          endpointId: 'endpoint',
          method: 'slow',
          calls: 1,
          failed: 0,
          rejected: 0,
          timedOut: 0,
          aborted: 0,
          latencyBucketsMs: Array.from({ length: 24 }, (_, index) => 0.0625 * 2 ** index),
          latencyCounts: [...Array<number>(23).fill(0), 1],
          latencyMaxMs: 300_000,
          latencyOverflowFromMs: 262_144,
          p50Ms: 300_000,
          p95Ms: 300_000,
          p99Ms: 300_000
        }
      ]
    }
    /** Aggregate interpolation must never exceed the actual maximum of either source. */
    const hub = createRpcDevtoolsHub()
    try {
      await hub.addTarget('A', fakeTarget([], { stats }).client)
      await hub.addTarget('B', fakeTarget([], { stats }).client)
      const row = (await hub.stats()).methods[0]!
      expect(row.calls).toBe(2)
      expect(row.latencyMaxMs).toBe(300_000)
      expect(row.latencyOverflowFromMs).toBe(262_144)
      expect(row.p99Ms).toBeLessThanOrEqual(300_000)
    } finally {
      await hub.close()
    }
  })
})
