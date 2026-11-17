import { describe, expect, it } from 'vitest'
import { chainHas, fixture, lines, marker, until } from './helper.ts'

/**
 * Deadline of the relayed request in the timeout case. It only needs to exceed the time for the
 * request to reach the target through both hops; the target holds for 10 seconds regardless.
 */
const RELAY_DEADLINE_MS = 2000

/** Cartesian product proves every runtime can be both a relay caller and target. */
const pairs = [0, 1, 2].flatMap((caller) => [0, 1, 2].map((target) => [caller, target] as const))

describe('Tray receipt-bound relay', () => {
  it.each(pairs)(
    'caller %i target %i relays request, ordered stream, target errors and one-way delivery',
    async (callerIndex, targetIndex) => {
      /** All nine combinations use the same Feature dependency and parent relay. */
      const api = await fixture()
      /** Child report marker receives the target's real one-way failure report. */
      const reportMarker = marker('notify-report')
      /** Coroutine child runtime reports through the original shared parent reporter. */
      const reports: unknown[] = []
      /** Registry admits only the shared branded host declarations. */
      const tray = api.createTray({
        hosts: api.hosts,
        report: (error: unknown) => reports.push(error)
      })
      try {
        /** Caller and target admissions stay distinct even for the same runtime family. */
        const caller = await tray.spawn(api.hosts[callerIndex].name, { id: 'caller' })
        /** Target counters and diagnostics belong to its own generation. */
        const target = await tray.spawn(api.hosts[targetIndex].name, {
          id: 'target',
          config: { reportMarker }
        })
        /** Only name and instance id cross the binding request; policies never execute in children. */
        const address = { host: api.hosts[targetIndex].name, id: 'target' }
        expect(
          await caller.request('node.svc.ask', { ...address, value: { query: 'hello' } })
        ).toEqual({ id: 'target', value: { query: 'hello' } })
        expect(await caller.request('node.svc.collect', { ...address, total: 3 })).toEqual([
          1, 2, 3
        ])
        /** The shared namespace must execute only this target's actual stream once. */
        expect(await target.request('node.svc.streamCalls')).toBe(1)
        expect(await caller.request('node.svc.streamCalls')).toBe(0)
        /** Business source/code and native cause chain must pass through unchanged in meaning. */
        const failure = await caller
          .request('node.svc.relayFail', address)
          .catch((error: unknown) => error)
        expect(failure).toMatchObject({
          name: 'Error',
          source: '@fixture/tray',
          code: 'SVC_FAILED',
          message: 'fixture service failed',
          cause: { source: '@fixture/tray', code: 'SVC_CAUSE', message: 'fixture service cause' }
        })
        expect((failure as Error).stack).toBeTruthy()
        expect((failure as Error).cause).toHaveProperty('stack', expect.any(String))
        await caller.request('node.svc.relayNotify', address)
        await until(
          () => target.request('node.svc.notedCount'),
          (count) => count === 1
        )
        /** A throwing notify handler does not become a request response error. */
        await expect(
          caller.request('node.svc.relayNotify', { ...address, fail: true })
        ).resolves.toBeUndefined()
        await until(
          () =>
            reports.some((error) => chainHas(error, 'SVC_FAILED')) ||
            lines(reportMarker).some((line) => line.includes('SVC_FAILED')),
          Boolean
        )
      } finally {
        await tray.dispose()
      }
    },
    30000
  )

  it.each(pairs)(
    'caller %i target %i propagates parent abort and timeout through both relay hops',
    async (callerIndex, targetIndex) => {
      /** Cancellation reports are observed on the genuine caller connection. */
      const reports: unknown[] = []
      /** Same service body honors the forwarded context signal in every runtime. */
      const api = await fixture()
      /** Parent owns the original request receipt and cancellation source. */
      const tray = api.createTray({
        hosts: api.hosts,
        report: (error: unknown) => reports.push(error)
      })
      try {
        /** Caller relays its request through deps.tray.to. */
        const caller = await tray.spawn(api.hosts[callerIndex].name, { id: 'caller' })
        /** Target owns the cancellation counter. */
        const target = await tray.spawn(api.hosts[targetIndex].name, { id: 'target' })
        /** Runtime address is a plain portable wire payload. */
        const address = { host: api.hosts[targetIndex].name, id: 'target', milliseconds: 10000 }
        /** The user's AbortController remains the canonical cancellation source. */
        const controller = new AbortController()
        /** Rejection handler attaches before the cancellation can settle the public receipt. */
        const cancelled = caller
          .request('node.svc.wait', address, { signal: controller.signal })
          .catch((error: unknown) => error)
        // Abort only once the target handler runs. Aborting earlier is also valid, but then the
        // request never reaches the target and nothing proves propagation through both hops.
        await until(
          () => target.request('node.svc.sleepStarts'),
          (count) => count === 1
        )
        controller.abort()
        expect(await cancelled).toMatchObject({ code: 'CANCELLED' })
        await until(
          () => target.request('node.svc.aborted'),
          (count) => count === 1
        )
        /**
         * The deadline must outlast the two relay hops even on a loaded machine, so the target is
         * running when it expires; the start is observed before the expiry is awaited.
         */
        const expired = caller
          .request('node.svc.wait', address, { timeoutMs: RELAY_DEADLINE_MS })
          .catch((error: unknown) => error)
        await until(
          () => target.request('node.svc.sleepStarts'),
          (count) => count === 2
        )
        expect(await expired).toMatchObject({ code: 'DEADLINE_EXCEEDED' })
        await until(
          () => target.request('node.svc.aborted'),
          (count) => count === 2
        )
        expect(await caller.request('node.svc.aborted')).toBe(0)
        /**
         * Cooperative cancellation is acknowledged without a diagnostic; a genuine late timeout may
         * report.
         */
        expect(reports.some((error) => chainHas(error, 'CANCELLED'))).toBe(false)
      } finally {
        await tray.dispose()
      }
    },
    30000
  )

  it.each([0, 1, 2])(
    'runtime %i preserves native Uint8Array payloads at top level and nested',
    async (index) => {
      /** Built portability and native RPC codecs are both part of this assertion. */
      const api = await fixture()
      /** One true instance receives the binary payload. */
      const tray = api.createTray({ hosts: [api.hosts[index]] })
      try {
        /** Captured remote sends through the runtime's real connection. */
        const remote = await tray.spawn(api.hosts[index].name, { id: 'binary' })
        /** Top-level native bytes must never become a plain object or JSON array. */
        const bytes = Uint8Array.of(1, 2, 255)
        expect(await remote.request('node.svc.echo', bytes)).toEqual(bytes)
        expect(await remote.request('node.svc.echo', { bytes })).toEqual({ bytes })
      } finally {
        await tray.dispose()
      }
    },
    30000
  )

  it('binds parent and child remotes to one admission and rejects missing and mismatched hosts', async () => {
    /** Shared host definitions let the child request genuine branded remotes. */
    const api = await fixture()
    /** Parent owns target admission receipts across removal and same-id re-admission. */
    const tray = api.createTray({ hosts: api.hosts })
    try {
      /** Caller stores its remote inside the child Feature closure. */
      const caller = await tray.spawn('node-co', { id: 'caller' })
      /** First target admission is a real Worker. */
      const target = await tray.spawn('node-th', { id: 'b' })
      await expect(
        caller.request('node.svc.ask', { host: 'node-pr', id: 'missing', value: 'x' })
      ).rejects.toMatchObject({ code: 'TRAY_INSTANCE_UNKNOWN' })
      await expect(
        caller.request('node.svc.ask', { host: 'node-pr', id: 'b', value: 'x' })
      ).rejects.toMatchObject({ code: 'TRAY_HOST_MISMATCH' })
      expect(() => tray.instance(api.nodePr, 'b')).toThrowError(
        expect.objectContaining({ code: 'TRAY_HOST_MISMATCH' })
      )
      await caller.request('node.svc.capture', { host: 'node-th', id: 'b' })
      await tray.remove('b')
      await tray.spawn('node-th', { id: 'b' })
      await expect(target.request('node.svc.hello')).rejects.toMatchObject({
        code: 'TRAY_INSTANCE_UNKNOWN'
      })
      await expect(caller.request('node.svc.captured')).rejects.toMatchObject({
        code: 'TRAY_INSTANCE_UNKNOWN'
      })
      expect(
        await caller.request('node.svc.ask', { host: 'node-th', id: 'b', value: 'fresh' })
      ).toEqual({ id: 'b', value: 'fresh' })
    } finally {
      await tray.dispose()
    }
  }, 30000)
})
