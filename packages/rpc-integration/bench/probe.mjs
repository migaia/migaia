import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, join } from 'node:path'
import { registerHooks } from 'node:module'
import { promiseHooks } from 'node:v8'
import { AsyncLocalStorage } from 'node:async_hooks'
import { spawn } from 'node:child_process'
import { loadavg } from 'node:os'
import { IpcBenchErrorText } from './error-text.mjs'
import { IpcBenchDiagnostic, IpcProbeBenchStages } from './text.mjs'
import { orderStatistic } from './cross-runtime/statistics.mjs'

/** One canonical fixture vocabulary keeps the four acceptance cells and arms unchanged. */
const ProbeBench = {
  base: 'base',
  absent: 'absent',
  installed: 'installed',
  guard: 'guard',
  timing: 'timing',
  /** Diagnostic launches never qualify formal latency, throughput or exact counter acceptance. */
  diagnostic: 'diagnostic',
  /** One CLI choice selects existing warmed OOB CPU capture or allocation sampling. */
  diagnosticOption: '--diagnostic',
  /** Current source audits stay strict while closure supplies its own explicitly named evidence. */
  collectorAuditOption: '--collector-audit',
  /** Compact diagnostic summaries reference full original launch receipts without timing verdicts. */
  diagnosticSummary: 'diagnostic-summary.json',
  collectorEnabled: '1',
  coreAcceptance: 'core-probe',
  rootAcceptance: 'A-perf',
  collectorRingPath: 'packages/rpc-plugin-devtools/dist/collector/ring.js',
  sourceCommit: 'f607fe6a93c20799521ac1aacc019dde810f5d95',
  cells: [
    { id: 'node-stdio-64B-c1', carrier: 'stdio-framed', payloadBytes: 64, concurrency: 1 },
    { id: 'node-stdio-64B-c64', carrier: 'stdio-framed', payloadBytes: 64, concurrency: 64 },
    { id: 'node-worker-64B-c64', carrier: 'worker', payloadBytes: 64, concurrency: 64 },
    { id: 'node-stdio-1MiB-c1', carrier: 'stdio-framed', payloadBytes: 1048576, concurrency: 1 }
  ]
}
/** Preloaded once in each genuine Node isolate; Workers and child processes inherit NODE_OPTIONS. */
const entry = fileURLToPath(import.meta.url)
/** Module-relative ownership lets every arm retain the same full IPC fixture and dependencies. */
const workspace = resolve(import.meta.dirname, '../../..')
/** Read the fixture's canonical private readiness notice instead of duplicating its protocol text. */
const readyNotice = /^const readyText = '([^']+)'/mu
  .exec(readFileSync(new URL('../test/bench/ipc-session.mjs', import.meta.url), 'utf8'))?.[1]
  ?.replaceAll('\\n', '\n')
/** Base selection only overrides frozen Core bytes; every import still resolves through its owner. */
const corePrefix = pathToFileURL(join(workspace, 'packages/rpc-host/dist/')).href
/** Exact emitted-view identities are counted only in guard launches, outside formal timing. */
const views = new WeakSet()
/** Per-isolate native counters begin before IPC acquisition, then snapshots exclude warm-up. */
const counters = {
  promises: 0,
  eventObjects: 0,
  events: 0,
  normalizePortable: 0,
  nativePromises: 0,
  samplerPromises: 0,
  collectorCalls: 0,
  collectorEventObjects: 0
}
/** Provenance records original dist bytes separately from intentional guard instrumentation. */
const loaded = []
/** Arm and lane are inherited data; they never alter the carrier or business value. */
const arm = process.env.PROBE_BENCH_ARM
/** Exact counters deliberately run separately so their observer cost receives no timing credit. */
const guarding = process.env.PROBE_BENCH_LANE === ProbeBench.guard
/**
 * Root timing installs the genuine collector with the selected metadata stages and capture
 * disabled.
 */
const collectorMode = process.env.PROBE_BENCH_COLLECTOR === ProbeBench.collectorEnabled
/** Omitted CLI selection retains the revision-1 all-stage arm and its original fixed budgets. */
const stageMode = process.env[IpcProbeBenchStages.environment] ?? IpcProbeBenchStages.legacy
/** Cold snapshots record the exact installed stage set and whether production defaults were used. */
let stageSelection
/**
 * The frozen collector host remains the installed identity; only cold snapshots call its API.
 *
 * @type {import('@migaia/rpc-plugin-devtools').IRpcDevtools | undefined}
 */
let collector
/** Loaded guard provenance proves the actual collector event allocation site was instrumented. */
let collectorEventCounter
/** Frozen Core bytes are required for a genuine base rather than two candidate configurations. */
const baseDist = process.env.PROBE_BENCH_BASE_DIST
/** Guard-only context labels the existing PID sampling work; the sampler never invokes RPC. */
const samplerRole = guarding ? new AsyncLocalStorage() : undefined
/** Run the unchanged timer callback in its own diagnostic role, including its async continuations. */
globalThis.__PROBE_BENCH_SAMPLER = (callback) => samplerRole.run(true, callback)
/** Native Promise initialization counts actual allocations in this isolate, without stack sampling. */
const stopPromises = guarding
  ? promiseHooks.createHook({
      init() {
        counters.nativePromises += 1
        if (samplerRole.getStore() === true) counters.samplerPromises += 1
        else counters.promises += 1
      }
    })
  : undefined

