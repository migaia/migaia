import { expect, it } from 'vitest'
import {
  readProbeStages,
  RpcProbeDirection,
  RpcProbeOutcome,
  RpcProbeStage
} from '@migaia/rpc-core/probe'
import { createRpcDevtools } from '@migaia/rpc-devtools'
import type { IRpcDevtoolsWatchBatch } from '@migaia/rpc-devtools/contract'
import { collectorView } from './fixture.js'

it('[closure A3] translates independent source ordinals and preserves a recording-owned carrier link', () => {
  /** One-slot main retention must not retire an alias still held by the explicit recording. */
  const devtools = createRpcDevtools({ stages: ['carrier', 'protected', 'envelope'], maxEvents: 1 })
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

it('[closure A6] restores stages added before pause and keeps repeated pause idempotent', () => {
  /** Direct ingestion must follow the same current mask as installed Core emitters. */
  const devtools = createRpcDevtools({ stages: ['message'] })
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

it('[closure A1/A6] applies the same outcome filter to query and active watch delivery', async () => {
  /** One retained ring and one active watcher must agree on the canonical outcome vocabulary. */
  const devtools = createRpcDevtools()
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

it('[closure A6] reports an open terminal bound and clamps every quantile to the observed maximum', () => {
  /** A duration inside the terminal bucket formerly interpolated beyond its sole observed sample. */
  const devtools = createRpcDevtools()
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
