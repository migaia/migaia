import { expect, it, vi } from 'vitest'
import {
  readProbeStages,
  RpcProbeDirection,
  RpcProbeOutcome,
  RpcProbeKind,
  RpcProbeStage
} from '@migaia/rpc-host/plugins/probe'
import { devtoolsPlugin } from '../../src/index.ts'
import type { IRpcDevtoolsWatchBatch, IRpcDevtoolsServiceApi } from '../../src/contract/service.ts'
import { NameTable, CarrierTable } from '../../src/collector/intern.ts'
import { CollectorStats } from '../../src/collector/stats.ts'
import { collectorView } from './fixture.ts'

it('translates independent source ordinals and preserves a recording-owned carrier link', () => {
  /** One-slot main retention must not retire an alias still held by the explicit recording. */
  const devtools = devtoolsPlugin({
    stages: ['carrier', 'protected', 'envelope'],
    maxEvents: 1
  }).collector
  /** Recording owns the original carrier even after another endpoint displaces it from query. */
  const recording = devtools.record({ maxEvents: 8 })
  try {
    /** Source-local sequence one is intentionally shared by two genuine endpoint identities. */
    const carrier = collectorView(1)
    carrier.stage = RpcProbeStage.carrier
    carrier.direction = RpcProbeDirection.inbound
    devtools.emit(carrier)
    /** The second source gets a different collector sequence without altering either input. */
    const other = collectorView(1)
    other.endpointId = 'other-source'
    other.stage = RpcProbeStage.carrier
    other.direction = RpcProbeDirection.inbound
    devtools.emit(other)
    /** Delayed decrypt still resolves the first source because recording retains its alias. */
    const protectedView = collectorView(2)
    protectedView.stage = RpcProbeStage.protected
    protectedView.carrierSeq = 1
    devtools.emit(protectedView)
    expect(devtools.query().events[0]!.carrierSeq).toBe(1)
    protectedView.endpointId = 'other-source'
    devtools.emit(protectedView)
    expect(devtools.query().events[0]!.carrierSeq).toBe(2)
    /** A new source generation reuses ordinal one while old recorded aliases stay alive. */
    devtools.emit(other)
    devtools.emit(protectedView)
    expect(devtools.query().events[0]!.carrierSeq).toBe(5)
    expect(carrier.seq).toBe(1)
    expect(protectedView.carrierSeq).toBe(1)
    expect(recording.stop().events.map((event) => event.carrierSeq)).toEqual([
      undefined,
      undefined,
      1,
      2,
      undefined,
      5
    ])
  } finally {
    devtools.close()
  }
})

it('restores stages added before pause and keeps repeated pause idempotent', () => {
  /** Direct ingestion must follow the same current mask as installed Core emitters. */
  const devtools = devtoolsPlugin({ stages: ['message'] }).collector
  try {
    devtools.setStages(['message', 'carrier'])
    /** The added carrier stage is reachable before pause and after resume. */
    const view = collectorView(1)
    view.stage = RpcProbeStage.carrier
    devtools.emit(view)
    devtools.pause()
    devtools.pause()
    devtools.resume()
    expect(readProbeStages(devtools)).toBe(66)
    view.seq = 2
    devtools.emit(view)
    expect(devtools.query().events.map((event) => event.stage)).toEqual(['carrier', 'carrier'])
  } finally {
    devtools.close()
  }
})

it('applies the same outcome filter to query and active watch delivery', async () => {
  /** One retained ring and one active watcher must agree on the canonical outcome vocabulary. */
  const devtools = devtoolsPlugin().collector
  /** Failed-only watch starts before either event arrives. */
  const watch = devtools.watch({ outcomes: ['failed'] })
  try {
    /** The original next call registers this watcher synchronously before its first wait. */
    const pending = watch.next()
    devtools.emit(collectorView(1))
    /** Distinct failure identity proves that filtering does not merely return every row. */
    const failed = collectorView(2)
    failed.outcome = RpcProbeOutcome.failed
    devtools.emit(failed)
    expect(devtools.query({ outcomes: ['settled'] }).events.map((event) => event.seq)).toEqual([1])
    expect(devtools.query({ outcomes: [] }).events).toEqual([])
    /** Narrow the async generator's return union to the delivered public batch. */
    const batch = (await pending).value as IRpcDevtoolsWatchBatch
    expect(batch.events.map((event) => event.seq)).toEqual([2])
  } finally {
    await watch.return(undefined)
    devtools.close()
  }
})