/**
 * Capture cold boundary values for the existing out-of-band observation channel.
 *
 * @returns {object} Exact cumulative counts and loaded SHA rows from this isolate.
 */
function counterSnapshot() {
  if (collector !== undefined) {
    counters.collectorCalls = 0
    for (const row of collector.stats().methods) counters.collectorCalls += row.calls
  }
  // An OOB diagnostic receipt converts local counters to a wire representation.
  return {
    ...counters,
    loaded: loaded.slice(),
    stageSelection: stageSelection ?? null,
    collectorEventCounter: collectorEventCounter ?? null,
    collector:
      collector === undefined
        ? null
        : { stageMask: collector.stageMask, captureMask: collector.captureMask }
  }
}
globalThis.__PROBE_BENCH_SNAPSHOT = counterSnapshot

if (arm !== undefined) {
  registerHooks({
    load(url, context, nextLoad) {
      /** Read the ordinary loader result first, preserving module format and resolution semantics. */
      const result = nextLoad(url, context)
      if (typeof result.source !== 'string' && !ArrayBuffer.isView(result.source)) return result
      /** Instrumentation never mutates files, including frozen contract assets and dist provenance. */
      let source =
        typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString()
      if (url.startsWith(corePrefix) && arm === ProbeBench.base) {
        if (!baseDist) throw new Error(IpcBenchErrorText.configuration)
        source = readFileSync(
          join(baseDist, decodeURIComponent(url.slice(corePrefix.length))),
          'utf8'
        )
      }
      /** Keep original selected bytes, then add the hash of the final loader-returned source. */
      let provenance
      if (url.includes('/dist/') && url.startsWith('file:')) {
        provenance = {
          url,
          source:
            arm === ProbeBench.base && url.startsWith(corePrefix) ? ProbeBench.base : 'candidate',
          sha256: createHash('sha256').update(source).digest('hex'),
          guarded: guarding
        }
        loaded.push(provenance)
      }
      if (
        guarding &&
        collectorMode &&
        arm === ProbeBench.installed &&
        url === pathToFileURL(join(workspace, ProbeBench.collectorRingPath)).href
      ) {
        /** The source audit fixes coverage; this hook counts the one event-shaped allocation site. */
        const pattern = /(\n        const event = \{\n            seq: c\.seq\[slot\],)/gu
        if (
          Array.from(source.matchAll(pattern)).length !== 1 ||
          provenance.sha256 !== process.env.PROBE_BENCH_COLLECTOR_RING_SHA ||
          !process.env.PROBE_BENCH_COLLECTOR_AUDIT_SHA
        )
          throw new Error(IpcBenchErrorText.configuration)
        source = source.replace(
          pattern,
          '\n        globalThis.__PROBE_BENCH_COLLECTOR_EVENT_OBJECT();$1'
        )
        collectorEventCounter = {
          source: url,
          counter: 'collectorEventObjects',
          instrumented: true,
          sourceSha256: provenance.sha256,
          auditSha256: process.env.PROBE_BENCH_COLLECTOR_AUDIT_SHA
        }
      }
      if (guarding && url.endsWith('/rpc-contract/dist/contract/normalize.js')) {
        /** Count the canonical normalization entry, never an inferred proxy or wrapper call. */
        const pattern = /(export function normalizePortable\([^)]*\)\s*\{)/u
        if (!pattern.test(source)) throw new Error(IpcBenchErrorText.configuration)
        source = source.replace(pattern, '$1 globalThis.__PROBE_BENCH_NORMALIZE();')
      }
      if (guarding && url.endsWith('/rpc-integration/bench/bare-node.mjs')) {
        /**
         * Exact sampler-role counts remove only demonstrated auxiliary work, never unknown
         * promises.
         */
        const marker = 'const timer = setInterval(() => {'
        if (!source.includes(marker)) throw new Error(IpcBenchErrorText.configuration)
        source = source.replace(
          marker,
          'const timer = setInterval(() => globalThis.__PROBE_BENCH_SAMPLER(() => {'
        )
        source = source.replace('}, intervalMs)', '}), intervalMs)')
      }
      if (url.endsWith('/rpc-integration/test/bench/ipc-session.mjs')) {
        /**
         * The existing stdio launcher deliberately inherits PATH only. This fixture-only boundary
         * forwards its explicit diagnostic configuration so the real peer uses the same arm, frozen
         * Core bytes and counters. Business arguments, transport and ownership stay unchanged.
         */
        const marker = "inherit: ['PATH']"
        if (!source.includes(marker)) throw new Error(IpcBenchErrorText.configuration)
        source = source.replaceAll(
          marker,
          `inherit: ['PATH', 'NODE_OPTIONS', 'PROBE_BENCH_ARM', 'PROBE_BENCH_LANE', 'PROBE_BENCH_BASE_DIST', 'PROBE_BENCH_COLLECTOR', 'PROBE_BENCH_COLLECTOR_RING_SHA', 'PROBE_BENCH_COLLECTOR_AUDIT_SHA', '${IpcProbeBenchStages.environment}']`
        )
      }
      if (url.endsWith('/rpc-integration/bench/observe.mjs')) {
        /**
         * Frozen-base selection and guard counters deliberately change loaded bytes, with
         * provenance.
         */
        source = source.replace(
          'diagnosticOverlay: false',
          "diagnosticOverlay: process.env.PROBE_BENCH_ARM !== 'absent' || process.env.PROBE_BENCH_LANE === 'guard'"
        )
        /** The existing OOB receipt carries both isolates' counters without another RPC method. */
        const marker = 'return {\n    pid: process.pid,'
        if (!source.includes(marker)) throw new Error(IpcBenchErrorText.configuration)
        source = source.replace(
          marker,
          'return {\n    probeCounters: globalThis.__PROBE_BENCH_SNAPSHOT(),\n    pid: process.pid,'
        )
      }
      if (provenance !== undefined) {
        provenance.executedSha256 = createHash('sha256').update(source).digest('hex')
        provenance.instrumented = provenance.executedSha256 !== provenance.sha256
        if (collectorEventCounter?.source === url)
          collectorEventCounter.executedSha256 = provenance.executedSha256
      }
      // The Node loader boundary needs a result carrying the selected source representation.
      return { ...result, source }
    }
  })
  globalThis.__PROBE_BENCH_NORMALIZE = () => {
    counters.normalizePortable += 1
  }
  globalThis.__PROBE_BENCH_COLLECTOR_EVENT_OBJECT = () => {
    counters.collectorEventObjects += 1
  }
  if (arm === ProbeBench.installed) {
    /** Canonical stage names select the same mask for the guard as the actual installed probe. */
    const { defineProbe, RpcProbeStageName } = await import('@migaia/rpc-host/probe')
    /** Fixed selected stages keep the near-noop Core arm comparable with the genuine collector. */
    const selectedStages =
      stageMode === IpcProbeBenchStages.default
        ? IpcProbeBenchStages.defaultStages
        : RpcProbeStageName
    /** Compile only the assertion mask; defineProbe remains the production configuration owner. */
    const selectedMask = selectedStages.reduce(
      (mask, name) => mask | (1 << RpcProbeStageName.indexOf(name)),
      0
    )
    /** Cold reporting preserves full native failure classification in both measured modes. */
    const onError = (error) => {
      console.error(JSON.stringify(classifyFailure(error)))
    }
    if (collectorMode) {
      /** No host copy, wrapper or post-definition emit replacement changes its compiled identity. */
      const { devtoolsPlugin } = await import('@migaia/rpc-plugin-devtools')
      collector = devtoolsPlugin(
        stageMode === IpcProbeBenchStages.default
          ? { onError }
          : { stages: selectedStages, onError }
      ).collector
      if (collector.captureMask !== 0 || collector.stageMask !== selectedMask)
        throw new Error(IpcBenchErrorText.configuration)
      globalThis.__PROBE_BENCH_PROBE = collector
    }
    stageSelection = {
      mode: stageMode,
      stages: selectedStages.slice(),
      stageMask: collector?.stageMask ?? selectedMask,
      collectorDefault: collectorMode && stageMode === IpcProbeBenchStages.default
    }
    /** Root timing has only the genuine collector; the separate counting probe is guard-only. */
    if (!collectorMode || guarding) {
      /** Build stage membership once, never enabling a stage absent from the actual collector. */
      const stages = []
      for (let index = 0; index < RpcProbeStageName.length; index++) {
        if ((selectedMask & (1 << index)) !== 0) stages.push(RpcProbeStageName[index])
      }
      /** Guard-only counting observes Core view identities, not gross collector VM allocations. */
      const countingProbe = defineProbe({
        stages,
        emit(view) {
          counters.events += 1
          if (guarding && !views.has(view)) {
            views.add(view)
            counters.eventObjects += 1
          }
        },
        onError
      })
      globalThis.__PROBE_BENCH_PROBE =
        collector === undefined ? countingProbe : [collector, countingProbe]
    }
  }
}

/**
 * Preserve every causal failure and native classification while redacting fixture content/auth.
 *
 * @param {unknown} error Original failure or provider-report value.
 * @param {Set<object>} [seen] Already visited original causal identities.
 * @returns {object} Redacted source, code, name, reason, message, cause and aggregate members.
 */
function classifyFailure(error, seen = new Set()) {
  if (error && typeof error === 'object') {
    if (seen.has(error)) return { repeatedCause: true }
    seen.add(error)
  }
  /** Only diagnostics are converted to text; no arbitrary payload or credential is retained. */
  const redact = (value) =>
    String(value)
      .replaceAll('bench-local', '[REDACTED_AUTH]')
      .replace(/x{16,}/gu, '[REDACTED_PAYLOAD]')
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/giu, '[REDACTED_AUTH]')
  return {
    source: error?.source ?? null,
    code: error?.code ?? null,
    name: error?.name ?? typeof error,
    reason: error?.reason == null ? null : redact(error.reason),
    message: redact(error?.message ?? error),
    cause: error?.cause === undefined ? null : classifyFailure(error.cause, seen),
    errors: Array.isArray(error?.errors)
      ? error.errors.map((value) => classifyFailure(value, seen))
      : []
  }
}

