/**
 * Bare-side measurement core for the conformance IPC driver. Channel launch, codec, peer, isolation
 * and PID observer belong to the caller. This module does not freeze support units or claim
 * completed A10 measurements.
 */

/**
 * @typedef {{ pid: number; cpuNs: number; rssBytes: number }} IProcessSample
 *
 * @typedef {{
 *   pids: number[]
 *   method: string
 *   intervalMs: number
 *   read: () => Promise<IProcessSample[]>
 *   start: (receive: (samples: IProcessSample[]) => void) => () => Promise<void>
 * }} IPidObserver
 *
 * @typedef {{
 *   ready: () => Promise<void>
 *   exchange: () => Promise<void>
 *   observer: IPidObserver
 *   samples?: number
 *   warmup?: number
 *   nowNs?: () => number
 * }} IBareOptions
 */

/** The immutable acceptance thresholds are the user's four relative targets. */
export const IpcBenchThreshold = Object.freeze({ p99: 3, throughput: 0.5, cpu: 3, rss: 2 })

/**
 * Return the nearest-rank latency without interpolating or losing the last sample.
 *
 * @param {number[]} values Positive measured latencies in nanoseconds.
 * @param {number} quantile Quantile between zero and one, exclusive of zero.
 * @returns {number} Latency at ceil(quantile * sample count).
 * @throws {TypeError} If samples or quantile cannot represent a measurement.
 */
export function nearestRank(values, quantile) {
  if (
    !values.length ||
    !(quantile > 0 && quantile <= 1) ||
    values.some((v) => !Number.isFinite(v) || v <= 0)
  )
    throw new TypeError('Invalid measured latency samples')
  /** Sorting a copy preserves the caller-owned chronological raw observations. */
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.ceil(quantile * ordered.length) - 1]
}

/**
 * Measure only settled echoes after readiness and warmup. Observe each distinct PID once. The
 * caller prestarts a native PID observer; read/start must never spawn a sampler subprocess in the
 * measurement window. Observer stop joins all outstanding reads.
 *
 * @param {IBareOptions} options Same byte payload, codec, carrier and concurrency as RPC side.
 * @returns {Promise<object>} Raw samples and endpoint observations for the paired driver.
 * @throws {Error} Missing PID data or observer/echo failure aborts this side; never a ratio failure
 *   marker.
 */
export async function measureBare(options) {
  /** Counts exclude ready and warmup; production acceptance requires at least 1000 echoes. */
  const samples = options.samples ?? 1000
  /** Warmup uses the identical channel and echo while remaining outside all measured metrics. */
  const warmup = options.warmup ?? 100
  /** Monotonic clock may be injected for focused measurement-contract checks. */
  const nowNs = options.nowNs ?? (() => Number(process.hrtime.bigint()))
  /** Deduplication prevents worker units charging one process twice. */
  const pids = [...new Set(options.observer.pids)]
  if (
    !Number.isInteger(samples) ||
    samples < 1000 ||
    !Number.isInteger(warmup) ||
    warmup < 0 ||
    !pids.length ||
    pids.some((pid) => !Number.isInteger(pid) || pid <= 0) ||
    !options.observer.method ||
    !(options.observer.intervalMs > 0)
  )
    throw new TypeError('Invalid bare measurement configuration')
  await options.ready()
  for (let index = 0; index < warmup; index++) await options.exchange()
  /** Only window observations contribute to these per-PID absolute RSS peaks. */
  const peaks = new Map(pids.map((pid) => [pid, 0]))
  /** Capture asynchronous sampling failures without silently dropping a bad reading. */
  let samplingError
  /** Normalize a complete PID snapshot, rejecting duplicates and missing resource readings. */
  const capture = (rows) => {
    if (rows.length !== pids.length || new Set(rows.map((row) => row.pid)).size !== pids.length)
      throw new Error('Missing or duplicate PID observation')
    for (const row of rows) {
      if (
        !peaks.has(row.pid) ||
        !Number.isFinite(row.cpuNs) ||
        row.cpuNs < 0 ||
        !Number.isFinite(row.rssBytes) ||
        row.rssBytes <= 0
      )
        throw new Error('Missing CPU or absolute RSS observation')
      peaks.set(row.pid, Math.max(peaks.get(row.pid), row.rssBytes))
    }
    return rows
  }
  /** CPU starts after warmup, by PID; RUSAGE_CHILDREN and launch CPU are excluded. */
  const before = capture(await options.observer.read())
  /** Samples retained in order permit review of spikes rather than replacing bad rounds. */
  const latenciesNs = []
  /** Sampling starts at the window boundary, never during readiness or warmup. */
  const startedNs = nowNs()
  /** The throughput window ends at the last settled echo, before observer cleanup. */
  let finishedNs
  /** The observer owns its sampling loop and must join it when this callback is stopped. */
  const stop = options.observer.start((rows) => {
    if (finishedNs !== undefined) return
    try {
      capture(rows)
    } catch (error) {
      samplingError ??= error
    }
  })
  /** Final CPU snapshot is taken immediately after the last settled echo. */
  let after
  /** Measurement failure stays first when observer cleanup also fails. */
  const failures = []
  try {
    for (let index = 0; index < samples; index++) {
      /** One settled request latency includes the complete physical echo round trip. */
      const begin = nowNs()
      await options.exchange()
      latenciesNs.push(nowNs() - begin)
    }
    finishedNs = nowNs()
    after = capture(await options.observer.read())
  } catch (error) {
    failures.push(error)
  }
  try {
    await stop()
  } catch (error) {
    failures.push(error)
  }
  if (failures.length > 1)
    throw new AggregateError(failures, 'Measurement and observer cleanup failed')
  if (failures.length) throw failures[0]
  if (samplingError) throw samplingError
  /** Match snapshots by PID instead of depending on observer row ordering. */
  const cpuByPid = after.map((row) => ({
    pid: row.pid,
    cpuNs: row.cpuNs - before.find((entry) => entry.pid === row.pid).cpuNs
  }))
  if (cpuByPid.some((row) => row.cpuNs < 0) || finishedNs <= startedNs)
    throw new Error('Invalid CPU or elapsed measurement window')
  return {
    samples,
    warmup,
    latenciesNs,
    p50Ns: nearestRank(latenciesNs, 0.5),
    p99Ns: nearestRank(latenciesNs, 0.99),
    elapsedNs: finishedNs - startedNs,
    throughputPerSecond: (samples * 1e9) / (finishedNs - startedNs),
    cpuNsPerRequest: cpuByPid.reduce((sum, row) => sum + row.cpuNs, 0) / samples,
    cpuByPid,
    rssPeaksByPid: [...peaks].map(([pid, rssBytes]) => ({ pid, rssBytes })),
    rssAbsolutePeakSumBytes: [...peaks.values()].reduce((sum, value) => sum + value, 0),
    observer: { method: options.observer.method, intervalMs: options.observer.intervalMs, pids }
  }
}