it('reports an open terminal bound and clamps every quantile to the observed maximum', () => {
  /** A duration inside the terminal bucket formerly interpolated beyond its sole observed sample. */
  const devtools = devtoolsPlugin().collector
  try {
    /** This sample exceeds the last finite lower boundary while staying below the nominal label. */
    const view = collectorView(1)
    view.durationMs = 300_000
    devtools.emit(view)
    /** Public overflow metadata distinguishes the open bucket from a finite-width guarantee. */
    const row = devtools.stats().methods[0]!
    expect(row.latencyOverflowFromMs).toBe(262_144)
    expect(row.latencyMaxMs).toBe(300_000)
    expect(row.p50Ms).toBeLessThanOrEqual(300_000)
    expect(row.p95Ms).toBeLessThanOrEqual(300_000)
    expect(row.p99Ms).toBeLessThanOrEqual(300_000)
  } finally {
    devtools.close()
  }
})

it('defaults to message, peer and forward and admits physical stages only after selection', () => {
  /** Default mask retains logical messages, peer lifecycle and forwards without physical overhead. */
  const devtools = devtoolsPlugin().collector
  try {
    expect(readProbeStages(devtools)).toBe(
      (1 << RpcProbeStage.message) | (1 << RpcProbeStage.peer) | (1 << RpcProbeStage.forward)
    )
    /** Direct views obey the same dynamically selected mask as installed emitters. */
    const view = collectorView()
    view.stage = RpcProbeStage.carrier
    devtools.emit(view)
    expect(devtools.query().events).toEqual([])
    devtools.setStages(['carrier'])
    devtools.emit(view)
    expect(devtools.query().events.map((event) => event.stage)).toEqual(['carrier'])
  } finally {
    devtools.close()
  }
})

it('performs no hot interning or translation and schedules one notification for a shared burst', async () => {
  /** Instrument existing owners, without introducing a production instrumentation seam. */
  const intern = vi.spyOn(NameTable.prototype, 'id')
  /** The same cold carrier owner is observed before any reader runs. */
  const translate = vi.spyOn(CarrierTable.prototype, 'carrierSequence')
  /** Settlement calls are counted independently of physical events that happen to carry a duration. */
  const update = vi.spyOn(CollectorStats.prototype, 'update')
  /** A real scheduling spy leaves microtask behavior unchanged. */
  const schedule = vi.spyOn(globalThis, 'queueMicrotask')
  /**
   * Source factory shares the instrumented classes; public compiled behavior has separate parity
   * checks.
   */
  const devtools = devtoolsPlugin({
    stages: ['message', 'carrier', 'protected'],
    maxEvents: 2
  }).collector
  /** Two active iterators exercise one raw burst store, independent of tiny main retention. */
  const watches = [devtools.watch(), devtools.watch()]
  try {
    /** These physical views must not update logical-call statistics or build carrier aliases. */
    const carrier = collectorView(1)
    carrier.stage = RpcProbeStage.carrier
    carrier.direction = RpcProbeDirection.inbound
    devtools.emit(carrier)
    /** A dependent raw ordinal must remain untouched until a reader asks. */
    const protectedView = collectorView(2)
    protectedView.stage = RpcProbeStage.protected
    protectedView.carrierSeq = 1
    devtools.emit(protectedView)
    devtools.emit(collectorView(3))
    expect(intern).not.toHaveBeenCalled()
    expect(translate).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    expect(schedule).not.toHaveBeenCalled()
    /** Registration precedes the synchronous burst, exactly as the public async generator promises. */
    const pending = watches.map((watch) => watch.next())
    for (let sequence = 4; sequence <= 6; sequence++) devtools.emit(collectorView(sequence))
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(intern).not.toHaveBeenCalled()
    expect(translate).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(4)
    /** Every watcher gets every raw burst row despite maxEvents two. */
    const batches = await Promise.all(pending)
    for (const batch of batches)
      expect((batch.value as IRpcDevtoolsWatchBatch).events.map((event) => event.seq)).toEqual([
        4, 5, 6
      ])
  } finally {
    for (const watch of watches) await watch.return(undefined)
    devtools.close()
    vi.restoreAllMocks()
  }
})

