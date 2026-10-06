import { IpcBenchErrorText } from './error-text.mjs'
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
 *   concurrency?: number
 *   nowNs?: () => number
 * }} IBareOptions
 */

/** The immutable acceptance thresholds are the user's four relative targets. */
export const IpcBenchThreshold = Object.freeze({ p99: 3, throughput: 0.5, cpu: 3, rss: 2 })

/** DA1 supersedes the historical aggregate CPU/RSS verdict for the final registered matrix. */
export const Da1BenchThreshold = Object.freeze({
  small: Object.freeze({ wall: 4, p99: 5, cpuByPid: 5 }),
  large: Object.freeze({ p99: 3, throughput: 0.5, cpuByPid: 3, rssByPid: 2 })
})

/** U33 keeps the historical B0 concurrency floors descriptive, separate from regression gates. */
export const Da1ConcurrencyTrackingStatus = Object.freeze({
  /** The complete implementation reaches the historical minimal-path comparison target. */
  met: '达到跟踪目标',
  /** The old B0 target is missed; this label alone must never block DA1 or W3. */
  below: '未达跟踪目标'
})

/**
 * Judge DA1 from every retained alternating pair and match independently launched PIDs by role. A
 * shared Worker process is charged once; missing endpoint observations never yield PASS.
 *
 * @param {{ order: string[]; bare: object; rpc: object }[]} rounds Complete original receipts.
 * @param {'small' | 'large' | 'concurrency'} scenario Registered budget domain.
 * @param {number} floor Historical B0 throughput tracking target for concurrency only.
 * @param {{ baseline: object; noiseBand: number }} [guard] Frozen W3 p50 and same-window A/A noise.
 * @returns {object} Median ratios, every round and exact threshold disposition.
 * @throws {Error} Incomplete measurements or absent PID denominators.
 */