/**
 * Compute each ratio from complete paired receipts; incomplete observations are preparation
 * failures, never a performance assertion marker.
 *
 * @param {object} bare Bare receipt.
 * @param {object} rpc RPC receipt from the same frozen unit.
 * @returns {{ p99: number; throughput: number; cpu: number; rss: number }} Exact round ratios.
 * @throws {Error} Missing samples, endpoint attribution, nonpositive denominator or mismatch.
 */
export function pairedRatios(bare, rpc) {
  for (const side of [bare, rpc]) {
    if (
      !side ||
      side.samples < 1000 ||
      side.latenciesNs?.length !== side.samples ||
      !(side.p99Ns > 0) ||
      !(side.throughputPerSecond > 0) ||
      !(side.cpuNsPerRequest > 0) ||
      !(side.rssAbsolutePeakSumBytes > 0) ||
      !side.cpuByPid?.length ||
      !side.rssPeaksByPid?.length ||
      new Set(side.cpuByPid.map((row) => row.pid)).size !== side.cpuByPid.length ||
      side.cpuByPid.length !== side.rssPeaksByPid.length ||
      side.cpuByPid.some((row) => !Number.isFinite(row.cpuNs) || row.cpuNs < 0) ||
      side.rssPeaksByPid.some(
        (row) => !(row.rssBytes > 0) || !side.cpuByPid.some((cpu) => cpu.pid === row.pid)
      )
    )
      throw new Error('Incomplete paired measurement')
    /** Distinct processes must both be observed; a worker PID is charged exactly once. */
    const expected = new Set([side.parentPid, side.peerPid])
    if (
      expected.size !== side.cpuByPid.length ||
      side.cpuByPid.some((row) => !expected.has(row.pid))
    )
      throw new Error('Incomplete endpoint attribution')
    if (
      side.cpuByPid.reduce((sum, row) => sum + row.cpuNs, 0) / side.samples !==
        side.cpuNsPerRequest ||
      side.rssPeaksByPid.reduce((sum, row) => sum + row.rssBytes, 0) !==
        side.rssAbsolutePeakSumBytes
    )
      throw new Error('Inconsistent endpoint totals')
  }
  if (
    JSON.stringify(bare.unit) !== JSON.stringify(rpc.unit) ||
    bare.encodedBytes !== rpc.encodedBytes ||
    bare.concurrency !== rpc.concurrency ||
    bare.runtime !== rpc.runtime
  )
    throw new Error('Paired configuration mismatch')
  /** All ratios retain the RPC/bare direction; throughput has a minimum, the others maxima. */
  const ratios = {
    p99: rpc.p99Ns / bare.p99Ns,
    throughput: rpc.throughputPerSecond / bare.throughputPerSecond,
    cpu: rpc.cpuNsPerRequest / bare.cpuNsPerRequest,
    rss: rpc.rssAbsolutePeakSumBytes / bare.rssAbsolutePeakSumBytes
  }
  if (Object.values(ratios).some((ratio) => !Number.isFinite(ratio) || ratio <= 0))
    throw new Error('Invalid paired ratio')
  return ratios
}