/**
 * Subtract warm-up snapshots from the original parent and peer receipts, summing actual isolates.
 *
 * @param {object} receipt Unmodified IPC side metrics plus OOB counter snapshots.
 * @returns {object} Exact counts and per-request rates; event-view allocations are identity counts.
 * @throws {Error} Missing actual counter observations remain an error, never a zero claim.
 */
export function countDelta(receipt) {
  /** Per-isolate deltas include the same existing OOB boundaries for every arm. */
  const total = {
    promises: 0,
    eventObjects: 0,
    events: 0,
    normalizePortable: 0,
    nativePromises: 0,
    samplerPromises: 0,
    collectorCalls: 0,
    collectorEventObjects: 0
  }
  for (const [before, after] of [
    [receipt.parentBefore, receipt.parentAfter],
    [receipt.peerBefore, receipt.peerAfter]
  ]) {
    if (!before?.probeCounters || !after?.probeCounters)
      throw new Error(IpcBenchErrorText.configuration)
    for (const key of Object.keys(total))
      total[key] += after.probeCounters[key] - before.probeCounters[key]
  }
  return {
    total,
    perRequest: Object.fromEntries(
      Object.entries(total).map(([key, value]) => [key, value / receipt.samples])
    ),
    eventObjectsPerEvent: total.events === 0 ? null : total.eventObjects / total.events,
    collectorEventCounter: [
      receipt.parentAfter.probeCounters.collectorEventCounter,
      receipt.peerAfter.probeCounters.collectorEventCounter
    ],
    semantics:
      'exact native Promise init with native/sampler totals retained; promises exclude only the existing PID-sampler role (AsyncLocalStorage); all unknown and constant OOB boundary allocations remain counted; exact canonical normalizePortable entry; exact distinct emitted Core view identities after warmup in guard lane; collectorCalls is the genuine collector public stats delta; collectorEventObjects counts the audited collector ring.event literal after its cache-hit return in guard lane; gross VM/Map/hash/string/backing-store allocation remains UNVERIFIED'
  }
}