it('keeps retained reader results equal across query, watch, record and service', async () => {
  /** Physical stages are explicit; this fixed script names two actual endpoints and two methods. */
  const devtools = devtoolsPlugin({
    stages: ['message', 'carrier', 'protected'],
    maxEvents: 16
  }).collector
  /** Recording and watch own the complete script independently of query materialization. */
  const recording = devtools.record({ maxEvents: 16 })
  /** The local service uses the same portable representation owner as a mounted service. */
  const service = devtools.service as IRpcDevtoolsServiceApi
  /** Registration occurs before the first emitted event. */
  const watch = devtools.watch()
  /** Native async iteration observes one synchronous burst. */
  const pending = watch.next()
  try {
    for (const endpoint of ['first-endpoint', 'second-endpoint']) {
      /** Both source emitters reuse ordinal one; collector ordinals must stay distinct. */
      const carrier = collectorView(1)
      carrier.endpointId = endpoint
      carrier.stage = RpcProbeStage.carrier
      carrier.direction = RpcProbeDirection.inbound
      devtools.emit(carrier)
      /** Source ordinal two points at that endpoint's retained physical origin. */
      const protectedView = collectorView(2)
      protectedView.endpointId = endpoint
      protectedView.stage = RpcProbeStage.protected
      protectedView.carrierSeq = 1
      devtools.emit(protectedView)
      for (const method of ['echo', 'other']) {
        /** Only settlements affect statistics; both methods keep their actual endpoint identity. */
        const settled = collectorView(3)
        settled.endpointId = endpoint
        settled.method = method
        devtools.emit(settled)
      }
    }
    /** Expected revision-one values establish identity/order without a second implementation. */
    const expected = devtools.query().events
    expect(
      expected.map((event) => [
        event.seq,
        event.stage,
        event.kind,
        event.outcome,
        event.method,
        event.endpointId,
        event.carrierSeq
      ])
    ).toEqual([
      [1, 'carrier', 'request', 'settled', 'echo', 'first-endpoint', undefined],
      [2, 'protected', 'request', 'settled', 'echo', 'first-endpoint', 1],
      [3, 'message', 'request', 'settled', 'echo', 'first-endpoint', undefined],
      [4, 'message', 'request', 'settled', 'other', 'first-endpoint', undefined],
      [5, 'carrier', 'request', 'settled', 'echo', 'second-endpoint', undefined],
      [6, 'protected', 'request', 'settled', 'echo', 'second-endpoint', 5],
      [7, 'message', 'request', 'settled', 'echo', 'second-endpoint', undefined],
      [8, 'message', 'request', 'settled', 'other', 'second-endpoint', undefined]
    ])
    expect((await pending).value!.events).toEqual(expected)
    expect(service.query().events).toEqual(expected)
    expect(service.stats()).toEqual(devtools.stats())
    expect(service.describe().limits).toEqual(devtools.describe().limits)
    expect(devtools.stats().methods.map((entry) => entry.calls)).toEqual([1, 1, 1, 1])
    expect(devtools.importRecord(devtools.exportRecord(recording.stop())).events).toEqual(expected)
  } finally {
    await watch.return(undefined)
    devtools.close()
  }
})

it('preserves ten settlements independently of two retained rows', () => {
  /**
   * No reader runs until after eight evictions, so cold derivation cannot reconstruct statistics
   * from retention.
   */
  const devtools = devtoolsPlugin({ maxEvents: 2 }).collector
  try {
    for (let sequence = 1; sequence <= 10; sequence++) devtools.emit(collectorView(sequence))
    expect(devtools.stats().methods[0]!.calls).toBe(10)
    expect(devtools.query().events.map((event) => event.seq)).toEqual([9, 10])
  } finally {
    devtools.close()
  }
})

