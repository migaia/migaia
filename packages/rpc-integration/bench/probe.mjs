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

/** One canonical fixture vocabulary keeps the four acceptance cells and arms unchanged. */
const ProbeBench = {
  base: 'base',
  absent: 'absent',
  installed: 'installed',
  guard: 'guard',
  timing: 'timing',
  collectorEnabled: '1',
  coreAcceptance: 'A5',
  rootAcceptance: 'A-perf',
  collectorRingPath: 'packages/rpc-devtools/dist/collector/ring.js',
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
const corePrefix = pathToFileURL(join(workspace, 'packages/rpc-core/dist/')).href
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
/** Root timing installs the genuine collector with default metadata stages and capture disabled. */
const collectorMode = process.env.PROBE_BENCH_COLLECTOR === ProbeBench.collectorEnabled
/**
 * The frozen collector host remains the installed identity; only cold snapshots call its API.
 *
 * @type {import('@migaia/rpc-devtools').IRpcDevtools | undefined}
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
  // SC9(b): an OOB diagnostic receipt converts local counters to a wire representation.
  return {
    ...counters,
    loaded: loaded.slice(),
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
          "inherit: ['PATH', 'NODE_OPTIONS', 'PROBE_BENCH_ARM', 'PROBE_BENCH_LANE', 'PROBE_BENCH_BASE_DIST', 'PROBE_BENCH_COLLECTOR', 'PROBE_BENCH_COLLECTOR_RING_SHA', 'PROBE_BENCH_COLLECTOR_AUDIT_SHA']"
        )
      }
      if (
        url.endsWith('/rpc-core/dist/remote/runtime-api/peer.js') &&
        arm === ProbeBench.installed
      ) {
        /**
         * Carrier managed sources currently omit probe when reconstructing options (D4/A7 gap). A5
         * and root A-perf install at the actual Core constructor/preparation, preserving this exact
         * options identity and its private preparation context. Managed construction prepares the
         * endpoint before creating its facade, so both entries need the same genuine handle. This
         * diagnostic changes only loaded source; it never edits the closed carrier write sets.
         */
        const pattern =
          /(export async function (?:createRuntimePeer|prepareRuntimePeerEndpoint)\(options,[\s\S]*?\)\s*\{)/gu
        if (Array.from(source.matchAll(pattern)).length !== 2)
          throw new Error(IpcBenchErrorText.configuration)
        source = source.replace(
          pattern,
          '$1 if (options.probe === undefined) options.probe = globalThis.__PROBE_BENCH_PROBE;'
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
      // SC9(b): the Node loader boundary needs a result carrying the selected source representation.
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
    const { defineProbe, RpcProbeStageName } = await import('@migaia/rpc-core/probe')
    /** Cold reporting preserves full native failure classification in both measured modes. */
    const onError = (error) => {
      console.error(JSON.stringify(classifyFailure(error)))
    }
    if (collectorMode) {
      /** No host copy, wrapper or post-definition emit replacement changes its compiled identity. */
      const { createRpcDevtools } = await import('@migaia/rpc-devtools')
      collector = createRpcDevtools({ onError })
      if (collector.captureMask !== 0) throw new Error(IpcBenchErrorText.configuration)
      globalThis.__PROBE_BENCH_PROBE = collector
    }
    /** Root timing has only the genuine collector; the separate counting probe is guard-only. */
    if (!collectorMode || guarding) {
      /** Build stage membership once, never enabling a stage absent from the actual collector. */
      const stages = []
      for (let index = 0; index < RpcProbeStageName.length; index++) {
        if (collector === undefined || (collector.stageMask & (1 << index)) !== 0)
          stages.push(RpcProbeStageName[index])
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
 * @param {string} selectedArm Base, absent or installed Core probe/genuine default collector.
 * @param {string} lane Formal timing or separate exact counter guard.
 * @param {object} options Samples, warm-up, base dist and raw output folder.
 * @param {string} stem Unique receipt name preserving every interleaved launch.
 * @returns {Promise<object>} Full IPC side receipt, with guard counts when selected.
 * @throws {Error} Child failure remains classified and retained before propagation.
 */
async function launch(cell, selectedArm, lane, options, stem) {
  /** SC9(b): process launch projects inherited environment into the actual native boundary. */
  const env = {
    ...process.env,
    PROBE_BENCH_ARM: selectedArm,
    PROBE_BENCH_LANE: lane,
    PROBE_BENCH_BASE_DIST: options.baseDist,
    PROBE_BENCH_COLLECTOR: options.collector ? ProbeBench.collectorEnabled : '0',
    PROBE_BENCH_COLLECTOR_RING_SHA: options.collectorAudit?.ringCompiledSha256 ?? '',
    PROBE_BENCH_COLLECTOR_AUDIT_SHA: options.collectorAudit?.sha256 ?? '',
    IPC_BENCH_STEM: join(options.output, stem),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(entry).href}`
  }
  /** One JSON argument carries only public fixture data; no authentication is exposed. */
  const input = JSON.stringify({ cell, samples: options.samples, warmup: options.warmup })
  /** Child result preserves exact exit status, stderr and stdout as a reproducible raw receipt. */
  const child = spawn(process.execPath, [entry, '--side', input], {
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
    JSON.stringify({ cell, arm: selectedArm, lane, status, stderr, receipt }, null, 2)
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
    /** The installed collector must ingest real calls; Core-only A5 retains its emitted-event proof. */
    const observations = countDelta(receipt)
    if (
      !(options.collector ? observations.total.collectorCalls > 0 : observations.total.events > 0)
    )
      throw new Error(IpcBenchErrorText.configuration)
    receipt.observedEvents = observations.total.events
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
 * @param {boolean} reportOnly True only for the 1 MiB cell.
 * @param {boolean} [collector] Root D2 mode selects 5%; ordinary Core A5 remains fixed at 3%.
 * @param {object} [collectorAudit] Current source/compiled hashes covering the collector allocation
 *   site.
 * @returns {object} Raw ratios, exact medians, noise bounds and independent verdicts.
 */
export function judgeProbe(rounds, guard, reportOnly = false, collector = false, collectorAudit) {
  /** SC9(b): analysis restores sorted scalar report data without changing the original raw series. */
  const median = (values) => {
    const sorted = values.toSorted((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
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
  /** Root D2 and Core A5 are distinct fixed budgets; neither derives a looser limit from noise. */
  const budget = collector ? 0.05 : 0.03
  /**
   * The large cell still must meet absent/A/A and counter guards; only its installed timing
   * reports.
   */
  const status =
    Math.abs(deltas.absentP50) <= noise.p50 &&
    Math.abs(deltas.absentThroughput) <= noise.throughput &&
    (reportOnly || (deltas.installedP50 <= budget && deltas.installedThroughput >= -budget)) &&
    counterGuard.status === 'PASS'
      ? 'PASS'
      : 'FAIL'
  return {
    status,
    pairs: rounds.length,
    noise,
    series,
    deltas,
    installedBudget: reportOnly
      ? 'REPORT_ONLY'
      : { p50Maximum: budget, throughputMinimum: -budget },
    counterGuard,
    collector: collector
      ? 'ENABLED: genuine default metadata collector; guard-only same-mask Core view probe and audited collector event-literal counter'
      : 'DISABLED: Core-only A5'
  }
}

/**
 * Run each requested cell using interleaved base A/A, absent and installed arms, N>=5.
 *
 * @returns {Promise<void>} Raw series and recomputable A5/A-perf verdict written before exit
 *   status.
 * @throws {Error} Invalid options or failed fixture preparation remains ERROR, not a performance
 *   FAIL.
 */
async function main() {
  /** Explicit cell selection lets the caller keep each exclusive window below its 45-minute cap. */
  const args = process.argv.slice(2)
  /** Explicit root mode changes only the installed arm and its frozen D2 acceptance label/budget. */
  const rootMode = args.includes('--collector')
  /** Read options once before starting any actual peer or measurement. */
  const value = (name, fallback) => {
    const index = args.indexOf(name)
    return index < 0 ? fallback : args[index + 1]
  }
  /** Defaults retain the original IPC fixture's 1000 requests and 100 warm-up calls. */
  const options = {
    collector: rootMode,
    pairs: Number(value('--pairs', '5')),
    samples: Number(value('--samples', '1000')),
    warmup: Number(value('--warmup', '100')),
    baseDist: resolve(
      value('--base-dist', join(workspace, 'docs/rpc-devtools/scratch/probe-core/base-dist'))
    ),
    output: resolve(
      value(
        '--output',
        join(workspace, `docs/rpc-devtools/scratch/${rootMode ? 'hub' : 'probe-core'}/bench`)
      )
    )
  }
  /** A frozen cell cannot be changed by independent carrier or payload CLI switches. */
  const cellId = value('--cell', 'all')
  /** Each selected cell's full interleaved series remains in one caller-owned exclusive window. */
  const cells = ProbeBench.cells.filter((cell) => cellId === 'all' || cell.id === cellId)
  if (
    !cells.length ||
    !Number.isInteger(options.pairs) ||
    options.pairs < 5 ||
    !Number.isInteger(options.samples) ||
    options.samples < 1000 ||
    !Number.isInteger(options.warmup) ||
    options.warmup < 1
  )
    throw new Error(IpcBenchErrorText.configuration)
  if (rootMode) {
    /** The bounded source audit names the existing six owners and their exact current emitted bytes. */
    const path = join(workspace, 'docs/rpc-devtools/scratch/hub/collector-source-audit.json')
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
    '@migaia/rpc/core': ['packages/rpc-core/src/core/error-code.ts', 'RpcCoreErrorCode'],
    '@migaia/rpc/contract': [
      'packages/rpc-contract/src/contract/error-code.ts',
      'RpcContractErrorCode'
    ],
    '@migaia/rpc/process': ['packages/rpc-process/src/error-code.ts', 'RpcProcessErrorCode'],
    '@migaia/rpc/threads': ['packages/rpc-threads/src/error-code.ts', 'RpcThreadErrorCode']
  }
  if (rootMode)
    codeTables['@migaia/rpc/devtools'] = [
      'packages/rpc-devtools/src/error-code.ts',
      'RpcDevtoolsErrorCode'
    ]
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
  const { RpcProviderRejectionReason } = await import('@migaia/rpc-core')
  /** Existing reporter/onRejected channels distinguish shared OVERLOADED and session/flow failures. */
  const failureInventory = {
    observableCodes,
    installedPath:
      'Core constructor/preparation diagnostic; this fixture does not prove public carrier Peer forwarding (D4/A7)',
    source: '@migaia/rpc/core',
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
      collector: rootMode ? 'ENABLED: default metadata, captureMask=0' : 'DISABLED: Core-only A5'
    })
  )
  /** The exclusive runner owns admission/end-load enforcement; this receipt also records raw loads. */
  const startLoad = loadavg()
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
    /** Large payload reports its installed timing; all other acceptance rules remain binding. */
    const verdict = judgeProbe(
      rounds,
      guard,
      cell.payloadBytes === 1048576,
      rootMode,
      options.collectorAudit
    )
    results.push({ cell, rounds, verdict })
    writeFileSync(
      join(options.output, `${cell.id}-summary.json`),
      JSON.stringify(
        {
          baseCommit: ProbeBench.sourceCommit,
          acceptance: rootMode ? ProbeBench.rootAcceptance : ProbeBench.coreAcceptance,
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
        baseCommit: ProbeBench.sourceCommit,
        runtime: process.version,
        startLoad,
        endLoad,
        failureInventory,
        recompute: {
          module: entry,
          export: 'judgeProbe',
          arguments: 'rounds, guard, reportOnly, collector, collectorAudit',
          collector: rootMode,
          collectorAudit: options.collectorAudit
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
        warmup: input.warmup
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