/**
 * Run one frozen cell/arm in a fresh actual Node parent; retain stderr and all failed receipts.
 *
 * @param {object} cell Frozen carrier, portable payload and bounded concurrency.
 * @param {string} selectedArm Base, absent or installed Core probe/genuine selected-stage
 *   collector.
 * @param {string} lane Formal timing, exact counter guard or separate profiling.
 * @param {object} options Samples, warm-up, base dist, raw output and optional diagnostic mode.
 * @param {string} stem Unique receipt name preserving every interleaved launch.
 * @returns {Promise<object>} Full IPC side receipt, with guard counts when selected.
 * @throws {Error} Child failure remains classified and retained before propagation.
 */
async function launch(cell, selectedArm, lane, options, stem) {
  /** Process launch projects inherited environment into the actual native boundary. */
  const env = {
    ...process.env,
    PROBE_BENCH_ARM: selectedArm,
    PROBE_BENCH_LANE: lane,
    PROBE_BENCH_BASE_DIST: options.baseDist,
    PROBE_BENCH_COLLECTOR: options.collector ? ProbeBench.collectorEnabled : '0',
    [IpcProbeBenchStages.environment]: options.stageMode,
    PROBE_BENCH_COLLECTOR_RING_SHA: options.collectorAudit?.ringCompiledSha256 ?? '',
    PROBE_BENCH_COLLECTOR_AUDIT_SHA: options.collectorAudit?.sha256 ?? '',
    IPC_BENCH_STEM: join(options.output, stem),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(entry).href}`
  }
  /** One JSON argument carries only public fixture data; no authentication is exposed. */
  const input = JSON.stringify({
    cell,
    samples: options.samples,
    warmup: options.warmup,
    diagnostic: options.diagnostic
  })
  /** Native CPU profiling starts in the actual business parent and reaches its Worker via execArgv. */
  const cpuArguments =
    options.diagnostic === IpcBenchDiagnostic.cpu
      ? [IpcBenchDiagnostic.cpuFlag, `${IpcBenchDiagnostic.cpuDirectoryPrefix}${options.output}`]
      : []
  /** Child result preserves exact exit status, stderr and stdout as a reproducible raw receipt. */
  const child = spawn(process.execPath, [...cpuArguments, entry, '--side', input], {
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  /** Benchmark stdout has one final JSON line; all reports remain in the separate stderr field. */
  let stdout = ''
  /** Existing fixture reporters preserve failures here, including PROBE_FAILED from a broken probe. */
  let stderr = ''
  child.stdout.on('data', (value) => {
    stdout += value
  })
  child.stderr.on('data', (value) => {
    stderr += value
  })
  /** Native launch and exit are joined without imposing an extra business timeout or retry. */
  const status = await new Promise((resolveStatus, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolveStatus({ code, signal }))
  })
  /** Keep malformed output verbatim for diagnosis rather than discarding an unfavorable launch. */
  let receipt
  try {
    receipt = JSON.parse(stdout.trim())
  } catch (cause) {
    receipt = { status: 'ERROR', error: classifyFailure(cause), stdout }
  }
  writeFileSync(
    join(options.output, `${stem}.json`),
    JSON.stringify(
      { cell, arm: selectedArm, lane, stageMode: options.stageMode, status, stderr, receipt },
      null,
      2
    )
  )
  /** Stdio emits its existing readiness notice on stderr; every other diagnostic remains an error. */
  if (
    !readyNotice ||
    status.code !== 0 ||
    receipt.status === 'ERROR' ||
    stderr.replaceAll(readyNotice, '').trim()
  )
    throw new Error(IpcBenchErrorText.paired, { cause: { status, stderr, receipt } })
  if (selectedArm === ProbeBench.installed) {
    for (const snapshot of [receipt.parentAfter, receipt.peerAfter]) {
      if (snapshot?.probeCounters?.stageSelection?.mode !== options.stageMode)
        throw new Error(IpcBenchErrorText.configuration)
    }
    if (options.collector) {
      for (const snapshot of [receipt.parentAfter, receipt.peerAfter]) {
        if (
          !snapshot?.probeCounters?.collector ||
          snapshot.probeCounters.collector.captureMask !== 0 ||
          (lane === ProbeBench.guard &&
            snapshot.probeCounters.collectorEventCounter?.instrumented !== true)
        )
          throw new Error(IpcBenchErrorText.configuration)
      }
    }
    /**
     * The installed collector must ingest real calls; Core-only acceptance retains its
     * emitted-event proof.
     */
    const observations = countDelta(receipt)
    if (
      !(options.collector ? observations.total.collectorCalls > 0 : observations.total.events > 0)
    )
      throw new Error(IpcBenchErrorText.configuration)
    receipt.observedEvents = observations.total.events
    receipt.stageSelection = [
      receipt.parentAfter.probeCounters.stageSelection,
      receipt.peerAfter.probeCounters.stageSelection
    ]
    if (options.collector) receipt.observedCollectorCalls = observations.total.collectorCalls
  }
  if (lane === ProbeBench.guard) receipt.counterGuard = countDelta(receipt)
  return receipt
}

/**
 * Recompute the acceptance from all original rounds with same-window A/A noise, no exclusions.
 *
 * @param {object[]} rounds Each round contains baseA, baseB, absent and installed receipts.
 * @param {object} guard Separate exact-counter receipts for the three arms.
 * @param {boolean} largePayload True for the 1 MiB cell's fixed symmetric five-percent budget.
 * @param {boolean} [collector] Root collector mode selects 5%; ordinary Core acceptance remains
 *   fixed at 3%.
 * @param {object} [collectorAudit] Current source/compiled hashes covering the collector allocation
 *   site.
 * @param {string} [selectedStageMode] Explicit all-stage small cells are report-only; omitted mode
 *   retains the revision-1 fixed budgets.
 * @returns {object} Raw ratios, exact medians, noise bounds and independent verdicts.
 */
export function judgeProbe(
  rounds,
  guard,
  largePayload = false,
  collector = false,
  collectorAudit,
  selectedStageMode = IpcProbeBenchStages.legacy
) {
  /** Exact upper-median selection preserves the original even-count index and raw series. */
  const median = (values) => orderStatistic(values, Math.floor(values.length / 2))
  /** Paired A/A absolute bands are derived from this exact cell's two frozen-base launches. */
  const noise = {
    p50: Math.max(...rounds.map(({ baseA, baseB }) => Math.abs(baseB.p50Ns / baseA.p50Ns - 1))),
    throughput: Math.max(
      ...rounds.map(({ baseA, baseB }) =>
        Math.abs(baseB.throughputPerSecond / baseA.throughputPerSecond - 1)
      )
    )
  }
  /** Every ratio uses the neighboring round's own baseline instead of historical absolute timings. */
  const series = rounds.map(({ baseA, baseB, absent, installed }) => ({
    absentP50: absent.p50Ns / ((baseA.p50Ns + baseB.p50Ns) / 2) - 1,
    absentThroughput:
      absent.throughputPerSecond / ((baseA.throughputPerSecond + baseB.throughputPerSecond) / 2) -
      1,
    installedP50: installed.p50Ns / absent.p50Ns - 1,
    installedThroughput: installed.throughputPerSecond / absent.throughputPerSecond - 1
  }))
  /** The median uses all N paired observations, without selecting successful launches. */
  const deltas = Object.fromEntries(
    Object.keys(series[0]).map((key) => [key, median(series.map((row) => row[key]))])
  )
  /** Exact guard deltas are compared as totals because sample counts are identical. */
  const absent = guard.absent.counterGuard.total
  /** Probe warm-up has already registered each reusable view, so no distinct view may appear now. */
  const installed = guard.installed.counterGuard.total
  /** Both genuine installed isolates must execute the allocation hook tied to the current audit. */
  const collectorCounterPresent =
    !collector ||
    (collectorAudit !== undefined &&
      guard.installed.counterGuard.collectorEventCounter?.length === 2 &&
      guard.installed.counterGuard.collectorEventCounter.every(
        (evidence) =>
          evidence?.instrumented === true &&
          evidence.sourceSha256 === collectorAudit.ringCompiledSha256 &&
          evidence.auditSha256 === collectorAudit.sha256 &&
          typeof evidence.executedSha256 === 'string'
      ))
  /** Promise/normalization deltas must be exactly zero, not a statistical tolerance. */
  const counterGuard = {
    status:
      installed.promises === absent.promises &&
      installed.normalizePortable === absent.normalizePortable &&
      installed.eventObjects === 0 &&
      installed.events > 0 &&
      (!collector ||
        (collectorCounterPresent &&
          installed.collectorEventObjects === 0 &&
          installed.collectorEventObjects - absent.collectorEventObjects === 0))
        ? 'PASS'
        : 'FAIL',
    promisesDelta: installed.promises - absent.promises,
    nativePromisesDelta: installed.nativePromises - absent.nativePromises,
    samplerPromisesDelta: installed.samplerPromises - absent.samplerPromises,
    normalizePortableDelta: installed.normalizePortable - absent.normalizePortable,
    eventObjects: installed.eventObjects,
    events: installed.events,
    collectorCalls: installed.collectorCalls,
    collectorEventObjects: collector ? installed.collectorEventObjects : null,
    collectorEventObjectsDelta: collector
      ? installed.collectorEventObjects - absent.collectorEventObjects
      : null,
    collectorCounterPresent: collector ? collectorCounterPresent : null,
    collectorAudit: collector ? collectorAudit : null,
    allocationScope: collector
      ? 'Core view identity count plus exact audited collector event-literal count; gross VM/Map/hash/string/backing-store allocation UNVERIFIED'
      : 'Core emitted-view identities after warmup',
    observations: guard
  }
  /**
   * Root collector and Core acceptance are distinct fixed budgets; neither derives a looser limit
   * from noise.
   */
  const budget = collector ? 0.05 : 0.03
  /** Revision 2 relaxes only installed small-cell reporting when all stages are explicitly selected. */
  const reportOnly = selectedStageMode === IpcProbeBenchStages.all && !largePayload
  /** The metadata-only 1 MiB cell has a symmetric fixed five-percent budget, never report-only. */
  const installedWithinBudget = largePayload
    ? Math.abs(deltas.installedP50) <= 0.05 && Math.abs(deltas.installedThroughput) <= 0.05
    : deltas.installedP50 <= budget && deltas.installedThroughput >= -budget
  /** Every cell also retains its same-window absent/A/A condition and exact counter guards. */
  const status =
    Math.abs(deltas.absentP50) <= noise.p50 &&
    Math.abs(deltas.absentThroughput) <= noise.throughput &&
    (reportOnly || installedWithinBudget) &&
    counterGuard.status === 'PASS'
      ? 'PASS'
      : 'FAIL'
  return {
    status,
    stageMode: selectedStageMode,
    stageSelection: guard.installed.stageSelection,
    installedQualification: reportOnly
      ? IpcProbeBenchStages.reportOnly
      : IpcProbeBenchStages.fixedBudget,
    installedWithinBudget: reportOnly ? null : installedWithinBudget,
    pairs: rounds.length,
    noise,
    series,
    deltas,
    installedBudget: reportOnly
      ? null
      : largePayload
        ? {
            p50Minimum: -0.05,
            p50Maximum: 0.05,
            throughputMinimum: -0.05,
            throughputMaximum: 0.05
          }
        : { p50Maximum: budget, throughputMinimum: -budget },
    counterGuard,
    collector: collector
      ? 'ENABLED: genuine selected-stage metadata collector; guard-only same-mask Core view probe and audited collector event-literal counter'
      : 'DISABLED: Core-only acceptance'
  }
}

/**
 * Run each requested cell using interleaved base A/A, absent and installed arms, N>=5.
 *
 * @returns {Promise<void>} Formal series/verdict or separate diagnostic receipts, written before
 *   exit status.
 * @throws {Error} Invalid options or failed fixture preparation remains ERROR, not a performance
 *   FAIL.
 */
async function main() {
  /** Explicit cell selection lets the caller keep each exclusive window below its 45-minute cap. */
  /** One invocation admission phase freezes the original configuration and finite selected cells. */
  const { options, rootMode, cells } = readProbeInvocation(process.argv.slice(2))
  /** Source/audit inventory is admitted before any formal observation or launched arm. */
  const failureInventory = await admitProbeInventory(options, rootMode, cells)
  /** The exclusive runner owns admission/end-load enforcement; this receipt also records raw loads. */
  const startLoad = loadavg()
  if (options.diagnostic !== undefined) {
    /** One explicit cell keeps the whole absent/installed diagnostic pair in its caller's window. */
    const cell = cells[0]
    /** Full native profiles remain in original launch receipts, separate from formal timing. */
    const rawPaths = []
    for (const selectedArm of [ProbeBench.absent, ProbeBench.installed]) {
      /** Unique stems also separate before/after directories supplied by the caller. */
      const stem = `${cell.id}-${options.diagnostic}-${selectedArm}`
      await launch(cell, selectedArm, ProbeBench.diagnostic, options, stem)
      rawPaths.push(join(options.output, `${stem}.json`))
    }
    /** This capture receipt states scope and evidence paths without claiming an acceptance pass. */
    const summary = {
      status: IpcBenchDiagnostic.captured,
      diagnosticMode: options.diagnostic,
      timingStatus: IpcBenchDiagnostic.timingStatus,
      cell,
      collector: rootMode,
      stageMode: options.stageMode,
      runtime: process.version,
      startLoad,
      endLoad: loadavg(),
      rawPaths,
      collectorAudit: options.collectorAudit
    }
    writeFileSync(
      join(options.output, ProbeBench.diagnosticSummary),
      JSON.stringify(summary, null, 2)
    )
    console.log(JSON.stringify(summary))
    return
  }
  /** Per-cell receipts keep all failed launches and all actual loaded SHA rows. */
  const results = []
  for (const cell of cells) {
    /** Two same-base launches calibrate A/A beside each absent/installed pair. */
    const rounds = []
    for (let index = 0; index < options.pairs; index++) {
      /** Rotate adjacent arm order to avoid always giving one arm the same drift position. */
      const order =
        index % 2
          ? ['installed', 'baseB', 'absent', 'baseA']
          : ['baseA', 'absent', 'baseB', 'installed']
      /** Named receipts preserve four original launches; baseA/baseB are one frozen-base arm. */
      const round = {}
      for (const name of order)
        round[name] = await launch(
          cell,
          name.startsWith('base') ? ProbeBench.base : name,
          ProbeBench.timing,
          options,
          `${cell.id}-pair${index + 1}-${name}`
        )
      rounds.push(round)
    }
    /** Instrumented guards receive no timing credit and run all three actual runtime configurations. */
    const guard = {}
    for (const selectedArm of [ProbeBench.base, ProbeBench.absent, ProbeBench.installed])
      guard[selectedArm] = await launch(
        cell,
        selectedArm,
        ProbeBench.guard,
        options,
        `${cell.id}-guard-${selectedArm}`
      )
    /** Default stages retain fixed budgets; explicit all-stage small cells remain report-only. */
    const verdict = judgeProbe(
      rounds,
      guard,
      cell.payloadBytes === 1048576,
      rootMode,
      options.collectorAudit,
      options.stageMode
    )
    results.push({ cell, rounds, verdict })
    writeFileSync(
      join(options.output, `${cell.id}-summary.json`),
      JSON.stringify(
        {
          baseCommit: ProbeBench.sourceCommit,
          acceptance: rootMode ? ProbeBench.rootAcceptance : ProbeBench.coreAcceptance,
          stageMode: options.stageMode,
          startLoad,
          endLoad: loadavg(),
          failureInventory,
          results: [results.at(-1)]
        },
        null,
        2
      )
    )
    console.log(
      JSON.stringify({
        cell: cell.id,
        verdict: {
          ...verdict,
          counterGuard: { ...verdict.counterGuard, observations: 'raw summary JSON' }
        }
      })
    )
  }
  /** Load breaches are ERROR independently of actual latency verdicts and runner exit 75. */
  const endLoad = loadavg()
  /** Same absolute load gate as the repository exclusive runner, without replacing its enforcement. */
  const status =
    startLoad[0] > 5 || endLoad[0] > 5
      ? 'ERROR'
      : results.every((result) => result.verdict.status === 'PASS')
        ? 'PASS'
        : 'FAIL'
  writeFileSync(
    join(options.output, 'summary.json'),
    JSON.stringify(
      {
        status,
        acceptance: rootMode ? ProbeBench.rootAcceptance : ProbeBench.coreAcceptance,
        stageMode: options.stageMode,
        baseCommit: ProbeBench.sourceCommit,
        runtime: process.version,
        startLoad,
        endLoad,
        failureInventory,
        recompute: {
          module: entry,
          export: 'judgeProbe',
          arguments: 'rounds, guard, largePayload, collector, collectorAudit, stageMode',
          collector: rootMode,
          collectorAudit: options.collectorAudit,
          stageMode: options.stageMode
        },
        results
      },
      null,
      2
    )
  )
  console.log(`${rootMode ? ProbeBench.rootAcceptance : ProbeBench.coreAcceptance} ${status}`)
  if (status !== 'PASS') process.exitCode = status === 'ERROR' ? 2 : 1
}

/**
 * @param {string[]} args Original CLI. @returns {object} Original validated configuration and
 *   selected fixed cells.
 */
function readProbeInvocation(args) {
  /** Explicit root mode changes only the installed arm and its frozen acceptance label/budget. */
  const rootMode = args.includes('--collector')
  /** Read options once before starting any actual peer or measurement. */
  const value = (name, fallback) => {
    const index = args.indexOf(name)
    return index < 0 ? fallback : args[index + 1]
  }
  /** Defaults retain the original IPC fixture's 1000 requests and 100 warm-up calls. */
  const options = {
    collector: rootMode,
    /** Omitted mode preserves the original all-stage CLI; revision-2 modes must be explicit. */
    stageMode: value(IpcProbeBenchStages.option, IpcProbeBenchStages.legacy),
    /** Diagnostic selection remains absent for every formal timing and exact-counter launch. */
    diagnostic: value(ProbeBench.diagnosticOption, undefined),
    /** The current audit must match every named source and compiled file before collector runs. */
    collectorAuditPath: resolve(
      value(
        ProbeBench.collectorAuditOption,
        join(workspace, 'docs/rpc-plugin-devtools/scratch/hub/collector-source-audit.json')
      )
    ),
    pairs: Number(value('--pairs', '5')),
    samples: Number(value('--samples', '1000')),
    warmup: Number(value('--warmup', '100')),
    baseDist: resolve(
      value('--base-dist', join(workspace, 'docs/rpc-plugin-devtools/scratch/probe-core/base-dist'))
    ),
    output: resolve(
      value(
        '--output',
        join(workspace, `docs/rpc-plugin-devtools/scratch/${rootMode ? 'hub' : 'probe-core'}/bench`)
      )
    )
  }
  /** A frozen cell cannot be changed by independent carrier or payload CLI switches. */
  const cellId = value('--cell', 'all')
  /** Each selected cell's full interleaved series remains in one caller-owned exclusive window. */
  const cells = ProbeBench.cells.filter((cell) => cellId === 'all' || cell.id === cellId)
  if (
    !cells.length ||
    ![IpcProbeBenchStages.default, IpcProbeBenchStages.all, IpcProbeBenchStages.legacy].includes(
      options.stageMode
    ) ||
    !Number.isInteger(options.pairs) ||
    options.pairs < 5 ||
    !Number.isInteger(options.samples) ||
    options.samples < 1000 ||
    !Number.isInteger(options.warmup) ||
    options.warmup < 1 ||
    (options.diagnostic !== undefined &&
      (![IpcBenchDiagnostic.cpu, IpcBenchDiagnostic.sampling].includes(options.diagnostic) ||
        cells.length !== 1))
  )
    throw new Error(IpcBenchErrorText.configuration)
  return { options, rootMode, cells }
}

/**
 * @param {object} options Original admitted configuration. @param {boolean} rootMode Original
 *   collector arm. @param {object[]} cells Frozen selection. @returns {Promise<object>} Actual
 *   source-code/reason inventory before measurement.
 */
async function admitProbeInventory(options, rootMode, cells) {
  if (rootMode) {
    /** The bounded source audit names the existing six owners and their exact current emitted bytes. */
    const path = options.collectorAuditPath
    /** Keep the complete original audit receipt; its byte hash binds every installed guard snapshot. */
    const bytes = readFileSync(path)
    /** Audit evidence covers source-defined event constructors, not unknown VM storage allocation. */
    const audit = JSON.parse(bytes)
    for (const file of audit.files) {
      if (
        createHash('sha256')
          .update(readFileSync(join(workspace, file.sourcePath)))
          .digest('hex') !== file.sourceSha256 ||
        createHash('sha256')
          .update(readFileSync(join(workspace, file.compiledPath)))
          .digest('hex') !== file.compiledSha256
      )
        throw new Error(IpcBenchErrorText.configuration)
    }
    /** Only the audited ring owns a source-defined collector event-shaped object construction. */
    const ring = audit.files.find((file) => file.compiledPath === ProbeBench.collectorRingPath)
    if (ring === undefined) throw new Error(IpcBenchErrorText.configuration)
    options.collectorAudit = {
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      ringCompiledSha256: ring.compiledSha256,
      files: audit.files
    }
  }
  mkdirSync(options.output, { recursive: true })
  /** Canonical declared codes bound the native fixture's observable package classification. */
  const codeTables = {
    'rpc.endpoint': ['packages/rpc-contract/src/error-code.ts', 'RpcCoreErrorCode'],
    'rpc.contract': ['packages/rpc-contract/src/error-code.ts', 'RpcContractErrorCode'],
    'rpc.transport.process': ['packages/rpc-contract/src/error-code.ts', 'RpcProcessErrorCode'],
    'rpc.transport.thread': ['packages/rpc-contract/src/error-code.ts', 'RpcThreadErrorCode']
  }
  if (rootMode)
    codeTables['rpc.devtools'] = ['packages/rpc-contract/src/error-code.ts', 'RpcDevtoolsErrorCode']
  /** Inventory parsing reads source tables only; it never adds a production diagnostic path. */
  const observableCodes = Object.fromEntries(
    Object.entries(codeTables).map(([source, [path, name]]) => {
      /** Read only the single package-owned table, excluding other ordinal/reason constants. */
      const declaration = readFileSync(join(workspace, path), 'utf8')
        .split(`export const ${name} = {`)[1]
        ?.split('} as const')[0]
      if (!declaration) throw new Error(IpcBenchErrorText.configuration)
      return [
        source,
        Array.from(declaration.matchAll(/\b\w+: '([A-Z_0-9]+)'/gu), (match) => match[1])
      ]
    })
  )
  /** The original public reason domain avoids maintaining a parallel branch vocabulary. */
  const { RpcProviderRejectionReason } = await import('@migaia/rpc-host')
  /** Existing reporter/onRejected channels distinguish shared OVERLOADED and session/flow failures. */
  const failureInventory = {
    observableCodes,
    installedPath:
      'Existing public process/thread Peer options receive the genuine probe through their canonical forwarding owners',
    source: 'rpc.endpoint',
    sharedCode: 'OVERLOADED',
    reasons: Object.values(RpcProviderRejectionReason),
    reasonChannel:
      'existing fixture nativeProviderLimits.onRejected records the actual provider reason; other capacity sites retain missing reason as null/UNVERIFIED',
    observable:
      'all native public Peer provider/transport/reporter errors retain source, code, name, reason and redacted message',
    providerConcurrency: 'NOT_INSTRUMENTED; client lanes are reported separately',
    classification: 'original IPC receipt classification and both OOB isolate snapshots'
  }
  console.error(
    JSON.stringify({
      type: 'probe-bench-inventory',
      cells,
      options,
      failureInventory,
      acceptance: rootMode ? ProbeBench.rootAcceptance : ProbeBench.coreAcceptance,
      collector: rootMode
        ? 'ENABLED: selected-stage metadata, captureMask=0'
        : 'DISABLED: Core-only acceptance'
    })
  )
  return failureInventory
}

if (process.argv[1] === entry) {
  if (process.argv[2] === '--side') {
    /** The unchanged IPC runner owns warm-up, bounded lanes, raw samples and native cleanup. */
    const { runIpcSide } = await import('./ipc-side.mjs')
    /** Side input fixes the same actual carrier, payload and concurrency for every arm. */
    const input = JSON.parse(process.argv[3])
    try {
      /** Formal timing retains its full original receipt; guard snapshots are separate launches. */
      const receipt = await runIpcSide(input.cell, 'rpc', {
        samples: input.samples,
        warmup: input.warmup,
        diagnostic: input.diagnostic
      })
      console.log(JSON.stringify(receipt))
    } catch (error) {
      console.log(
        JSON.stringify({
          status: 'ERROR',
          error: classifyFailure(error),
          counters: counterSnapshot()
        })
      )
      process.exitCode = 2
    }
    stopPromises?.()
  } else {
    try {
      await main()
    } catch (error) {
      console.error(JSON.stringify({ status: 'ERROR', error: classifyFailure(error) }))
      process.exitCode = 2
    }
  }
}
