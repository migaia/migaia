/**
 * Measures the public collector using one reusable metadata view and a warmed bounded ring. Run on
 * Node 24 with --expose-gc inside the repository's shared measurement window. Heap samples measure
 * retained memory, not all transient allocations; source evidence is saved separately, and a
 * missing source audit must not be presented as a zero-allocation proof.
 */
import { createHook } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { cpus, freemem, hostname, loadavg, platform, release, totalmem } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { createRpcDevtools } from '../dist/collector/devtools.js'
import { orderStringKeys } from '@migaia/utils/string'
import {
  RpcProbeStage,
  RpcProbeDirection,
  RpcProbeKind,
  RpcProbeOutcome
} from '@migaia/rpc-host/probe'

/** 's fixed count is also the minimum meaningful retained-heap sample span. */
const eventsPerCell = 10_000_000
/** Warm both name lookup, message-id reuse and the per-method statistics slot. */
const warmupEvents = 1_000_000
/** Repeated identical cells quantify same-window A/A noise without changing the configuration. */
const repeats = 3
/** Small capacity forces O(1) eviction during almost the entire measured interval. */
const maxEvents = 1_024
/** One million events separates GC samples; GC time is excluded from ingestion throughput. */
const sampleStride = 1_000_000
/** The threshold remains the leaf's fixed machine-dependent acceptance target. */
const targetEventsPerSecond = 5_000_000
/** Small fixed tolerance covers sampling records and VM bookkeeping without allowing linear growth. */
const retainedHeapToleranceBytes = 262_144
/** CLI output defaults to this checkout's ignored evidence directory. */
const outputIndex = process.argv.indexOf('--output')
/** Evidence writes remain local; callers can select another worktree-local raw JSON filename. */
const outputPath = resolve(
  outputIndex === -1
    ? fileURLToPath(
        new URL('../../../docs/rpc-plugin-devtools/scratch/collector/ingest.json', import.meta.url)
      )
    : process.argv[outputIndex + 1]
)
/** Hash every built collector file, including its public entry, for reproducible source attribution. */
const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
/** Configuration errors are benchmark failures; no business event is emitted on an invalid host. */
const configurationFailures = []
if (Number(process.versions.node.split('.')[0]) !== 24)
  configurationFailures.push('Node 24 is required by the ingest benchmark')
if (typeof globalThis.gc !== 'function')
  configurationFailures.push('--expose-gc is required by the ingest benchmark')

/**
 * Read built JavaScript deterministically without running a second code path.
 *
 * @param {string} directory Built directory beneath this package.
 * @returns {{ path: string; source: string }[]} UTF-16 ordered source inputs for the dist
 *   hash/audit.
 */
function builtSources(directory) {
  /** One physical traversal produces unique complete paths without recopying descendant arrays. */
  const files = new Map()
  collectBuiltSources(directory, files)
  /** Artifact hash manifests now use stable UTF-16 order instead of locale-dependent collation. */
  return orderStringKeys([...files.keys()]).map((path) => files.get(path))
}

/**
 * Capture every built JS file once in the original package-owned source inventory.
 *
 * @param {string} directory Current physical directory beneath this package.
 * @param {Map<string, { path: string; source: string }>} files Unique original filesystem paths.
 * @returns {void} Declarations and source maps remain excluded as before.
 */
function collectBuiltSources(directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    /** Each child remains beneath the package dist owner. */
    const path = join(directory, entry.name)
    if (entry.isDirectory()) collectBuiltSources(path, files)
    else if (entry.name.endsWith('.js'))
      files.set(path, { path, source: readFileSync(path, 'utf8') })
  }
}

/** Ordered exact executable bytes identify this benchmark's artifact, rather than source HEAD. */
const sources = builtSources(join(packageDirectory, 'dist'))
/** Dist SHA includes relative file names to distinguish moved or omitted executable modules. */
const hash = createHash('sha256')
for (const source of sources) {
  hash.update(source.path.slice(packageDirectory.length))
  hash.update('\0')
  hash.update(source.source)
}
/** These source references need review if normalization enters the collector owner. */
const collectorSources = sources.filter((source) => source.path.includes('/dist/collector/'))
/** Cold query/record conversion may call codecs; hot metadata source must not normalize payloads. */
const normalizationReferences = collectorSources.filter((source) =>
  /\bnormalizePortable\b/.test(source.source)
)
if (process.argv.includes('--dist-sha')) {
  console.log(hash.copy().digest('hex'))
  process.exit(0)
}

