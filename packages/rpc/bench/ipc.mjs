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
