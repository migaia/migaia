import { describe, expect, it } from 'vitest'
import { RpcProbeOutcome } from '@migaia/rpc-core/probe'
import { createRpcDevtools } from '@migaia/rpc-devtools'
import { CollectorFixture, collectorView } from './fixture.js'

/** Exact fixture quantiles provide an independent oracle for bucket interpolation. */
function quantile(values: readonly number[], percentile: number): number {
  return values[Math.ceil(values.length * percentile) - 1]!
}

/** The histogram's public boundary array defines the allowed interpolation error. */
function bucketWidth(value: number, boundaries: readonly number[]): number {
  for (let i = 0; i < boundaries.length; i++) {
    if (value <= boundaries[i]!) return boundaries[i]! - (boundaries[i - 1] ?? 0)
  }
  return boundaries[boundaries.length - 1]!
}

describe('collector A2 statistics', () => {
  it('counts 1,000 settlements and each failure class independently of eviction, then clears all state', () => {
    /** Four retained views cannot contain the complete statistics fixture. */
    const devtools = createRpcDevtools({ maxEvents: 4 })
    /** A single reusable view also checks that aggregation is independent of view identity. */
    const view = collectorView()
    /** Known latency vectors establish exact expected quantiles for both methods. */
    const latencies = [[], []] as [number[], number[]]
    try {
      for (let i = 0; i < 1000; i++) {
        view.seq = i + 1
        view.method = i < 500 ? CollectorFixture.method : CollectorFixture.otherMethod
        view.durationMs = ((i % 500) + 1) / 16
        latencies[i < 500 ? 0 : 1].push(view.durationMs)
        devtools.emit(view)
      }
      view.method = CollectorFixture.method
      view.durationMs = 4
      view.outcome = RpcProbeOutcome.failed
      view.error = new Error('failed fixture')
      devtools.emit(view)
      view.error = new DOMException('timeout fixture', 'TimeoutError')
      devtools.emit(view)
      view.error = new DOMException('abort fixture', 'AbortError')
      devtools.emit(view)
      view.outcome = RpcProbeOutcome.rejected
      view.error = undefined
      view.rejection = 'fixture rejection'
      devtools.emit(view)
      latencies[0].push(4, 4, 4, 4)
      latencies[0].sort((a, b) => a - b)
      /** Aggregates are exported by their canonical endpoint and method names. */
      const stats = devtools.stats()
      expect(stats.methods).toHaveLength(2)
      for (let i = 0; i < 2; i++) {
        /** Select by public identity so slot ordering cannot determine the result. */
        const row = stats.methods.find(
          (entry) =>
            entry.method === (i === 0 ? CollectorFixture.method : CollectorFixture.otherMethod)
        )!
        expect(row.endpointId).toBe(CollectorFixture.endpoint)
        expect(row.calls).toBe(i === 0 ? 504 : 500)
        expect(row.failed).toBe(i === 0 ? 3 : 0)
        expect(row.rejected).toBe(i === 0 ? 1 : 0)
        expect(row.timedOut).toBe(i === 0 ? 1 : 0)
        expect(row.aborted).toBe(i === 0 ? 1 : 0)
        expect(row.latencyBucketsMs).toHaveLength(24)
        expect(row.latencyBucketsMs).toEqual(
          Array.from({ length: 24 }, (_, index) => 0.0625 * 2 ** index)
        )
        expect(row.latencyCounts.reduce((total, count) => total + count, 0)).toBe(row.calls)
        for (const [percentile, actual] of [
          [0.5, row.p50Ms],
          [0.95, row.p95Ms],
          [0.99, row.p99Ms]
        ] as const) {
          /** Bucket error bound is measured against the independently sorted fixture latencies. */
          const exact = quantile(latencies[i]!, percentile)
          expect(Math.abs(actual - exact)).toBeLessThanOrEqual(
            bucketWidth(exact, row.latencyBucketsMs)
          )
        }
      }
      expect(devtools.query().events).toHaveLength(4)
      expect(devtools.query().counters.evicted).toBe(1000)
      expect(devtools.stats()).toEqual(stats)
      devtools.clear()
      expect(devtools.stats().methods).toEqual([])
      expect(devtools.query().events).toEqual([])
      expect(Object.values(devtools.query().counters)).toEqual([0, 0, 0, 0, 0, 0, 0])
    } finally {
      devtools.close()
    }
  })
})