it('preserves all variation strings through a method-filtered record boundary', () => {
  /**
   * The source method filter must retain controls with no method while dropping another business
   * method.
   */
  const devtools = devtoolsPlugin({ methods: ['echo'] }).collector
  /** Native record and frozen codec carry the exact new optional string. */
  const recording = devtools.record({ maxEvents: 8 })
  try {
    devtools.emit(collectorView(1))
    /** Reusing this view proves later controls cannot overwrite earlier variation strings. */
    const view = collectorView(2)
    view.method = 'other'
    devtools.emit(view)
    view.method = undefined
    view.durationMs = -1
    for (const variation of ['ping', 'pong', 'close', 'abort', 'user-observation']) {
      view.seq++
      view.variation = variation
      view.kind = variation === 'abort' ? RpcProbeKind.cancel : RpcProbeKind.control
      devtools.emit(view)
    }
    view.variation = undefined
    /** The first request remains optional-variation-free; each control retains its original name. */
    const events = devtools.query().events
    expect(events.map((event) => event.variation)).toEqual([
      undefined,
      'ping',
      'pong',
      'close',
      'abort',
      'user-observation'
    ])
    expect(events.some((event) => event.method === 'other')).toBe(false)
    expect(devtools.importRecord(devtools.exportRecord(recording.stop())).events).toEqual(events)
  } finally {
    devtools.close()
  }
})

it('keeps a learned carrier link across exposure changes and recorded copies', () => {
  /** Two slots allow a readable origin, followed by its retirement before the next projection. */
  const devtools = devtoolsPlugin({
    stages: ['carrier', 'protected', 'message'],
    maxEvents: 2
  }).collector
  /** Metadata service and local content queries build different cached representations. */
  const service = devtools.service as IRpcDevtoolsServiceApi
  try {
    /** Source-local ordinal one is the physical origin; recording deliberately starts afterward. */
    const carrier = collectorView(1)
    carrier.stage = RpcProbeStage.carrier
    carrier.direction = RpcProbeDirection.inbound
    devtools.emit(carrier)
    /** Recording retains only the dependent copy, so no originating record row can mask the defect. */
    const recording = devtools.record({ maxEvents: 4 })
    /** The first metadata read resolves this exact collector-domain link. */
    const protectedView = collectorView(2)
    protectedView.stage = RpcProbeStage.protected
    protectedView.carrierSeq = 1
    devtools.emit(protectedView)
    expect(service.query().events[1]!.carrierSeq).toBe(1)
    devtools.emit(collectorView(3))
    /** Content exposure changes after the physical origin has retired from every raw ring. */
    expect(devtools.query().events[0]!.carrierSeq).toBe(1)
    devtools.emit(collectorView(4))
    /** Even after the main dependent copy retires, recording keeps the same previously learned link. */
    expect(recording.stop().events[0]!.carrierSeq).toBe(1)
  } finally {
    devtools.close()
  }
})

it('never revives a watcher-retained origin after an observed source reset', async () => {
  /** Tiny main retention makes an old idle watcher the only remaining owner of its physical origin. */
  const devtools = devtoolsPlugin({
    stages: ['message', 'carrier', 'protected'],
    maxEvents: 1
  }).collector
  /** Different physical outcomes leave the old origin queued while filtering out its replacement. */
  const watch = devtools.watch({ outcomes: ['settled'] })
  /** Consume one startup batch so later qualifying rows stay in the idle watch queue. */
  const started = watch.next()
  devtools.emit(collectorView(1))
  await started
  try {
    /** The original emitter's source ordinal one is retained only by the idle filtered queue. */
    const old = collectorView(1)
    old.stage = RpcProbeStage.carrier
    old.direction = RpcProbeDirection.inbound
    devtools.emit(old)
    await Promise.resolve()
    /**
     * Scheduled raw delivery observes this reset even though the replacement fails the watch
     * filter.
     */
    const replacement = collectorView(1)
    replacement.stage = RpcProbeStage.carrier
    replacement.direction = RpcProbeDirection.inbound
    replacement.outcome = RpcProbeOutcome.received
    devtools.emit(replacement)
    await Promise.resolve()
    /** Another event evicts the replacement origin from main and pending storage. */
    const later = collectorView(2)
    later.outcome = RpcProbeOutcome.received
    devtools.emit(later)
    await Promise.resolve()
    /**
     * This new child must not join the old watcher origin that has the same endpoint/source
     * ordinal.
     */
    const protectedView = collectorView(3)
    protectedView.stage = RpcProbeStage.protected
    protectedView.outcome = RpcProbeOutcome.received
    protectedView.carrierSeq = 1
    devtools.emit(protectedView)
    expect(devtools.query().events[0]!.seq).toBe(5)
    expect(devtools.query().events[0]).not.toHaveProperty('carrierSeq')
  } finally {
    await watch.return(undefined)
    devtools.close()
  }
})
