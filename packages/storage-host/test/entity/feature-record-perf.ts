import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import { relative, resolve } from 'node:path'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { Session } from 'node:inspector/promises'

/** All variants use a fixed data set so write samples never grow their unique scan input. */
const ROW_COUNT = 32
/** Five rounds are the user minimum; keep the exact same work in every variant. */
const ROUNDS = 5
/** Fixed construction/query work amortizes scheduling jitter without adaptive sample tuning. */
const ITERATIONS = { construction: 1_000_000, query: 1_500, indexedWrite: 200 } as const
/** Every variant warms the same public paths before any measured round or profile capture. */
const WARMUP = { construction: 500_000, query: 1_500, indexedWrite: 20 } as const
/** A compile-time 64-slot ring keeps construction observable without retaining whole sample graphs. */
const SINK_SLOTS = 64
/** Construction and query controls must meet the same user-stated limit before B is judged. */
const MAX_CONTROL_NOISE = 0.05
/** One complete gate always visits these metrics in this fixed order. */
const METRICS = ['construction', 'query', 'indexedWrite'] as const
/** One round always runs the two baseline controls before the changed variant. */
const VARIANTS = ['A', 'A2', 'B'] as const
/** Each authorized profile uses the same fixed CPU/allocation settings and 50-second bound. */
const PROFILE = {
  limitMs: 50_000,
  cpuIntervalUs: 1_000,
  allocationInterval: 32_768
} as const
/** Fixed workload batches bound profile deadline-check overhead without changing gate loops. */
const PROFILE_BATCH = { construction: 1_000, query: 10 } as const
/** Only the explicitly authorized construction and query workloads have a profile route. */
type IProfileWorkload = keyof typeof PROFILE_BATCH
/** A row exercises equality query selection and the canonical unique-index write path. */
type IRow = { id: string; group: string; email: string }
/** Runtime imports deliberately compare two built package graphs without source aliases. */
type IModules = Record<string, any>
/** One sample measures nanoseconds per public operation. */
type ISample = Partial<Record<keyof typeof ITERATIONS, number>>
/** A sample's operation count and total clock time allow independent recomputation. */
type ITiming = Readonly<{
  iterations: number
  startMs: number
  endMs: number
  elapsedNs: number
  nsPerOperation: number
  observedSinkSlots: number
}>
/** Each raw sample records the same forced collection immediately before its timer starts. */
type IGcSample = Readonly<{
  count: 1
  durationNs: number
  heapBeforeBytes: number
  heapAfterBytes: number
}>
/** Raw metric evidence is append-only; partial or noisy rounds are never discarded. */
type IRawSample = ITiming &
  Readonly<{
    metric: keyof typeof ITERATIONS
    round: number
    variant: (typeof VARIANTS)[number]
    gcBefore: IGcSample
  }>
/** A noisy construction/query control is invalid, rather than a passing or failing B metric. */
type IMetricResult = Readonly<{
  medianBA: number | null
  maxControlDeviation: number
  controlDeviationPerRound: readonly number[]
  threshold: number
  valid: boolean
  pass: boolean | null
  ratios: readonly number[]
  controls: readonly number[]
}>
/** Every file in each measured dist tree is hashed, including the imported runtime chunks. */
type IDistProvenance = Readonly<{
  directory: string
  fileCount: number
  bytes: number
  sha256ByRelativePath: Readonly<Record<string, string>>
}>
/** Profile evidence reports completed fixed batches and never supplies a timing-gate verdict. */
type IProfileRun = {
  startMs: number
  endMs: number
  completedOperations: number
  observedSinkSlots: number
}
/** Raw inspector outputs are saved unchanged and bound to their own byte hashes. */
type IProfileArtifact = Readonly<{ path: string; bytes: number; sha256: string }>
/** Failure fields distinguish business rejection from timing and redact arbitrary payloads. */
function failureFields(error: unknown): object {
  return {
    source: error instanceof Error ? (Reflect.get(error, 'source') ?? null) : null,
    code: error instanceof Error ? (Reflect.get(error, 'code') ?? null) : null,
    name: error instanceof Error ? error.name : typeof error,
    reason: error instanceof Error ? (Reflect.get(error, 'reason') ?? null) : null,
    message:
      error instanceof Error
        ? error.message.replace(
            /(?:token|password|secret|authorization)\s*[:=]\s*\S+/gi,
            '<REDACTED>'
          )
        : '<non-error redacted>'
  }
}
/** Timing excludes optional diagnostics equally for all package variants. */
function ignoreDiagnostic(): void {}

