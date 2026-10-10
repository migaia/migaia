import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { configDefaults } from 'vitest/config'

/** Config files load in Vitest, outside the source/test TypeScript project. */
const { default: defaultConfig } = await import(
  new URL('../../vitest.config.ts', import.meta.url).href
)
/** The dedicated runner remains independently configurable and serial. */
const { default: conformanceConfig } = await import(
  new URL('../../vitest.conformance.config.ts', import.meta.url).href
)

/** The measurement module is a test-only, unpackaged JavaScript harness. */
const measurement = await import(new URL('../../bench/ipc.mjs', import.meta.url).href)

/** Deterministic PID snapshots prove metric attribution without executing a performance run. */
function fixture(pids = [11, 22]) {
  /** Exchange count separates readiness/warmup from the settled measurement window. */
  let calls = 0
  /** The clock advances by one nanosecond per observed boundary. */
  let ticks = 0
  /** Snapshot count selects pre-window and post-window CPU totals. */
  let reads = 0
  /** RSS observer errors are deliberately injected for a failed-reading assertion. */
  let missing = false
  /** Observer joins synchronously in this fixture; production observer must join outstanding reads. */
  let stopped = false
  return {
    options: {
      ready: async () => {
        expect(calls).toBe(0)
      },
      exchange: async () => {
        calls++
      },
      warmup: 7,
      samples: 1000,
      nowNs: () => ticks++,
      observer: {
        pids,
        method: 'focused-deterministic-pid-snapshot',
        intervalMs: 10,
        read: async () => {
          expect(calls).toBe(reads === 0 ? 7 : 1007)
          return [...new Set(pids)]
            .map((pid) => ({
              pid,
              cpuNs: reads === 0 ? 10000 : 20000,
              rssBytes: reads === 0 ? 500 : 700
            }))
            .map((row) => {
              if (missing) row.rssBytes = 0
              return row
            })
            .map((row, index, rows) => {
              if (index === rows.length - 1) reads++
              return row
            })
        },
        start: (receive: (rows: { pid: number; cpuNs: number; rssBytes: number }[]) => void) => {
          expect(calls).toBe(7)
          receive([...new Set(pids)].map((pid) => ({ pid, cpuNs: 15000, rssBytes: 900 })))
          return async () => {
            stopped = true
          }
        }
      }
    },
    failRead: () => {
      missing = true
    },
    isStopped: () => stopped
  }
}

describe('I20 preparation only; no A-total or A10 performance PASS', () => {
  it('keeps exact conformance paths outside the default suite and preserves default exclusions', () => {
    expect(defaultConfig.test?.exclude).toEqual([
      ...configDefaults.exclude,
      'test/process/conformance*.test.ts',
      'test/bridge/conformance-faults.test.ts',
      'test/merge/suite-parity.test.ts'
    ])
    expect(conformanceConfig.test?.include).toEqual([
      'test/process/conformance*.test.ts',
      'test/bridge/conformance-faults.test.ts'
    ])
    expect(conformanceConfig.test?.fileParallelism).toBe(false)
    expect(conformanceConfig.test?.maxWorkers).toBe(1)
    expect(conformanceConfig.test?.testTimeout).toBe(120_000)
    expect(conformanceConfig.test?.coverage?.enabled).toBe(false)
  })
  it('uses nearest rank ceil(0.99n) and retains threshold targets', () => {
    expect(
      measurement.nearestRank(
        Array.from({ length: 101 }, (_, index) => index + 1),
        0.99
      )
    ).toBe(100)
    expect(measurement.IpcBenchThreshold).toEqual({ p99: 3, throughput: 0.5, cpu: 3, rss: 2 })
  })
  it('excludes warmup and sums absolute per-end RSS peaks and PID CPU deltas', async () => {
    /** Each endpoint has a 10000ns window CPU delta and a 900-byte absolute RSS peak. */
    const run = fixture()
    /** The result describes synthetic observations, never a product performance receipt. */
    const result = await measurement.measureBare(run.options)
    expect(result.samples).toBe(1000)
    expect(result.latenciesNs).toHaveLength(1000)
    expect(result.p99Ns).toBe(1)
    expect(result.cpuNsPerRequest).toBe(20)
    expect(result.rssAbsolutePeakSumBytes).toBe(1800)
    expect(result.throughputPerSecond).toBe((1000 * 1e9) / 2001)
    expect(run.isStopped()).toBe(true)
  })
  it('counts a shared thread PID once', async () => {
    /** Worker-style endpoints share their process and must not double-charge it. */
    const result = await measurement.measureBare(fixture([11, 11]).options)
    expect(result.cpuNsPerRequest).toBe(10)
    expect(result.rssAbsolutePeakSumBytes).toBe(900)
  })
  it('fails a missing absolute RSS reading instead of manufacturing a denominator', async () => {
    /** A failed observer cannot yield a valid A10 side. */
    const run = fixture()
    run.failRead()
    await expect(measurement.measureBare(run.options)).rejects.toThrow(
      'Missing CPU or absolute RSS observation'
    )
  })
  it.skipIf(process.platform !== 'darwin')(
    'prepares real isolated Node echoes and native parent/peer PID reads without a performance run',
    () => {
      /** The check path performs three echoes and two snapshots, never a >=1000-sample window. */
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          [fileURLToPath(new URL('../../bench/bare-node.mjs', import.meta.url)), '--check'],
          { encoding: 'utf8', timeout: 10000 }
        )
      )
      expect(result.type).toBe('bare-preparation')
      expect(result.echoes).toBe(3)
      expect(result.parentPid).not.toBe(process.pid)
      expect(result.peerPid).not.toBe(result.parentPid)
      expect(result.first.map((row: { pid: number }) => row.pid)).toEqual([
        result.parentPid,
        result.peerPid
      ])
      for (const row of result.last) {
        expect(row.rssBytes).toBeGreaterThan(0)
        expect(row.cpuNs).toBeGreaterThanOrEqual(
          result.first.find((before: { pid: number }) => before.pid === row.pid).cpuNs
        )
      }
      expect(result.method).toContain('proc_pid_rusage')
    }
  )
  it('retains every acceptance assertion and the frozen preparation matrix without implying performance PASS', () => {
    /** The tracked inventory contains assertion responsibilities without reading local docs. */
    const inventory = JSON.parse(
      readFileSync(new URL('./conformance-inventory.json', import.meta.url), 'utf8')
    )
    expect(inventory.supportUnitsFrozen).toBe(true)
    expect(inventory.acceptance.map((row: { id: string }) => row.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `A${index + 1}`)
    )
    expect(inventory.rootATotal).toHaveLength(6)
    for (const row of inventory.acceptance) {
      expect(row.evidenceOwner).toBeTruthy()
      expect(row.supportUnits).toBeTruthy()
      expect(row.assertions.length).toBeGreaterThan(0)
      for (const assertion of row.assertions)
        expect(['pending', 'implemented', 'verified', 'blocked']).toContain(assertion.status)
    }
    expect(
      inventory.acceptance.flatMap((row: { assertions: unknown[] }) => row.assertions)
    ).toHaveLength(93)
    expect(
      inventory.acceptance
        .find((row: { id: string }) => row.id === 'A10')
        .assertions.every((assertion: { status: string }) => assertion.status === 'implemented')
    ).toBe(true)
  })
})
