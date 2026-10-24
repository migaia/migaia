import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { configDefaults } from 'vitest/config'

/** Config files load in Vitest, outside the source/test TypeScript project. */
const { default: defaultConfig } = await import(
  new URL('../../../rpc-plugin-process/vitest.config.ts', import.meta.url).href
)
/** The dedicated runner remains independently configurable and serial. */
const { default: conformanceConfig } = await import(
  new URL('../../vitest.conformance.config.ts', import.meta.url).href
)

/** The measurement module is a test-only, unpackaged JavaScript harness. */
const measurement = await import(new URL('../../bench/ipc.mjs', import.meta.url).href)

/** Deterministic observations keep measurement readiness, clocks and PID readings explicit. */
class MeasurementFixture {
  /** Exchange count separates original warmup from the settled measurement window. */
  #calls = 0
  /** The clock advances by one nanosecond at each observed boundary. */
  #ticks = 0
  /** Snapshot count distinguishes the original pre-window and post-window totals. */
  #reads = 0
  /** Tests deliberately invalidate only RSS evidence through this flag. */
  #missing = false
  /** The returned observer remover records its actual join. */
  #stopped = false
  /** Original PID inputs preserve duplicate handling and caller reference semantics. */
  #pids: number[]
  /** The existing measurement owner receives these observation callbacks unchanged. */
  readonly options: {
    ready(): Promise<void>
    exchange(): Promise<void>
    warmup: number
    samples: number
    nowNs(): number
    observer: {
      pids: number[]
      method: string
      intervalMs: number
      read(): Promise<{ pid: number; cpuNs: number; rssBytes: number }[]>
      start(
        receive: (rows: { pid: number; cpuNs: number; rssBytes: number }[]) => void
      ): () => Promise<void>
    }
  }

  /** Build one set of original PID/clock observations without running a measured window. */
  constructor(pids = [11, 22]) {
    this.#pids = pids
    this.options = {
      ready: async () => {
        expect(this.#calls).toBe(0)
      },
      exchange: async () => {
        this.#calls += 1
      },
      warmup: 7,
      samples: 1000,
      nowNs: () => this.#ticks++,
      observer: {
        pids: this.#pids,
        method: 'focused-deterministic-pid-snapshot',
        intervalMs: 10,
        /** The last original PID reading advances the same before/after snapshot boundary. */
        read: async () => {
          expect(this.#calls).toBe(this.#reads === 0 ? 7 : 1007)
          return [...new Set(this.#pids)]
            .map((pid) => ({
              pid,
              cpuNs: this.#reads === 0 ? 10000 : 20000,
              rssBytes: this.#reads === 0 ? 500 : 700
            }))
            .map((row) => {
              if (this.#missing) row.rssBytes = 0
              return row
            })
            .map((row, index, rows) => {
              if (index === rows.length - 1) this.#reads += 1
              return row
            })
        },
        /** A single synchronous observation precedes the original async join callback. */
        start: (receive) => {
          expect(this.#calls).toBe(7)
          receive([...new Set(this.#pids)].map((pid) => ({ pid, cpuNs: 15000, rssBytes: 900 })))
          return async () => {
            this.#stopped = true
          }
        }
      }
    }
  }

  /** Invalidate the same subsequent RSS samples without changing exchange behavior. */
  failRead(): void {
    this.#missing = true
  }

  /** Expose whether the original observer remover completed. */
  isStopped(): boolean {
    return this.#stopped
  }
}

describe('preparation only; no aggregate performance PASS', () => {
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
    const run = new MeasurementFixture()
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
    const result = await measurement.measureBare(new MeasurementFixture([11, 11]).options)
    expect(result.cpuNsPerRequest).toBe(10)
    expect(result.rssAbsolutePeakSumBytes).toBe(900)
  })
  it('fails a missing absolute RSS reading instead of manufacturing a denominator', async () => {
    /** A failed observer cannot yield a valid reference side. */
    const run = new MeasurementFixture()
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
      readFileSync(
        new URL(
          '../../../rpc-plugin-process/test/process/conformance-inventory.json',
          import.meta.url
        ),
        'utf8'
      )
    )
    expect(inventory.supportUnitsFrozen).toBe(true)
    expect(inventory.acceptance.map((row: { id: string }) => row.id)).toEqual([
      'peer-delivery',
      'upstream-vectors',
      'bridge-responder',
      'health-failure',
      'channel-limits',
      'supervision-cleanup',
      'connection-admission',
      'trace-routing',
      'platform-capabilities',
      'measurement-preparation',
      'toolchain-admission',
      'receipt-delivery'
    ])
    expect(inventory.rootIntegration).toHaveLength(6)
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
        .find((row: { id: string }) => row.id === 'measurement-preparation')
        .assertions.every((assertion: { status: string }) => assertion.status === 'implemented')
    ).toBe(true)
  })
})