/** Produce the same records for all variants and update existing identities only. */
function rowAt(index: number): IRow {
  return { id: String(index % ROW_COUNT), group: `g${index % 4}`, email: `e${index % ROW_COUNT}` }
}
/** Fixed five-element median has a compile-time bound, independent of repository input. */
function median(values: readonly number[]): number {
  assert.equal(values.length, ROUNDS)
  return [...values].sort((left, right) => left - right)[2]!
}
/** Each variant owns its backend host; repositories merely borrow that backend. */
class EntityPerfVariant {
  /** Exact built module graph retains one package identity per variant. */
  readonly #modules: IModules
  /**
   * The declaration is installed once on the changed route; the baseline retains its old
   * declaration.
   */
  readonly #entityPlugin: any
  /** The old baseline and changed route use the same workload with their own public access entry. */
  readonly #installedRoute: boolean
  /** Captured public repository entry avoids timing host property lookup or declaration parsing. */
  #obtainRepository: ((store: any) => any) | undefined
  /** One entity installation cost is reported separately from per-repository construction. */
  #installationCostNs = 0
  /** One genuine native host owns the bounded data universe for this variant. */
  #host: any
  /** The original published memory backend is borrowed by all construction samples. */
  #store: any
  /** Query and write samples reuse one connected repository. */
  #repository: any
  /** Only 64 recent public APIs survive each construction batch and are observed outside timing. */
  readonly #constructionSink: any[] = Array.from({ length: SINK_SLOTS })
  /** Choose only the public container shape that belongs to this built version. */
  constructor(modules: IModules, installedRoute: boolean) {
    this.#modules = modules
    this.#installedRoute = installedRoute
    /** Exact factory identities remain within their own package instance. */
    const units = [
      modules.query.entityQueryFeature(),
      modules.indexes.entityIndexesFeature(),
      modules.unique.entityUniqueFeature()
    ]
    /** Both versions use identical namespace, schema, data and index declarations. */
    const options = {
      name: 'entity-feature-perf',
      onDiagnostic: ignoreDiagnostic,
      key: 'id',
      features: installedRoute
        ? { lookup: units[0], selectors: units[1], constraints: units[2] }
        : units,
      indexes: { group: { path: 'group' }, email: { path: 'email', unique: true } }
    }
    this.#entityPlugin = installedRoute
      ? modules.entity.defineEntityPlugin()('entity-feature-perf', options)
      : modules.entity.defineEntity()(options)
  }
  /** Load only built entries; no module import or backend startup is inside the timing window. */
  static async load(directory: string, installedRoute: boolean): Promise<EntityPerfVariant> {
    /** A module table is explicit state rather than a closure-based fixture owner. */
    const modules: IModules = {}
    for (const [key, path] of Object.entries({
      host: 'index.js',
      memory: 'plugins/memory.js',
      entity: 'entity.js',
      query: 'entity/query.js',
      indexes: 'entity/indexes.js',
      unique: 'entity/unique.js'
    })) {
      modules[key] = await import(pathToFileURL(resolve(directory, path)).href)
    }
    /** The variant is the sole owner of its host and timing state. */
    const variant = new EntityPerfVariant(modules, installedRoute)
    return variant
  }
  /** Seed real public storage and warm all paths before any measurement. */
  async prepare(): Promise<void> {
    this.#host = await this.#modules.host.createStorageHost({
      plugins: [this.#modules.memory.memoryBackendPlugin()]
    })
    this.#store = this.#host.backend('memory')
    if (this.#installedRoute) {
      /** The existing host installs the entity once; this work is outside every sample loop. */
      const start = performance.now()
      await this.#host.use(this.#entityPlugin)
      this.#installationCostNs = (performance.now() - start) * 1e6
      this.#obtainRepository = this.#host.extensions[this.#entityPlugin.id]
    } else this.#obtainRepository = this.#entityPlugin.connect
    this.#repository = this.#obtainRepository!(this.#store)
    for (let index = 0; index < ROW_COUNT; index++) await this.#repository.put(rowAt(index))
    this.#construct(WARMUP.construction)
    this.#observeConstructionSink()
    await this.#query(WARMUP.query)
    await this.#indexedWrite(WARMUP.indexedWrite)
  }
  /** Construct a fixed batch on the captured public entry; callers choose only fixed harness counts. */
  #construct(iterations: number): void {
    // The ring bound is the compile-time SINK_SLOTS constant, independent of measured batch size.
    for (let index = 0; index < iterations; index++)
      this.#constructionSink[index % SINK_SLOTS] = this.#obtainRepository!(this.#store)
  }
  /** Release bounded repository observations before the next sample's forced collection. */
  clearConstructionSink(): void {
    this.#constructionSink.fill(undefined)
  }
  /** Reuse the construction owner in fixed batches; deadline checks affect profiling only. */
  profileConstruction(run: IProfileRun): void {
    while (run.completedOperations < ITERATIONS.construction) {
      if (performance.now() - run.startMs >= PROFILE.limitMs) break
      this.#construct(PROFILE_BATCH.construction)
      run.completedOperations += PROFILE_BATCH.construction
    }
    run.endMs = performance.now()
    if (run.completedOperations !== 0) {
      this.#observeConstructionSink()
      run.observedSinkSlots = SINK_SLOTS
    }
  }
  /** Observe every retained API outside the timed interval so construction cannot be dead work. */
  #observeConstructionSink(): void {
    // Exactly SINK_SLOTS APIs are inspected after each fixed construction batch.
    for (const repository of this.#constructionSink) assert.equal(typeof repository.get, 'function')
  }
  /** Materialize the same eight selected records from the fixed 32-row universe. */
  async #query(iterations: number): Promise<void> {
    for (let index = 0; index < iterations; index++)
      assert.equal((await this.#repository.query().where('group', 'eq', 'g1').all()).length, 8)
  }
  /** Capture only the existing query workload; fixed ten-query batches enforce the profile bound. */
  async profileQuery(run: IProfileRun): Promise<void> {
    while (run.completedOperations < ITERATIONS.query) {
      if (performance.now() - run.startMs >= PROFILE.limitMs) break
      await this.#query(PROFILE_BATCH.query)
      run.completedOperations += PROFILE_BATCH.query
    }
    run.endMs = performance.now()
  }
  /** Overwrite fixed identities so indexed-write samples never grow their unique scan input. */
  async #indexedWrite(iterations: number): Promise<void> {
    for (let index = 0; index < iterations; index++) await this.#repository.put(rowAt(index))
  }
  /** Measure exactly one named public operation loop after its caller has applied the GC policy. */
  async sample(metric: keyof typeof ITERATIONS): Promise<ITiming> {
    /** Each metric uses a fixed operation count, equal across A, A2 and B. */
    const iterations = ITERATIONS[metric]
    /** The clock excludes forced GC, sink assertions, package imports and one-time entity install. */
    const startMs = performance.now()
    if (metric === 'construction') this.#construct(iterations)
    else if (metric === 'query') await this.#query(iterations)
    else await this.#indexedWrite(iterations)
    /** Retain total time as well as its derived per-operation value for recomputation. */
    const endMs = performance.now()
    /** Both raw clock observations and their difference are recorded, without rounding. */
    const elapsedNs = (endMs - startMs) * 1e6
    if (metric === 'construction') this.#observeConstructionSink()
    return {
      iterations,
      startMs,
      endMs,
      elapsedNs,
      nsPerOperation: elapsedNs / iterations,
      observedSinkSlots: metric === 'construction' ? SINK_SLOTS : 0
    }
  }
  /** Observe one-time installation independently of the fixed per-repository samples. */
  installationCostNs(): number {
    return this.#installationCostNs
  }
  /** Release only the backend host actually owned by this variant. */
  async dispose(): Promise<void> {
    await this.#host?.dispose()
  }
}
/** Apply exactly one synchronous major collection before every individual metric sample. */
function forceCollection(): IGcSample {
  /** The benchmark requires Node --expose-gc rather than silently changing policy between variants. */
  const collect = globalThis.gc
  assert.equal(typeof collect, 'function', 'run the benchmark with node --expose-gc')
  /** Heap observations describe this explicit collection, not unobserved natural GC counts. */
  const heapBeforeBytes = process.memoryUsage().heapUsed
  /** Collection duration is reported separately and never contributes to operation timing. */
  const start = performance.now()
  collect!({ type: 'major', execution: 'sync' })
  /** One forced call per sample is the same policy for construction, query and indexed write. */
  const durationNs = (performance.now() - start) * 1e6
  return { count: 1, durationNs, heapBeforeBytes, heapAfterBytes: process.memoryUsage().heapUsed }
}

