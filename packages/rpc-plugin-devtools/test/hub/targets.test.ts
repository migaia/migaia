import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  encodeRpcDevtoolsRecord,
  RpcDevtoolsErrorCode,
  RpcDevtoolsRecordFormat,
  RPC_DEVTOOLS_SOURCE
} from '../../src/contract/index.js'
import { createRpcDevtoolsHub } from '../../src/hub/index.js'
import { event, fakeTarget, until, type IFakeTargetOptions, type ITestClock } from './helpers.js'

afterEach(() => vi.restoreAllMocks())

describe('hub targets and alignment', () => {
  it('selects minimum RTT from five samples for +1000 and -500 ms clocks', async () => {
    /** Shared monotonic clock makes all five request round trips reproducible. */
    const clock: ITestClock = { now: 100 }
    vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    /** Each target exposes the same local event time under a different remote offset. */
    const positive = fakeTarget([event(1, 2000)], {
      clock,
      offset: 1000,
      rtts: [10, 6, 2, 8, 4]
    })
    /** The second minimum appears last, rejecting an implementation that keeps the first sample. */
    const negative = fakeTarget([event(1, 500)], {
      clock,
      offset: -500,
      rtts: [8, 4, 10, 6, 2]
    })
    /** Alignment and watch follow the public target contract only. */
    const hub = createRpcDevtoolsHub()
    await hub.addTarget('positive', positive.client)
    await hub.addTarget('negative', negative.client)
    expect(hub.status('positive')).toBe('connected')
    expect(hub.status('negative')).toBe('connected')
    expect(positive.requests.filter((request) => request.method === 'describe')).toHaveLength(5)
    expect(negative.requests.filter((request) => request.method === 'describe')).toHaveLength(5)
    for (const item of hub.timeline()) {
      expect(item.uncertaintyMs).toBe(1)
      expect(Math.abs(item.alignedAt - 1000)).toBeLessThanOrEqual(item.uncertaintyMs!)
    }
    await hub.close()
  })

  it('realigns stored wrappers in place on realignMs and stops sampling after close', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    /** Simulated monotonic time stays independent of interval scheduling. */
    const clock: ITestClock = { now: 100 }
    /** Both hub and service observe the same known local clock for every midpoint sample. */
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock.now)
    /** A mutable fake-service clock offset models an explicit supported realignment. */
    const options: IFakeTargetOptions = {
      clock,
      offset: 1000,
      rtts: [10, 6, 2, 8, 4]
    }
    /** The retained event's remote timestamp stays fixed while the target clock estimate changes. */
    const input = event(1, 5000)
    /** Offset changes affect future describe calls without altering the original wire event. */
    const target = fakeTarget([input], options)
    /** The declared interval is the sole periodic alignment trigger. */
    const hub = createRpcDevtoolsHub({ realignMs: 100 })
    try {
      await hub.addTarget('A', target.client)
      /** Queries expose the same stored wrapper before and after its mutable alignment update. */
      const retained = hub.timeline()[0]
      expect(retained.alignedAt).toBe(4000)
      expect(retained.uncertaintyMs).toBe(1)
      expect(target.requests.filter((request) => request.method === 'describe')).toHaveLength(5)
      options.offset = 2000
      await vi.advanceTimersByTimeAsync(100)
      await until(
        () => target.requests.filter((request) => request.method === 'describe').length === 10
      )
      expect(hub.timeline()[0]).toBe(retained)
      expect(retained.alignedAt).toBe(3000)
      expect(retained.uncertaintyMs).toBe(1)
      expect(retained.event).toBe(input)
      expect(input.at).toBe(5000)
      await hub.close()
      expect(vi.getTimerCount()).toBe(0)
      await vi.advanceTimersByTimeAsync(500)
      expect(target.requests.filter((request) => request.method === 'describe')).toHaveLength(10)
    } finally {
      await hub.close()
      now.mockRestore()
      vi.useRealTimers()
    }
  })

  it('rejects duplicate and unknown names, keeps removed-name release idempotent', async () => {
    /** The hub owns name registration independently of a remote service. */
    const hub = createRpcDevtoolsHub()
    /** Reusing this client proves duplicate detection happens before a second connection. */
    const target = fakeTarget()
    await hub.addTarget('A', target.client)
    await expect(hub.addTarget('A', target.client)).rejects.toMatchObject({
      source: RPC_DEVTOOLS_SOURCE,
      code: RpcDevtoolsErrorCode.targetDuplicate
    })
    await expect(hub.removeTarget('missing')).rejects.toMatchObject({
      source: RPC_DEVTOOLS_SOURCE,
      code: RpcDevtoolsErrorCode.targetUnknown
    })
    await hub.removeTarget('A')
    await hub.removeTarget('A')
    expect(hub.status('A')).toBe('removed')
    expect(target.releases).toBe(1)
    await hub.close()
  })

  it('finishes paged catch-up before watch and preserves data when watch breaks', async () => {
    /** Two full pages and one final page force afterSeq to advance beyond the first response. */
    const events = Array.from({ length: 2001 }, (_, index) => event(index + 1, index))
    /** Runtime failure must be reported with original identity and must not discard received data. */
    const original = new Error('fixture watch failure')
    /** Collected reports make runtime error policy observable at the public option boundary. */
    const reports: unknown[] = []
    /** This target uses the frozen maximum query page size of 1,000. */
    const target = fakeTarget(events)
    /** Max retention exceeds the entire catch-up and watch batch. */
    const hub = createRpcDevtoolsHub({ onError: (error) => reports.push(error) })
    await hub.addTarget('A', target.client)
    expect(hub.timeline()).toHaveLength(2001)
    expect(
      target.requests.filter((request) => request.method === 'query').length
    ).toBeGreaterThanOrEqual(3)
    expect(target.watchInputs).toHaveLength(1)
    /** The live event must be indexed after the complete retained prefix. */
    const live = event(2002, 2001)
    target.push([live])
    await until(() => hub.timeline().length === 2002)
    target.fail(original)
    await until(() => hub.status('A') === 'disconnected')
    expect(hub.timeline()).toHaveLength(2002)
    expect(hub.timeline().at(-1)?.event).toBe(live)
    expect(reports).toContain(original)
    await hub.close()
  })

  it('imports a read-only offline target with zero offset and no uncertainty', async () => {
    /** The frozen record format is the only import boundary. */
    const text = encodeRpcDevtoolsRecord({
      header: RpcDevtoolsRecordFormat,
      events: [event(0, 123), event(1, 124)]
    })
    /** Offline targets require no client, transport or clock sampling. */
    const hub = createRpcDevtoolsHub()
    hub.importRecord('recording', text)
    expect(hub.status('recording')).toBe('offline')
    expect(hub.timeline().map((item) => item.alignedAt)).toEqual([123, 124])
    expect(hub.timeline().every((item) => item.uncertaintyMs === undefined)).toBe(true)
    expect(() => hub.importRecord('recording', text)).toThrowError(
      expect.objectContaining({ code: RpcDevtoolsErrorCode.targetDuplicate })
    )
    await hub.close()
  })
})