export function judgeDa1Pairs(rounds, scenario, floor, guard) {
  /** Existing oracle preserves configuration, sample, attribution and alternating-order guards. */
  const original = judgePairs(rounds)
  /** Role matching compares equivalent processes, never unrelated numeric PID identities. */
  const byRound = rounds.map(({ bare, rpc }) => {
    /** Each independent endpoint is judged; shared Worker PID appears only as parent. */
    const shared = bare.parentPid === bare.peerPid
    /** Equivalent endpoint roles compare distinct launches without comparing unrelated numeric PIDs. */
    const roles = [
      ...(shared ? ['parent'] : ['parent', 'peer']),
      ...(bare.browserPid ? ['browser'] : [])
    ]
    if (
      (rpc.parentPid === rpc.peerPid) !== shared ||
      Boolean(bare.browserPid) !== Boolean(rpc.browserPid)
    )
      throw new Error(IpcBenchErrorText.endpoint)
    /** Positive counters are required before forming a ratio, including the peer process. */
    const roleRatios = (key, field) =>
      Object.fromEntries(
        roles.map((role) => {
          /**
           * Bare resource consumption is the per-role denominator, never a process-total
           * substitute.
           */
          const denominator = bare[key].find((row) => row.pid === bare[role + 'Pid'])?.[field]
          /** Candidate consumption belongs to its independently launched equivalent role. */
          const numerator = rpc[key].find((row) => row.pid === rpc[role + 'Pid'])?.[field]
          if (!(denominator > 0) || !(numerator >= 0)) throw new Error(IpcBenchErrorText.endpoint)
          return [role, numerator / denominator]
        })
      )
    if (!(bare.elapsedNs > 0) || !(rpc.elapsedNs > 0)) throw new Error(IpcBenchErrorText.paired)
    return {
      wall: rpc.elapsedNs / rpc.samples / (bare.elapsedNs / bare.samples),
      cpuByPid: roleRatios('cpuByPid', 'cpuNs'),
      rssByPid: roleRatios('rssPeaksByPid', 'rssBytes')
    }
  })
  /** Arithmetic medians retain all three pairs; no failed round can be discarded. */
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }
  /** Every PID role retains its own ratio instead of hiding it in the process total. */
  const mediansByRole = (key) =>
    Object.fromEntries(
      Object.keys(byRound[0][key]).map((role) => [
        role,
        median(byRound.map((round) => round[key][role]))
      ])
    )
  /** Historical total ratios remain descriptive raw evidence, not the final per-PID gates. */
  const ratios = {
    ...original.ratios,
    wall: median(byRound.map((round) => round.wall)),
    cpuByPid: mediansByRole('cpuByPid'),
    rssByPid: mediansByRole('rssByPid')
  }
  /** U33 retires B0 concurrency floors as gates; existing small/large budgets remain unchanged. */
  const thresholds = scenario === 'concurrency' ? {} : Da1BenchThreshold[scenario]
  if (!thresholds || (scenario === 'concurrency' && !(floor > 0)))
    throw new Error(IpcBenchErrorText.paired)
  /** All applicable budgets must hold; missing metrics cannot be interpreted as a pass. */
  const failedMetrics = []
  if (thresholds.wall !== undefined && ratios.wall > thresholds.wall) failedMetrics.push('wall')
  if (thresholds.p99 !== undefined && ratios.p99 > thresholds.p99) failedMetrics.push('p99')
  if (thresholds.throughput !== undefined && ratios.throughput < thresholds.throughput)
    failedMetrics.push('throughput')
  for (const key of ['cpuByPid', 'rssByPid'])
    if (thresholds[key] !== undefined)
      for (const [role, ratio] of Object.entries(ratios[key]))
        if (ratio > thresholds[key]) failedMetrics.push(key + '.' + role)
  /** Relative p50 regression is judged separately from the unchanged absolute DA1 budgets. */
  const regression = guard ? judgeW3Regression(rounds, guard.baseline, guard.noiseBand) : undefined
  if (regression?.status === 'fail') failedMetrics.push('w3.p50')
  /** Historical targets stay visible in each complete concurrency receipt without gating it. */
  const tracking =
    scenario === 'concurrency'
      ? {
          throughput: {
            target: floor,
            status:
              ratios.throughput < floor
                ? Da1ConcurrencyTrackingStatus.below
                : Da1ConcurrencyTrackingStatus.met
          }
        }
      : undefined
  return {
    type: 'da1-ratio',
    status: failedMetrics.length ? 'fail' : 'pass',
    scenario,
    ratios,
    thresholds,
    failedMetrics,
    ratiosByRound: original.ratiosByRound,
    endpointRatiosByRound: byRound,
    samples: original.samples,
    ...(tracking ? { tracking } : {}),
    ...(regression ? { regression } : {})
  }
}

/**
 * Compare every retained pair's RPC/bare p50 with the frozen pre-program implementation.
 *
 * @param {object[]} rounds Three complete alternating bare/RPC pairs.
 * @param {object} baseline Frozen W3 ratio and original raw-data provenance.
 * @param {number} noiseBand Maximum measured A/A change of the same normalized metric.
 * @returns {object} Original pair ratios, median and independent no-regression verdict.
 * @throws {Error} Missing baseline, noise or nonpositive latency denominator.
 */
export function judgeW3Regression(rounds, baseline, noiseBand) {
  if (!(baseline?.p50Ratio > 0) || !Number.isFinite(noiseBand) || noiseBand < 0)
    throw new Error(IpcBenchErrorText.paired)
  /** Nearest rank is recomputed from full samples, including original browser clock observations. */
  const ratiosByRound = rounds.map(({ bare, rpc }) => {
    /** Browser clock resolution can produce genuine zero samples; no sample is clamped or removed. */
    const options = { allowClockResolutionZero: bare.unit.carrier === 'browser-worker' }
    const denominator = nearestRank(bare.latenciesNs, 0.5, options)
    if (!(denominator > 0)) throw new Error(IpcBenchErrorText.paired)
    return nearestRank(rpc.latenciesNs, 0.5, options) / denominator
  })
  /** Three original pairs determine the median without selecting a favorable launch. */
  const candidateRatio = [...ratiosByRound].sort((a, b) => a - b)[1]
  /** A positive change means worse normalized RPC latency than the original frozen W3 data. */
  const relativeChange = candidateRatio / baseline.p50Ratio - 1
  return {
    status: relativeChange > noiseBand ? 'fail' : 'pass',
    metric: 'median of three paired RPC/bare p50 ratios',
    baseline,
    candidateRatio,
    relativeChange,
    noiseBand,
    ratiosByRound
  }
}