/** No event body is copied here; all measured events update one already allocated input object. */
const view = {
  seq: 0,
  at: 0,
  endpointId: 'bench-client',
  stage: RpcProbeStage.message,
  direction: RpcProbeDirection.outbound,
  kind: RpcProbeKind.request,
  outcome: RpcProbeOutcome.settled,
  messageId: 'bench-message',
  method: 'bench.method',
  senderId: 'bench-client',
  targetId: 'bench-provider',
  receiverId: undefined,
  peerId: 'bench-provider',
  trace: 'bench-trace',
  sizeBytes: -1,
  chunkIndex: -1,
  chunkCount: -1,
  members: -1,
  durationMs: 2,
  rejection: undefined,
  lifecycle: undefined,
  error: undefined,
  carrier: 'memory',
  detail: undefined,
  content: undefined
}
/** All reports are cold-path records, retaining the full classification exposed by the owner. */
const failures = []
/** Promise init events are counted only while metadata ingestion is running. */
let countedPromises = 0
/** The hook callback creates no promises and never participates in the measured RPC flow. */
const promiseHook = createHook({
  init(_asyncId, type) {
    if (type === 'PROMISE') countedPromises += 1
  }
})
/** Raw cells carry timing and every post-GC sample, including the baseline. */
const cells = []

/**
 * Record a collector report without exposing fixture messages or swallowing a reported error.
 *
 * @param {unknown} error Original reported failure.
 * @returns {void} The benchmark report owns classification; ingestion remains synchronous.
 */
function report(error) {
  /** Public identity is recorded when present; unknown fields remain explicitly unknown. */
  const identity = error && typeof error === 'object' ? error : undefined
  failures.push({
    source: identity?.source ?? null,
    code: identity?.code ?? null,
    name: identity?.name ?? typeof error,
    reason: identity?.reason ?? null,
    message: '[benchmark failure message redacted]'
  })
}

if (configurationFailures.length === 0) {
  /** No capture, recording or watcher is active; this is precisely metadata ingestion. */
  const devtools = createRpcDevtools({ stages: ['message'], maxEvents, onError: report })
  try {
    for (let index = 0; index < warmupEvents; index += 1) {
      view.seq += 1
      view.at = view.seq
      devtools.emit(view)
    }
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      /** Collections happen outside the stopwatch and the Promise hook. */
      const heapSamples = []
      globalThis.gc()
      heapSamples.push({ events: 0, heapUsed: process.memoryUsage().heapUsed })
      /** Sum the ingestion chunks, excluding GC and evidence materialization. */
      let elapsedMs = 0
      /** Exact hook baseline prevents warm-up or output promises entering the counter. */
      const promiseStart = countedPromises
      for (let offset = 0; offset < eventsPerCell; offset += sampleStride) {
        promiseHook.enable()
        /** Only scalar view updates and public emit belong to the measured cell. */
        const started = performance.now()
        for (let index = 0; index < sampleStride; index += 1) {
          view.seq += 1
          view.at = view.seq
          devtools.emit(view)
        }
        elapsedMs += performance.now() - started
        promiseHook.disable()
        globalThis.gc()
        heapSamples.push({
          events: offset + sampleStride,
          heapUsed: process.memoryUsage().heapUsed
        })
      }
      /** Query materialization is outside both timing and Promise measurement. */
      const page = devtools.query({ limit: 1 })
      /** Statistics provide an independent count of accepted settled views. */
      const stats = devtools.stats()
      cells.push({
        cell: `metadata-AA-${repeat + 1}`,
        events: eventsPerCell,
        elapsedMs,
        eventsPerSecond: (eventsPerCell * 1_000) / elapsedMs,
        promiseDelta: countedPromises - promiseStart,
        fixtureEventObjectDelta: 0,
        heapSamples,
        retainedBytesPerEvent:
          (heapSamples.at(-1).heapUsed - heapSamples[0].heapUsed) / eventsPerCell,
        sampledQueryRows: page.events.length,
        counters: page.counters,
        calls: stats.methods[0]?.calls ?? 0,
        expectedCalls: warmupEvents + (repeat + 1) * eventsPerCell,
        expectedEvicted: warmupEvents + (repeat + 1) * eventsPerCell - maxEvents
      })
    }
  } finally {
    promiseHook.disable()
    devtools.close()
  }
}

/**
 * Sorted A/A cells report their median and worst throughput. The sole cells.push is inside the
 * repeat < repeats loop above, and repeats is the compile-time constant 3, so this sort has at most
 * three entries. It is not a sort over the dynamically growing measured events or samples.
 */