/** Hash the complete supplied dist tree once before measurement, without sorting growable input. */
function distProvenance(directory: string): IDistProvenance {
  /** Absolute inputs identify exactly which emitted package tree each variant loaded. */
  const root = resolve(directory)
  /** A cursor walk visits every emitted file once, including Vite's shared runtime chunks. */
  const pending = [root]
  /** Per-file hashes are order-independent evidence; no aggregate hash depends on directory order. */
  const sha256ByRelativePath: Record<string, string> = Object.create(null)
  /** Byte count makes omissions visible alongside the exact file inventory. */
  let bytes = 0
  for (let index = 0; index < pending.length; index++) {
    for (const entry of readdirSync(pending[index]!, { withFileTypes: true })) {
      /** This path is either queued as a directory or read as one emitted file. */
      const path = resolve(pending[index]!, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else {
        /** File contents are hashed outside every timed interval. */
        const contents = readFileSync(path)
        sha256ByRelativePath[relative(root, path)] = createHash('sha256')
          .update(contents)
          .digest('hex')
        bytes += contents.byteLength
      }
    }
  }
  return {
    directory: root,
    fileCount: Object.keys(sha256ByRelativePath).length,
    bytes,
    sha256ByRelativePath
  }
}

/** Collect fixed A/A2/B samples serially; every raw round remains available even after failure. */
async function collectMetric(
  metric: keyof typeof ITERATIONS,
  variants: readonly EntityPerfVariant[],
  samples: ISample[][],
  rawSamples: IRawSample[],
  variantOrder: readonly (typeof VARIANTS)[number][]
): Promise<void> {
  assert.equal(variants.length, variantOrder.length)
  for (let round = 0; round < ROUNDS; round++) {
    for (let index = 0; index < variantOrder.length; index++) {
      // At most three owners exist: VARIANTS fixes A/A2/B; calibration uses its first two entries.
      for (const variant of variants) variant.clearConstructionSink()
      /** Identical collection is completed before this sample's operation timer starts. */
      const gcBefore = forceCollection()
      /** No operations from another variant run concurrently with this public workload. */
      const timing = await variants[index]!.sample(metric)
      samples[round]![index]![metric] = timing.nsPerOperation
      rawSamples.push({
        metric,
        round: round + 1,
        variant: variantOrder[index]!,
        ...timing,
        gcBefore
      })
    }
  }
}

/** Compute the unchanged threshold; unstable construction/query never receives a B verdict. */
function metricResult(
  metric: keyof typeof ITERATIONS,
  samples: readonly ISample[][],
  baselineOnly: boolean
): IMetricResult {
  assert.equal(samples.length, ROUNDS)
  /** Ratios pair observations within each same-run interleaved round. */
  const ratios = baselineOnly ? [] : samples.map((round) => round[2]![metric]! / round[0]![metric]!)
  /** Independent baseline universes share exact baseline modules and fixed workload counts. */
  const controls = samples.map((round) => round[1]![metric]! / round[0]![metric]!)
  /** Report each round's control deviation, including the worst one; no round is discarded. */
  const controlDeviationPerRound = controls.map((ratio) => Math.abs(ratio - 1))
  /** Five control values are a compile-time bounded input from ROUNDS. */
  const noise = Math.max(...controlDeviationPerRound)
  /** This ceiling is user-stated and is never widened to compensate for noise. */
  const threshold = Math.min(1 + noise, 1.05)
  /** Construction and query controls must independently be stable before their B verdict. */
  const valid = metric === 'indexedWrite' || noise <= MAX_CONTROL_NOISE
  /** Each median contains the exact five fixed rounds. */
  const ratio = baselineOnly ? null : median(ratios)
  return {
    medianBA: ratio,
    maxControlDeviation: noise,
    controlDeviationPerRound,
    threshold,
    valid,
    pass: valid && ratio !== null ? ratio <= threshold : null,
    ratios,
    controls
  }
}

/** Save one unmodified inspector profile and its byte provenance outside the captured workload. */
function writeProfileArtifact(path: string, profile: object): IProfileArtifact {
  /** Inspector JSON is retained verbatim rather than collapsed into selected hotspots. */
  const content = JSON.stringify(profile)
  writeFileSync(path, content + '\n')
  /** The hash includes the exact newline written to disk. */
  const bytes = Buffer.from(content + '\n')
  return {
    path: resolve(path),
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
}

/** Capture one authorized CPU/allocation pair for only the selected public workload. */
async function profileVariant(
  baseline: string,
  changed: string,
  output: string,
  selected: 'A' | 'B',
  workload: IProfileWorkload
): Promise<void> {
  /** A local inspector session opens no network listener and owns only this capture. */
  const session = new Session()
  /** The same bounded fixture owns all warmup, backend disposal and the captured public workload. */
  let variant: EntityPerfVariant | undefined
  /** Each collector is stopped exactly once if its start succeeded, including partial setup failure. */
  let cpuStarted = false
  /** Allocation collection includes objects reclaimed during either major or minor GC. */
  let allocationStarted = false
  /** Every setup, collection or cleanup failure remains classified in the final metadata. */
  const failures: object[] = []
  /** A partial capture is useful evidence but never an equal-work comparison or timing gate. */
  const run: IProfileRun = {
    startMs: 0,
    endMs: 0,
    completedOperations: 0,
    observedSinkSlots: 0
  }
  /** Both profiles are bound to the exact built tree loaded for this selected variant. */
  let provenance: IDistProvenance | undefined
  /** Forced GC occurs once after warmup and before either collector starts. */
  let gcBefore: IGcSample | undefined
  /** Artifact metadata records only profiles that were actually stopped and written. */
  let cpuArtifact: IProfileArtifact | undefined
  /** Allocation samples are saved without dropping collected objects or sample records. */
  let allocationArtifact: IProfileArtifact | undefined
  try {
    assert.equal(typeof globalThis.gc, 'function', 'run the profile with node --expose-gc')
    /** The profile uses exactly the same baseline or changed emitted entry graph as the gate. */
    const directory = selected === 'A' ? baseline : changed
    provenance = distProvenance(directory)
    variant = await EntityPerfVariant.load(directory, selected === 'B')
    await variant.prepare()
    session.connect()
    await session.post('Profiler.enable')
    await session.post('Profiler.setSamplingInterval', { interval: PROFILE.cpuIntervalUs })
    await session.post('HeapProfiler.enable')
    variant.clearConstructionSink()
    gcBefore = forceCollection()
    await session.post('HeapProfiler.startSampling', {
      samplingInterval: PROFILE.allocationInterval,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true
    })
    allocationStarted = true
    await session.post('Profiler.start')
    cpuStarted = true
    run.startMs = performance.now()
    if (workload === 'construction') variant.profileConstruction(run)
    else await variant.profileQuery(run)
  } catch (error) {
    if (run.startMs !== 0 && run.endMs === 0) run.endMs = performance.now()
    failures.push({ phase: 'setup-or-' + workload, ...failureFields(error) })
  } finally {
    if (cpuStarted) {
      try {
        /** Raw CPU samples include the exact bounded selected-workload capture. */
        const response = await session.post('Profiler.stop')
        cpuArtifact = writeProfileArtifact(output + '.cpuprofile', response.profile)
      } catch (error) {
        failures.push({ phase: 'cpu-stop-or-write', ...failureFields(error) })
      }
    }
    if (allocationStarted) {
      try {
        /** Collected-object flags preserve allocation churn rather than only surviving objects. */
        const response = await session.post('HeapProfiler.stopSampling')
        allocationArtifact = writeProfileArtifact(output + '.heapprofile', response.profile)
      } catch (error) {
        failures.push({ phase: 'allocation-stop-or-write', ...failureFields(error) })
      }
    }
    try {
      session.disconnect()
    } catch (error) {
      failures.push({ phase: 'inspector-disconnect', ...failureFields(error) })
    }
    try {
      await variant?.dispose()
    } catch (error) {
      failures.push({ phase: 'backend-disposal', ...failureFields(error) })
    }
    /** Profile durations are diagnostic only; the unchanged A/A2/B harness remains the gate. */
    const result = {
      mode: workload + '-profile',
      selected,
      workload,
      profilingOnly: true,
      pass: null,
      status:
        failures.length === 0 && run.completedOperations === ITERATIONS[workload]
          ? 'profile-completed'
          : 'profile-incomplete',
      node: process.version,
      v8: process.versions.v8,
      completedAt: new Date().toISOString(),
      concurrency: 1,
      rows: ROW_COUNT,
      warmup: WARMUP,
      requestedOperations: ITERATIONS[workload],
      profile: {
        ...PROFILE,
        batch: PROFILE_BATCH[workload],
        includeObjectsCollectedByMajorGC: true,
        includeObjectsCollectedByMinorGC: true
      },
      run,
      elapsedNs: (run.endMs - run.startMs) * 1e6,
      countMeaning:
        `fully completed ${PROFILE_BATCH[workload]}-operation batches; ` +
        'a throwing partial batch is not counted',
      provenance,
      gcBefore,
      forcedGcInvocations: gcBefore === undefined ? 0 : 1,
      oneTimeInstallNs: variant?.installationCostNs(),
      cpuArtifact,
      allocationArtifact,
      failures
    }
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
    console.log(
      JSON.stringify({
        output,
        selected,
        workload,
        status: result.status,
        run,
        cpuArtifact,
        allocationArtifact,
        failures
      })
    )
    if (result.status !== 'profile-completed') process.exitCode = 2
  }
}

/** Calibrate one selected control or collect all three fixed workloads in the same process. */
async function main(): Promise<void> {
  /** CLI paths explicitly select emitted baseline and changed graphs; no prior timing is loaded. */
  const [baseline, changed, output, mode] = process.argv.slice(2)
  assert.ok(baseline && changed && output, 'baseline changed output paths required')
  assert.ok(
    mode === undefined ||
      mode === '--calibrate' ||
      mode === '--calibrate-query' ||
      mode === '--profile=A' ||
      mode === '--profile=B' ||
      mode === '--profile-query=A' ||
      mode === '--profile-query=B',
    'optional mode must be --calibrate, --calibrate-query, --profile=A|B or --profile-query=A|B'
  )
  if (mode === '--profile=A' || mode === '--profile=B') {
    await profileVariant(
      baseline,
      changed,
      output,
      mode === '--profile=A' ? 'A' : 'B',
      'construction'
    )
    return
  }
  if (mode === '--profile-query=A' || mode === '--profile-query=B') {
    await profileVariant(
      baseline,
      changed,
      output,
      mode === '--profile-query=A' ? 'A' : 'B',
      'query'
    )
    return
  }
  /** Calibration runs only the independent A/A2 controls and never evaluates a changed variant. */
  const baselineOnly =
    mode === '--calibrate' ||
    mode === '--calibrate-query' ||
    process.env.ENTITY_PERF_BASELINE_ONLY === '1'
  /** Query calibration times no construction/write sample; their warmup remains outside timing. */
  const calibrationMetric = mode === '--calibrate-query' ? 'query' : 'construction'
  /** Both run modes retain a fixed order; calibration omits B rather than renaming a baseline B. */
  const variantOrder = baselineOnly ? VARIANTS.slice(0, 2) : VARIANTS
  /** This fixed run records its runtime and bounds before importing either measured package graph. */
  const configuration = {
    mode: baselineOnly
      ? calibrationMetric === 'query'
        ? 'baseline-only-query-calibration'
        : 'baseline-only-calibration'
      : 'full-A-A2-B',
    startedAt: new Date().toISOString(),
    node: process.version,
    v8: process.versions.v8,
    concurrency: 1,
    burstSize: 1,
    rows: ROW_COUNT,
    iterations: ITERATIONS,
    warmup: WARMUP,
    rounds: ROUNDS,
    sinkSlots: SINK_SLOTS,
    variantOrder,
    metricOrder: baselineOnly ? [calibrationMetric] : METRICS,
    gcPolicy:
      'clear all bounded repository sinks; one global.gc({type:major,execution:sync}) before every metric sample; outside timer',
    gcCountMeaning: 'forced invocation count only; natural collection count is not measured',
    constructionControlLimit: MAX_CONTROL_NOISE,
    queryControlLimit: MAX_CONTROL_NOISE,
    observableFailures: {
      storageHost: ['INVALID_CONFIG', 'ENTITY_FEATURE_REQUIRED', 'INDEX_UNIQUE_CONFLICT'],
      storageContract: ['UNSUPPORTED_CAPABILITY', 'STORE_DISPOSED'],
      pluginHost: ['INVALID_OPTION', 'PLUGIN_INSTALL_FAILED'],
      sharedCodeBranches:
        'INVALID_CONFIG admission carries native cause; feature installation errors retain cause; no provider rejection channel is used'
    }
  }
  console.log(JSON.stringify(configuration))
  /** Owners are tracked before preparation so a setup failure still releases their native hosts. */
  const variants: EntityPerfVariant[] = []
  /** Each fixed round has exactly A/A2/B slots, filled metric by metric without deleting evidence. */
  const samples: ISample[][] = []
  // ROUNDS fixes five rounds and VARIANTS fixes at most three slots, independent of input size.
  for (let round = 0; round < ROUNDS; round++) {
    /** One mutable evidence slot per selected variant is filled without discarding any round. */
    const entries: ISample[] = []
    for (let index = 0; index < variantOrder.length; index++) entries.push({})
    samples.push(entries)
  }
  /** Raw elapsed time, operation count and collection evidence survive partial or noisy runs. */
  const rawSamples: IRawSample[] = []
  /** Metric summaries are written only after their exact fixed rounds complete. */
  const metrics: Partial<Record<keyof typeof ITERATIONS, IMetricResult>> = {}
  /** The complete baseline and changed dist inventories include every imported local chunk. */
  let provenance:
    | Readonly<{ A: IDistProvenance; A2: IDistProvenance; B?: IDistProvenance }>
    | undefined
  try {
    assert.equal(typeof globalThis.gc, 'function', 'run the benchmark with node --expose-gc')
    /** A2 intentionally uses the same hashed baseline tree, with an independent backend universe. */
    const baselineProvenance = distProvenance(baseline)
    provenance = {
      A: baselineProvenance,
      A2: baselineProvenance,
      ...(baselineOnly ? {} : { B: distProvenance(changed) })
    }
    /** Calibration loads two baseline universes; the full gate adds exactly one changed universe. */
    const inputs: readonly (readonly [string, boolean])[] = baselineOnly
      ? [
          [baseline, false],
          [baseline, false]
        ]
      : [
          [baseline, false],
          [baseline, false],
          [changed, true]
        ]
    for (const [directory, installedRoute] of inputs) {
      /** Warm every variant equally before the first collection and timed sample. */
      const variant = await EntityPerfVariant.load(directory, installedRoute)
      variants.push(variant)
      await variant.prepare()
    }
    /** A calibration uses its selected workload; full runs always begin with construction. */
    const firstMetric = baselineOnly ? calibrationMetric : 'construction'
    await collectMetric(firstMetric, variants, samples, rawSamples, variantOrder)
    /** Keep the selected summary explicit while the evidence table retains its metric address. */
    const firstResult = metricResult(firstMetric, samples, baselineOnly)
    metrics[firstMetric] = firstResult
    if (baselineOnly) {
      /**
       * Calibration judges only its selected A/A2 control stability; no B sample or business
       * performance verdict exists.
       */
      const result = {
        status: firstResult.valid ? 'calibration-stable' : 'invalid-' + firstMetric + '-control',
        valid: firstResult.valid,
        pass: null,
        configuration,
        provenance,
        samples,
        rawSamples,
        metrics,
        forcedGcInvocations: rawSamples.length,
        oneTimeInstallNs: variants.map((variant) => variant.installationCostNs()),
        classification:
          `baseline-only ${firstMetric} calibration; only selected workload sampled; ` +
          'B not run; no A/B verdict'
      }
      writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
      console.log(JSON.stringify({ output, status: result.status, pass: null, metrics }))
      if (!result.valid) process.exitCode = 2
      return
    }
    if (!metrics.construction!.valid) {
      /** Stop NR4 step 1; query/write and B construction receive no pass/fail conclusion. */
      const result = {
        status: 'invalid-construction-control',
        valid: false,
        pass: null,
        configuration,
        provenance,
        samples,
        rawSamples,
        metrics,
        forcedGcInvocations: rawSamples.length,
        oneTimeInstallNs: variants.map((variant) => variant.installationCostNs()),
        classification:
          'construction A/A2 noise exceeds 5%; B not judged; query/indexedWrite not run'
      }
      writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
      console.log(JSON.stringify({ output, status: result.status, pass: result.pass, metrics }))
      process.exitCode = 2
      return
    }
    for (const metric of ['query', 'indexedWrite'] as const) {
      await collectMetric(metric, variants, samples, rawSamples, variantOrder)
      metrics[metric] = metricResult(metric, samples, false)
    }
    /** Query independently meets its control limit; an unstable query supplies no B verdict. */
    const valid = metrics.query!.valid
    /** An invalid measurement is neither a pass nor a failed B performance gate. */
    const pass = valid ? METRICS.every((metric) => metrics[metric]!.pass === true) : null
    /** Persist all recomputable samples even when query control stability invalidates the gate. */
    const result = {
      status: valid ? 'completed' : 'invalid-query-control',
      valid,
      pass,
      configuration,
      provenance,
      rounds: ROUNDS,
      samples,
      rawSamples,
      metrics,
      forcedGcInvocations: rawSamples.length,
      oneTimeInstallNs: variants.map((variant) => variant.installationCostNs()),
      classification: valid
        ? 'stable construction/query controls; completed timing samples; no rejected operation'
        : 'query A/A2 noise exceeds 5%; query B not judged; all three workloads sampled'
    }
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify({ output, status: result.status, pass, metrics }))
    if (!valid) process.exitCode = 2
    else if (!pass) process.exitCode = 1
  } catch (error) {
    /** Business/setup failures stay outside timing verdicts and retain every completed raw sample. */
    const result = {
      status: 'operation-failure',
      valid: false,
      pass: null,
      configuration,
      provenance,
      classification:
        typeof globalThis.gc === 'function'
          ? 'operation-or-fixture-failure; no A/B verdict'
          : 'fixture-error: forced GC unavailable; node --expose-gc is required',
      failure: failureFields(error),
      samples,
      rawSamples,
      metrics
    }
    writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
    console.error(JSON.stringify({ output, status: result.status, failure: result.failure }))
    process.exitCode = 1
  } finally {
    for (const variant of variants) await variant.dispose()
  }
}

await main()