/**
 * Judge the user's D5 exclusive window using its two one-minute load observations. Raw measurements
 * remain available when environmental admission fails; no ratio verdict is inferred.
 *
 * @param {number} startLoad One-minute load at window admission.
 * @param {number} endLoad One-minute load after the complete window.
 * @param {number} logicalCores Host logical CPU count.
 * @returns {{ status: 'pass' | 'error'; exitCode: 0 | 2; code?: string }} Window disposition.
 */
export function judgeWindowLoad(startLoad, endLoad, logicalCores) {
  if (startLoad > logicalCores * 0.5 || endLoad > logicalCores * 0.5)
    return { status: 'error', exitCode: 2, code: 'A10_BENCH_ENVIRONMENT' }
  return { status: 'pass', exitCode: 0 }
}

/**
 * Return the nearest-rank latency without interpolating or losing the last sample.
 *
 * @param {number[]} values Measured latencies in nanoseconds; native samples must be positive.
 * @param {number} quantile Quantile between zero and one, exclusive of zero.
 * @param {{ allowClockResolutionZero?: boolean }} options Browser clocks can quantize a real echo
 *   below one clock tick to zero; retain that observation without clamping or dropping it.
 * @returns {number} Latency at ceil(quantile * sample count).
 * @throws {TypeError} If samples or quantile cannot represent a measurement.
 */