/**
 * Judge at least three retained alternating rounds without dropping or replacing failed rounds.
 *
 * @param {{ order: string[]; bare: object; rpc: object }[]} rounds Original paired observations.
 * @returns {object} Four ratio medians and threshold status.
 * @throws {Error} Invalid round order or incomplete measurement.
 */
export function judgePairs(rounds) {
  if (rounds.length < 3) throw new Error('At least three paired rounds required')
  /** Preserve every round's ratios and actual execution order in the final receipt. */
  const ratiosByRound = rounds.map((round, index) => {
    if (
      JSON.stringify(round.order) !== JSON.stringify(index % 2 ? ['rpc', 'bare'] : ['bare', 'rpc'])
    )
      throw new Error('Paired order must alternate')
    return pairedRatios(round.bare, round.rpc)
  })
  /** Median is arithmetic mean of two central values for an even retained round count. */
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[index] : (sorted[index - 1] + sorted[index]) / 2
  }
  const ratios = Object.fromEntries(
    Object.keys(IpcBenchThreshold).map((key) => [
      key,
      median(ratiosByRound.map((round) => round[key]))
    ])
  )
  return {
    type: 'bench-ratio',
    status:
      ratios.p99 <= 3 && ratios.throughput >= 0.5 && ratios.cpu <= 3 && ratios.rss <= 2
        ? 'pass'
        : 'fail',
    samples: {
      bare: Math.min(...rounds.map((round) => round.bare.samples)),
      rpc: Math.min(...rounds.map((round) => round.rpc.samples))
    },
    ratios,
    thresholds: IpcBenchThreshold,
    ratiosByRound
  }
}

/**
 * Run the complete frozen matrix exclusively from the root's serial performance queue.
 *
 * @returns {Promise<void>} Emits full side receipts, original rounds and ratio medians.
 * @throws {Error} Frozen missing capability, launch, observer or metric failure; no ratio marker.
 */
async function pairedMain() {
  const { admitConformanceToolchains } =
    await import('../test/process/fixtures/conformance-toolchains.mjs')
  const admission = admitConformanceToolchains()
  console.log(JSON.stringify({ type: 'toolchain-admission', ...admission }))
  if (!admission.accepted) throw new Error(JSON.stringify(admission))
  const { spawn } = await import('node:child_process')
  const { readFile } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  /** Capability inventory is frozen before any measurement, not reconstructed after failures. */
  const inventory = JSON.parse(
    await readFile(new URL('./support-units.json', import.meta.url), 'utf8')
  )
  if (
    !inventory.frozen ||
    !inventory.units?.length ||
    inventory.units.some((unit) => unit.status !== 'supported' || !unit.evidence)
  )
    throw new Error('Support inventory is not frozen')
  /** A parent subprocess owns each side's CPU/RSS accounting; coordinator is never charged. */
  const run = (unit, side) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        unit.executable,
        [fileURLToPath(new URL('./ipc-side.mjs', import.meta.url)), JSON.stringify({ unit, side })],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      let output = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        output += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.once('error', reject)
      child.once('close', (code) => {
        if (code !== 0) {
          reject(new Error(`IPC side preparation/measurement failed (${code}): ${stderr}`))
          return
        }
        try {
          resolve(JSON.parse(output))
        } catch (error) {
          reject(error)
        }
      })
    })
  let failed = inventory.blocked?.some((unit) => unit.required) ?? false
  for (const unit of inventory.blocked ?? [])
    console.log(JSON.stringify({ type: 'bench-unit', status: 'blocked', unit }))
  for (const unit of inventory.units) {
    /** Each frozen cell retains its original three rounds, including a measurement failure. */
    const rounds = []
    try {
      for (let index = 0; index < 3; index++) {
        const order = index % 2 ? ['rpc', 'bare'] : ['bare', 'rpc']
        const round = { order }
        rounds.push(round)
        for (const side of order) {
          round[side] = await run(unit, side)
          console.log(JSON.stringify({ type: 'bench-side-receipt', round: index, ...round[side] }))
        }
      }
      const judged = judgePairs(rounds)
      console.log(JSON.stringify({ type: 'bench-unit', unit, rounds, ...judged }))
      if (judged.status === 'fail') {
        failed = true
        console.log(JSON.stringify({ ...judged, unit, code: 'A10_BENCH_RATIO_ASSERTION' }))
      }
    } catch (error) {
      failed = true
      /** An invalid round stays visible; never rerun it until a lucky result passes. */
      console.log(
        JSON.stringify({
          type: 'bench-unit',
          status: 'fail',
          failureKind: 'measurement-incomplete',
          unit,
          rounds,
          error: { name: error.name, message: error.message }
        })
      )
    }
  }
  if (failed) process.exitCode = 1
}

/** Imports by preparation tests and bare-side modules never execute a measured window. */
if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1])
  pairedMain().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
