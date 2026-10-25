import { describe, expect, it } from 'vitest'
import { createRpcHost, type IRpcContext, type IRpcNamespace } from '@migaia/rpc-host'
import { coreMemoryServer } from '../../../rpc-host/test/host/core-fixture.js'
import { RpcProbeStage } from '@migaia/rpc-host/plugins/probe'
import {
  devtoolsPlugin,
  RpcDevtoolsErrorCode,
  RPC_DEVTOOLS_SOURCE
} from '@migaia/rpc-plugin-devtools'
import type { IRpcDevtoolsQuery, IRpcDevtoolsServiceApi } from '../../src/contract/service.js'
import { CollectorFixture, collectorView } from './fixture.js'

describe('collector query, watch and service', () => {
  it('serves query, stats, watch, lifecycle and recording through actual connected Hosts', async () => {
    /** Capture is local opt-in; the service remains metadata-only without exposeContent. */
    const plugin = devtoolsPlugin({
      stages: ['message', 'encoded'],
      capture: ['encoded']
    })
    /** The actual flow plugin and its serving provider share the caller-owned collector. */
    const devtools = plugin.collector
    /** Nested service contract is checked by the public typed namespace surface. */
    const service = devtools.service as IRpcDevtoolsServiceApi
    /** The real provider iterator signals registration without a timing or transport assumption. */
    let signalStarted!: () => void
    /** This cold fixture Promise resolves after the original iterator enters its first next. */
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    /** Keep the original public service entry and return its exact native generator. */
    const originalWatch = service.watch
    service.watch = (input, context?: IRpcContext) => {
      /** Keep the real provider signal and exact iterator while observing its first pending pull. */
      const entry = {
        iterator: Reflect.apply(originalWatch, undefined, [input, context]) as ReturnType<
          typeof originalWatch
        >,
        signalStarted
      }
      /** Native async-generator next requires its original receiver when forwarded. */
      const originalNext = entry.iterator.next
      entry.iterator.next = (value?: unknown) => {
        /** Reflect.apply preserves native receiver semantics and the exact returned Promise. */
        const pending = Reflect.apply(originalNext, entry.iterator, [value])
        entry.signalStarted()
        return pending
      }
      return entry.iterator
    }
    /** The existing listener and MemoryCarrier pair own both actual native connections. */
    const server = coreMemoryServer('service-caller')
    /** The requesting host holds no collector and introduces no test RPC facade. */
    const a = await createRpcHost<Record<string, { devtools: IRpcDevtoolsServiceApi }>>(
      server.options
    )
    /** The actual serving host installs the same collector through its genuine flow plugin. */
    const connected = await server.connect('service-provider', {
      provide: { devtools: service },
      plugins: [plugin]
    })
    /** Cleanup retains only the two genuine public host owners. */
    const pair = { a, b: connected.host }
    /** Static declaration narrows the original public namespace; no runtime method is replaced. */
    const namespace = pair.a.memory
    /** The direct capability projection addresses the one actual serving Host. */
    const remote = namespace.peers[pair.b.self.name]!.devtools
    try {
      /** The first remote call activates the service; Core contract alone supplies no observations. */
      const remoteDescription = await remote.describe()
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
      expect((await remote.query(query)).events).toEqual(devtools.query(query).events)
      expect(devtools.query(query).events.map((event) => event.seq)).toEqual([firstSequence])
      expect(await remote.stats()).toEqual(devtools.stats())
      for (const event of (await remote.query()).events) expect(event).not.toHaveProperty('content')

      /** Automatic providers support all modes; select the public stream operation explicitly. */
      const watch = (pair.a.memory.stream as IRpcNamespace['stream'])('devtools.watch', {
        methods: [CollectorFixture.method]
      })
      if (!('next' in watch)) expect.fail('The single connected service must return one iterator')
      /** This pending request waits for the next qualifying collector batch. */
      const next = watch.next()
      await started
      devtools.emit(collectorView(firstSequence + 4))
      expect((await next).value).toMatchObject({
        events: [{ seq: firstSequence + 4, method: CollectorFixture.method }],
        dropped: 0
      })
      await watch.return!(undefined)

      await remote.pause()
      expect(devtools.describe().paused).toBe(true)
      devtools.emit(collectorView(firstSequence + 5))
      expect(devtools.query().counters.ignoredWhilePaused).toBe(1)
      await remote.resume()
      expect(devtools.describe().paused).toBe(false)
      await remote.record.start({ maxEvents: 3 })
      devtools.emit(collectorView(firstSequence + 6))
      expect(
        devtools.importRecord(await remote.record.stop()).events.map((event) => event.seq)
      ).toEqual([firstSequence + 6])
      await remote.clear()
      expect(devtools.query().events).toEqual([])
      expect(devtools.stats().methods).toEqual([])
    } finally {
      devtools.close()
      await Promise.all([pair.a.close(), pair.b.close()])
    }
  })

  it('does not ingest events from the actual serving endpoint when installed on its service Host', async () => {
    /** Installing this collector on its serving Host must exclude that endpoint's traffic. */
    const plugin = devtoolsPlugin()
    /** The serving plugin lends its real collector without replacing the observation boundary. */
    const devtools = plugin.collector
    /** The frozen service contract attaches through the original nested provider entry. */
    const service = devtools.service as IRpcDevtoolsServiceApi
    /** The existing listener lends real peer identity rather than guessing from the method. */
    const server = coreMemoryServer('excluded-service-caller')
    /** This actual client has no collector to contaminate service endpoint exclusion. */
    const a = await createRpcHost<Record<string, { devtools: IRpcDevtoolsServiceApi }>>(
      server.options
    )
    /** The original service and plugin share the one caller-owned collector on the real provider. */
    const connected = await server.connect('excluded-service-provider', {
      provide: { devtools: service },
      plugins: [plugin]
    })
    /** Cleanup retains only the two genuine public host owners. */
    const pair = { a, b: connected.host }
    /** Static service types refine the original namespace without introducing a runtime adapter. */
    const namespace = pair.a.memory
    /** Address the exact service Host rather than the broadcast scalar/fanout union. */
    const remote = namespace.peers[pair.b.self.name]!.devtools
    try {
      await remote.describe()
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
    const devtools = devtoolsPlugin({ maxEvents: 4 }).collector
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
    const devtools = devtoolsPlugin().collector
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
