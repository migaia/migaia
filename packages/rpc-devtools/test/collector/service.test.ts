import { describe, expect, it } from 'vitest'
import { createPeerPair } from '@migaia/rpc-core/testing'
import { RpcProbeStage } from '@migaia/rpc-core/probe'
import { createRpcDevtools, RpcDevtoolsErrorCode, RPC_DEVTOOLS_SOURCE } from '../../src/index.js'
import type { IRpcDevtoolsQuery, IRpcDevtoolsServiceApi } from '../../src/contract/index.js'
import { CollectorFixture, collectorView } from './fixture.js'

describe('collector query, watch and service', () => {
  it('serves query, stats, watch, lifecycle and recording through actual memory Peers', async () => {
    /** Capture is local opt-in; the service remains metadata-only without exposeContent. */
    const devtools = createRpcDevtools({ stages: ['message', 'encoded'], capture: ['encoded'] })
    /** Nested service contract is checked by the public typed Peer surface. */
    const service = devtools.service as IRpcDevtoolsServiceApi
    /** The real provider iterator signals registration without a timing or transport assumption. */
    let signalStarted!: () => void
    /** This cold fixture Promise resolves after the original iterator enters its first next. */
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    /** Keep the original public service entry and return its exact native generator. */
    const originalWatch = service.watch
    service.watch = (input) => {
      /** The collector remains the only owner of this iterator and its queue. */
      const iterator = originalWatch(input)
      /** Native async-generator next requires its original receiver when forwarded. */
      const originalNext = iterator.next
      iterator.next = (value?: unknown) => {
        /** Reflect.apply preserves native receiver semantics and the exact returned Promise. */
        const pending = Reflect.apply(originalNext, iterator, [value])
        signalStarted()
        return pending
      }
      return iterator
    }
    /** The service is exercised on its real serving Peer without depending on observation points. */
    const servingSide = { provide: { devtools: service }, probe: devtools }
    /** The canonical testing helper owns both real memory transports and genuine Peers. */
    const pair = await createPeerPair({ a: { provide: {} }, b: servingSide })
    try {
      /** The first remote call activates the service; Core contract alone supplies no observations. */
      const remoteDescription = await pair.a.request('devtools.describe')
      expect(remoteDescription.version).toBe(devtools.describe().version)
      expect(remoteDescription.limits).toEqual(devtools.describe().limits)
      expect(remoteDescription.now).toBeGreaterThan(0)
      /** Real startup observations advance seq before the service learns its serving identity. */
      const firstSequence = devtools.query().nextSeq + 1
      for (let i = 1; i <= 3; i++) {
        /** Three independent filters must all match the retained business event. */
        const view = collectorView(firstSequence + i - 1)
        if (i === 2) view.method = CollectorFixture.otherMethod
        if (i === 3) view.trace = CollectorFixture.otherTrace
        devtools.emit(view)
      }
      /** A captured encoded event must not leak content through the metadata service. */
      const captured = collectorView(firstSequence + 3)
      captured.stage = RpcProbeStage.encoded
      captured.content = new Uint8Array([1, 2, 3])
      devtools.emit(captured)
      /** The query boundary applies all three public filters together. */
      const query: IRpcDevtoolsQuery = {
        stages: ['message'],
        methods: [CollectorFixture.method],
        trace: CollectorFixture.trace
      }
      expect((await pair.a.request('devtools.query', query)).events).toEqual(
        devtools.query(query).events
      )
      expect(devtools.query(query).events.map((event) => event.seq)).toEqual([firstSequence])
      expect(await pair.a.request('devtools.stats')).toEqual(devtools.stats())
      for (const event of (await pair.a.request('devtools.query')).events)
        expect(event).not.toHaveProperty('content')

      /** The fixture barrier observes the original provider iterator's actual first next. */
      const watch = pair.a.stream('devtools.watch', { methods: [CollectorFixture.method] })
      /** This pending request waits for the next qualifying collector batch. */
      const next = watch.next()
      await started
      devtools.emit(collectorView(firstSequence + 4))
      expect((await next).value).toMatchObject({
        events: [{ seq: firstSequence + 4, method: CollectorFixture.method }],
        dropped: 0
      })
      await watch.return!(undefined)

      await pair.a.request('devtools.pause')
      expect(devtools.describe().paused).toBe(true)
      devtools.emit(collectorView(firstSequence + 5))
      expect(devtools.query().counters.ignoredWhilePaused).toBe(1)
      await pair.a.request('devtools.resume')
      expect(devtools.describe().paused).toBe(false)
      await pair.a.request('devtools.record.start', { maxEvents: 3 })
      devtools.emit(collectorView(firstSequence + 6))
      expect(
        devtools
          .importRecord(await pair.a.request('devtools.record.stop'))
          .events.map((event) => event.seq)
      ).toEqual([firstSequence + 6])
      await pair.a.request('devtools.clear')
      expect(devtools.query().events).toEqual([])
      expect(devtools.stats().methods).toEqual([])
    } finally {
      devtools.close()
      await Promise.all([pair.a.close(), pair.b.close()])
    }
  })

  it('does not ingest events from the actual serving endpoint when installed on its service Peer', async () => {
    /** Installing this collector on its serving Peer must exclude that endpoint's traffic. */
    const devtools = createRpcDevtools()
    /** The frozen service contract attaches through the original nested provider entry. */
    const service = devtools.service as IRpcDevtoolsServiceApi
    /** Real Peer identity supplies the observed endpoint; the method name is no identity substitute. */
    const servingSide = { provide: { devtools: service }, probe: devtools }
    /** Memory Peers establish an actual provider call before its endpoint events are hand-filled. */
    const pair = await createPeerPair({ a: { provide: {} }, b: servingSide })
    try {
      await pair.a.request('devtools.describe')
      /** Hand-filled views avoid a dependency on the separate probe-core observation leaf. */
      const ownTraffic = collectorView()
      ownTraffic.endpointId = pair.b.self.instanceId
      ownTraffic.method = 'devtools.describe'
      devtools.emit(ownTraffic)
      ownTraffic.method = CollectorFixture.method
      devtools.emit(ownTraffic)
      expect(devtools.query().events).toEqual([])
    } finally {
      devtools.close()
      await Promise.all([pair.a.close(), pair.b.close()])
    }
  })

  it('caps batches at 256 and reports oldest-batch loss when a watcher resumes after overflow', async () => {
    /** Query retention is deliberately irrelevant to the bounded per-watcher queue. */
    const devtools = createRpcDevtools({ maxEvents: 4 })
    /** Local async generator exercises collector backpressure independently of transport flow. */
    const watch = devtools.watch()
    /** Registration runs before the initial event is emitted. */
    const first = watch.next()
    devtools.emit(collectorView(1))
    expect((await first).value!.dropped).toBe(0)
    try {
      for (let batch = 0; batch < 66; batch++) {
        for (let index = 0; index < 256; index++)
          devtools.emit(collectorView(2 + batch * 256 + index))
        await Promise.resolve()
      }
      /** Resumption reports the oldest batches lost while the consumer did no reads. */
      const resumed = await watch.next()
      expect(resumed.value!.events.length).toBeLessThanOrEqual(256)
      expect(resumed.value!.dropped).toBeGreaterThan(0)
      expect(resumed.value!.events[0]!.seq).toBeGreaterThan(1)
    } finally {
      await watch.return(undefined)
      devtools.close()
    }
  })

  it('closes a pending watcher with CLOSED and makes repeated close harmless', async () => {
    /** Close must wake this actual pending generator operation instead of leaving it suspended. */
    const devtools = createRpcDevtools()
    /** The pending watch owns the close observation. */
    const watch = devtools.watch()
    /** Attach the rejection assertion before synchronous close wakes the watcher. */
    const pending = expect(watch.next()).rejects.toMatchObject({
      source: RPC_DEVTOOLS_SOURCE,
      code: RpcDevtoolsErrorCode.closed
    })
    devtools.close()
    await pending
    expect(() => devtools.close()).not.toThrow()
    expect(() => devtools.query()).toThrowError(
      expect.objectContaining({ code: RpcDevtoolsErrorCode.closed })
    )
    expect(() => devtools.pause()).toThrowError(
      expect.objectContaining({ code: RpcDevtoolsErrorCode.closed })
    )
    expect(() => devtools.resume()).toThrowError(
      expect.objectContaining({ code: RpcDevtoolsErrorCode.closed })
    )
  })
})