const rates = cells.map((cell) => cell.eventsPerSecond).sort((left, right) => left - right)
/** Source audit is external evidence, not a fabricated dynamic allocation counter. */
const staticAuditPath = process.env.RPC_DEVTOOLS_INGEST_AUDIT
/** The audit must identify the same dist SHA and declare metadata-path counts after source review. */
const staticAudit = staticAuditPath ? JSON.parse(readFileSync(staticAuditPath, 'utf8')) : null
/** GC samples include fixed fixture/VM bookkeeping, never interpreted as gross allocation counts. */
const retainedHeapFlat = cells.every(
  (cell) =>
    Math.abs(cell.heapSamples.at(-1).heapUsed - cell.heapSamples[0].heapUsed) <=
    retainedHeapToleranceBytes
)
/** Source audit assertions only apply when their exact executable artifact matches. */
const distSha = hash.digest('hex')
/** A missing source audit leaves zero-allocation acceptance unverified. */
const sourceAuditPass =
  staticAudit?.distSha === distSha &&
  staticAudit?.metadataEventObjectsPerEvent === 0 &&
  staticAudit?.metadataNormalizePortableCallsPerEvent === 0 &&
  typeof staticAudit?.evidence === 'string' &&
  staticAudit.evidence.length > 0
/** No target relaxation: all three measured cells must reach the fixed ingest minimum. */
const pass =
  configurationFailures.length === 0 &&
  failures.length === 0 &&
  cells.length === repeats &&
  rates[0] >= targetEventsPerSecond &&
  cells.every((cell) => cell.promiseDelta === 0) &&
  cells.every(
    (cell) => cell.calls === cell.expectedCalls && cell.counters.evicted === cell.expectedEvicted
  ) &&
  retainedHeapFlat &&
  sourceAuditPass
/** Raw JSON is the authoritative result; stdout adds only the explicit oracle marker. */
const result = {
  acceptance: 'ingest',
  pass,
  date: new Date().toISOString(),
  machine: {
    hostname: hostname(),
    platform: platform(),
    release: release(),
    arch: process.arch,
    cpu: cpus()[0]?.model ?? null,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
    freeMemoryBytes: freemem(),
    loadAverage: loadavg()
  },
  node: process.version,
  execArgv: process.execArgv,
  distSha,
  configuration: {
    eventsPerCell,
    warmupEvents,
    repeats,
    maxEvents,
    sampleStride,
    targetEventsPerSecond,
    retainedHeapToleranceBytes
  },
  observability: {
    observableCodes: ['REDACT_FAILED'],
    sharedCodeBranches: { REDACT_FAILED: ['redact callback failure'] },
    explanation:
      'Metadata-only input has no content/redact branch; any collector report is a failure.'
  },
  configurationFailures,
  failures,
  cells,
  sameWindowAA: {
    minEventsPerSecond: rates[0] ?? null,
    medianEventsPerSecond: rates[1] ?? null,
    maxEventsPerSecond: rates.at(-1) ?? null,
    rangePercentOfMedian: rates.length ? ((rates.at(-1) - rates[0]) / rates[1]) * 100 : null
  },
  counters: {
    promisesPerEvent: cells.length
      ? cells.reduce((sum, cell) => sum + cell.promiseDelta, 0) / (repeats * eventsPerCell)
      : null,
    fixtureEventObjectsPerEvent: 0,
    metadataEventObjectsPerEvent: sourceAuditPass ? 0 : null,
    metadataNormalizePortableCallsPerEvent: sourceAuditPass ? 0 : null,
    normalizationSourceReferences: normalizationReferences.map((source) => source.path),
    sourceAudit: staticAudit,
    sourceAuditPass,
    retainedHeapFlat,
    retentionEvidence:
      'sampledQueryRows is the row count of query({ limit: 1 }), not ring occupancy. In this all-settled metadata fixture, cumulative calls minus evicted proves the main ring retains maxEvents (1,024) after each cell; both counters are checked against their exact expected counts.',
    limitation:
      'Post-GC heapUsed measures retained heap only. Zero gross allocation is not inferred from flat heap; collector event-object and normalization counts require the matching source audit. Promise counts use async_hooks.'
  }
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(
  JSON.stringify({
    acceptance: 'ingest',
    pass,
    outputPath,
    distSha,
    sameWindowAA: result.sameWindowAA
  })
)
console.log(pass ? 'ingest PASS' : 'ingest FAIL')
if (!pass) process.exitCode = 1