export function nearestRank(values, quantile, options = {}) {
  if (
    !values.length ||
    !(quantile > 0 && quantile <= 1) ||
    values.some((v) => !Number.isFinite(v) || (options.allowClockResolutionZero ? v < 0 : v <= 0))
  )
    throw new TypeError(IpcBenchErrorText.latency)
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
  /** Frozen lanes bound actual in-flight echoes without rate catch-up or unbounded bursts. */
  const concurrency = options.concurrency ?? 1
  /** Monotonic clock may be injected for focused measurement-contract checks. */
  const nowNs = options.nowNs ?? (() => Number(process.hrtime.bigint()))
  /** Deduplication prevents worker units charging one process twice. */
  const pids = [...new Set(options.observer.pids)]
  if (
    !Number.isInteger(samples) ||
    samples < 1000 ||
    !Number.isInteger(warmup) ||
    warmup < 0 ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    !pids.length ||
    pids.some((pid) => !Number.isInteger(pid) || pid <= 0) ||
    !options.observer.method ||
    !(options.observer.intervalMs > 0)
  )
    throw new TypeError(IpcBenchErrorText.configuration)
  await options.ready()
  for (let index = 0; index < warmup; index++) await options.exchange()
  /** Only window observations contribute to these per-PID absolute RSS peaks. */
  const peaks = new Map(pids.map((pid) => [pid, 0]))
  /** Capture asynchronous sampling failures without silently dropping a bad reading. */
  let samplingError
  /** Normalize a complete PID snapshot, rejecting duplicates and missing resource readings. */
  const capture = (rows) => {
    if (rows.length !== pids.length || new Set(rows.map((row) => row.pid)).size !== pids.length)
      throw new Error(IpcBenchErrorText.pid)
    for (const row of rows) {
      if (
        !peaks.has(row.pid) ||
        !Number.isFinite(row.cpuNs) ||
        row.cpuNs < 0 ||
        !Number.isFinite(row.rssBytes) ||
        row.rssBytes <= 0
      )
        throw new Error(IpcBenchErrorText.resource)
      peaks.set(row.pid, Math.max(peaks.get(row.pid), row.rssBytes))
    }
    return rows
  }
  /** CPU starts after warmup, by PID; RUSAGE_CHILDREN and launch CPU are excluded. */
  const before = capture(await options.observer.read())
  /** Samples retained in order permit review of spikes rather than replacing bad rounds. */
  const latenciesNs = []
  /** Issue order, completion order and peak in-flight are retained for concurrent cells. */
  const completionOrder = []
  /** Monotonic issue index is shared by bounded lanes in this one JavaScript isolate. */
  let nextIndex = 0
  /** Actual outstanding exchanges are distinct from provider-side admission concurrency. */
  let inFlight = 0
  /** The measured client peak is never reported as provider concurrency. */
  let peakInFlight = 0
  /** A real exchange failure stops issuing and joins the already outstanding lanes before cleanup. */
  let firstFailure
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
    /** Each lane refills only after its preceding echo settles; no timer can accumulate backlog. */
    const lane = async () => {
      while (nextIndex < samples && firstFailure === undefined) {
        /** Raw latency indices follow issue order even when independent results finish out of order. */
        const index = nextIndex++
        /** One settled request includes the complete physical echo round trip. */
        const begin = nowNs()
        inFlight += 1
        peakInFlight = Math.max(peakInFlight, inFlight)
        try {
          await options.exchange()
          latenciesNs[index] = nowNs() - begin
          completionOrder.push(index)
        } catch (error) {
          firstFailure ??= { error }
          throw error
        } finally {
          inFlight -= 1
        }
      }
    }
    await Promise.allSettled(Array.from({ length: concurrency }, lane))
    if (firstFailure) throw firstFailure.error
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
  if (failures.length > 1) throw new AggregateError(failures, IpcBenchErrorText.observerCleanup)
  if (failures.length) throw failures[0]
  if (samplingError) throw samplingError
  /** Match snapshots by PID instead of depending on observer row ordering. */
  const cpuByPid = after.map((row) => ({
    pid: row.pid,
    cpuNs: row.cpuNs - before.find((entry) => entry.pid === row.pid).cpuNs
  }))
  if (cpuByPid.some((row) => row.cpuNs < 0) || finishedNs <= startedNs)
    throw new Error(IpcBenchErrorText.window)
  return {
    samples,
    warmup,
    concurrency,
    clientPeakInFlight: peakInFlight,
    initialBurstSize: Math.min(concurrency, samples),
    refillBurstSize: 1,
    completionOrder,
    latenciesNs,
    p50Ns: nearestRank(latenciesNs, 0.5),
    p95Ns: nearestRank(latenciesNs, 0.95),
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
      throw new Error(IpcBenchErrorText.paired)
    /** Distinct processes must both be observed; a worker PID is charged exactly once. */
    const expected = new Set([
      side.parentPid,
      side.peerPid,
      ...(side.browserPid ? [side.browserPid] : [])
    ])
    if (
      expected.size !== side.cpuByPid.length ||
      side.cpuByPid.some((row) => !expected.has(row.pid))
    )
      throw new Error(IpcBenchErrorText.endpoint)
    if (
      side.cpuByPid.reduce((sum, row) => sum + row.cpuNs, 0) / side.samples !==
        side.cpuNsPerRequest ||
      side.rssPeaksByPid.reduce((sum, row) => sum + row.rssBytes, 0) !==
        side.rssAbsolutePeakSumBytes
    )
      throw new Error(IpcBenchErrorText.totals)
  }
  if (
    JSON.stringify(bare.unit) !== JSON.stringify(rpc.unit) ||
    bare.encodedBytes !== rpc.encodedBytes ||
    bare.concurrency !== rpc.concurrency ||
    bare.runtime !== rpc.runtime
  )
    throw new Error(IpcBenchErrorText.mismatch)
  /** All ratios retain the RPC/bare direction; throughput has a minimum, the others maxima. */
  const ratios = {
    p99: rpc.p99Ns / bare.p99Ns,
    throughput: rpc.throughputPerSecond / bare.throughputPerSecond,
    cpu: rpc.cpuNsPerRequest / bare.cpuNsPerRequest,
    rss: rpc.rssAbsolutePeakSumBytes / bare.rssAbsolutePeakSumBytes
  }
  if (Object.values(ratios).some((ratio) => !Number.isFinite(ratio) || ratio <= 0))
    throw new Error(IpcBenchErrorText.ratio)
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
  if (rounds.length < 3) throw new Error(IpcBenchErrorText.rounds)
  /** Preserve every round's ratios and actual execution order in the final receipt. */
  const ratiosByRound = rounds.map((round, index) => {
    if (
      JSON.stringify(round.order) !== JSON.stringify(index % 2 ? ['rpc', 'bare'] : ['bare', 'rpc'])
    )
      throw new Error(IpcBenchErrorText.order)
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
  /** Fixed flags select registered cells; they do not invent payloads or relax budgets. */
  const args = process.argv.slice(2)
  /** Selection defaults to the entire sequential inventory for the existing public script. */
  let scenario = 'sequential'
  /** One explicit ID lets the root split the full matrix into bounded exclusive windows. */
  let selectedId
  /** Complete raw sides are saved before their summaries, never discarded after failure. */
  let output
  /** The serial window supplies its own W3/W3 calibration; historical noise is never substituted. */
  let noisePath
  /** Preparation checks capabilities before freezing the formal inventory. */
  let prepare = false
  /** Listing never starts a measured side. */
  let list = false
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--scenario') scenario = args[++index]
    else if (args[index] === '--unit') selectedId = args[++index]
    else if (args[index] === '--output') output = args[++index]
    else if (args[index] === '--noise') noisePath = args[++index]
    else if (args[index] === '--prepare') prepare = true
    else if (args[index] === '--list') list = true
    else throw new Error(IpcBenchErrorText.inventory)
  }
  const { readFile, writeFile, mkdir, mkdtemp } = await import('node:fs/promises')
  const { fileURLToPath } = await import('node:url')
  const { join } = await import('node:path')
  const { tmpdir } = await import('node:os')
  const { createHash } = await import('node:crypto')
  /** Inventory bytes and selected IDs are preserved before a subprocess launches. */
  const inventoryBytes = await readFile(new URL('./support-units.json', import.meta.url))
  const inventory = JSON.parse(inventoryBytes)
  /** Concurrent floors are already registered alongside their exact carriers and payloads. */
  const candidates = scenario === 'concurrency' ? inventory.concurrentUnits : inventory.units
  if (!['sequential', 'concurrency'].includes(scenario) || !candidates?.length)
    throw new Error(IpcBenchErrorText.inventory)
  /** A selected missing ID is a configuration failure, never an empty successful matrix. */
  const units = selectedId ? candidates.filter((unit) => unit.id === selectedId) : candidates
  if (!units.length) throw new Error(IpcBenchErrorText.inventory)
  if (list) {
    console.log(
      JSON.stringify({
        revision: inventory.revision,
        frozen: inventory.frozen,
        inventorySHA256: createHash('sha256').update(inventoryBytes).digest('hex'),
        scenario,
        units
      })
    )
    return
  }
  /** Frozen ratios ship with the benchmark only; this adds no production endpoint API. */
  const baseline = prepare
    ? undefined
    : JSON.parse(await readFile(new URL('./w3-baseline.json', import.meta.url)))
  /** A missing current-window calibration cannot yield a no-regression claim. */
  const noise = prepare ? undefined : noisePath ? JSON.parse(await readFile(noisePath)) : undefined
  if (
    !prepare &&
    (!noise || noise.sourceCommit !== baseline.sourceCommit || noise.representatives?.length !== 4)
  )
    throw new Error(IpcBenchErrorText.paired)
  if (
    !prepare &&
    (!inventory.frozen || units.some((unit) => unit.status !== 'supported' || !unit.evidence))
  )
    throw new Error(IpcBenchErrorText.inventory)
  const { admitConformanceToolchains } =
    await import('../test/process/fixtures/conformance-toolchains.mjs')
  const admission = admitConformanceToolchains()
  console.log(JSON.stringify({ type: 'toolchain-admission', ...admission }))
  if (!admission.accepted) throw new Error(JSON.stringify(admission))
  const { spawn } = await import('node:child_process')
  output ??= await mkdtemp(join(tmpdir(), 'rpc-da1-raw-'))
  await mkdir(output, { recursive: true })
  /** Each actual side owns its endpoint PIDs; the coordinator and observer are never charged. */
  const run = (unit, side, round) =>
    new Promise((resolve, reject) => {
      /** File identity also carries the native peer's out-of-band boundary snapshots. */
      const stem = output
        ? join(output, unit.id.replaceAll(':', '-') + '-' + round + '-' + side)
        : undefined
      const command = [
        fileURLToPath(new URL('./ipc-side.mjs', import.meta.url)),
        JSON.stringify({ unit, side, options: { check: prepare, samples: 1000, warmup: 100 } })
      ]
      const child = spawn(unit.executable, command, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(stem ? { IPC_BENCH_STEM: stem } : {}) }
      })
      let stdout = '',
        stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString()
      })
      child.once('error', reject)
      child.once('close', async (code) => {
        try {
          if (output) await writeFile(stem + '.stderr.log', stderr)
          if (code !== 0) throw new Error(IpcBenchErrorText.sideFailed(code, stderr))
          const receipt = JSON.parse(stdout)
          if (output)
            await writeFile(
              stem + '.json',
              JSON.stringify({
                ...receipt,
                execution: {
                  command: [unit.executable, ...command],
                  inventorySHA256: createHash('sha256').update(inventoryBytes).digest('hex')
                }
              })
            )
          resolve(receipt)
        } catch (error) {
          reject(error)
        }
      })
    })
  let failed = false
  for (const unit of units) {
    /** Three retained alternating pairs are final; measurement failures never select replacements. */
    const rounds = []
    try {
      for (let index = 0; index < (prepare ? 1 : 3); index++) {
        const order = index % 2 ? ['rpc', 'bare'] : ['bare', 'rpc']
        const round = { order }
        rounds.push(round)
        for (const side of order) {
          round[side] = await run(unit, side, index)
          if (!output)
            console.log(
              JSON.stringify({ ...round[side], round: index, type: 'bench-side-receipt' })
            )
        }
      }
      /** Browser and native observations use the same DA1 judge with actual per-PID attribution. */
      const judged = prepare
        ? { status: 'prepared' }
        : judgeDa1Pairs(
            rounds,
            scenario === 'concurrency'
              ? 'concurrency'
              : unit.payloadBytes <= 1024
                ? 'small'
                : 'large',
            unit.throughputFloor,
            {
              baseline: { ...baseline.cells[unit.id], sourceCommit: baseline.sourceCommit },
              noiseBand: noise.p50RatioNoiseBand
            }
          )
      const result = {
        ...judged,
        type: 'bench-unit',
        unit,
        rounds,
        inventorySHA256: createHash('sha256').update(inventoryBytes).digest('hex')
      }
      if (output)
        await writeFile(
          join(output, unit.id.replaceAll(':', '-') + '-result.json'),
          JSON.stringify(result)
        )
      console.log(JSON.stringify({ ...judged, type: 'bench-unit', unit, rawDirectory: output }))
      if (judged.status === 'fail') failed = true
    } catch (error) {
      failed = true
      const result = {
        type: 'bench-unit',
        status: 'error',
        failureKind: 'measurement-incomplete',
        unit,
        rounds,
        error: { name: error.name, message: error.message }
      }
      if (output)
        await writeFile(
          join(output, unit.id.replaceAll(':', '-') + '-result.json'),
          JSON.stringify(result)
        )
      console.log(JSON.stringify(result))
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
