/**
 * Same-process interleaved A/A2/B comparison. Bundle both source roots first with --bundle; execute
 * only --run inside the repository exclusive measurement window with --end-load enforce.
 */
import { strict as assert } from 'node:assert'
import {
  appendFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Every phase is named before work, so late diagnostics retain the actual measurement boundary. */
export type IMeasurementPhase = 'setup' | 'warmup' | 'measurement' | 'cleanup'
/** Original diagnostics and local refusal DTOs retain their per-call observation source. */
export type IFailureObservation = Readonly<{
  kind: 'report' | 'provider-rejection' | 'thrown'
  phase: IMeasurementPhase
  operation: number
  error: unknown
}>
/** Each independent bundle exposes the same minimal real-Host measurement interface. */
export type IFeatureRecordSession = Readonly<{
  phase(value: IMeasurementPhase): void
  open(): Promise<void>
  invoke(): Promise<void>
  close(): Promise<void>
  failures(): readonly IFailureObservation[]
  statistics(): Readonly<{ clientPeak: number; providerPeak: number; providerCalls: number }>
}>
/** Source provenance and observable failure vocabulary accompany each complete bundled variant. */
export type ISideModule = Readonly<{
  provenance: Readonly<{ sourceRoot: string; revision: string; form: 'array' | 'record' }>
  failureVocabulary: Readonly<{
    codes: Readonly<Record<string, readonly string[]>>
    sharedCodes: Readonly<Record<string, unknown>>
  }>
  createSession(): IFeatureRecordSession
}>
/** Each side retains its complete result, including failures and cleanup outside timed execution. */
type ISideReceipt = Readonly<{
  type: 'side'
  round: number
  label: 'A' | 'A2' | 'B'
  status: 'pass' | 'fail'
  completed: number
  warmup: number
  elapsedNs: number | null
  nsPerCall: number | null
  observed: ReturnType<IFeatureRecordSession['statistics']>
  failures: readonly unknown[]
}>
/** Source-only resolution prevents baseline bundles from importing candidate workspace packages. */
type IPackageManifest = Readonly<{
  name: string
  exports: Readonly<Record<string, string | Readonly<{ default: string }>>>
}>

/** Exactly five complete rounds fix both the comparison population and median's bounded input. */
const roundCount = 5
/** Every round rotates these three bounded orders; no implementation always runs first. */
const orders = [
  ['A', 'A2', 'B'],
  ['B', 'A', 'A2'],
  ['A2', 'B', 'A']
] as const
/** CLI and fixture diagnostics stay centralized and contain no business payloads or credentials. */
const text = {
  arguments:
    'Use --bundle --root ROOT --form array|record --revision REV --out FILE, or --run --a A --b B --out JSONL [--samples N] [--warmup N].',
  module: 'Expected isolated A=array and B=record modules with their own source provenance.',
  count: 'Samples must be a positive safe integer; warmup must be a nonnegative safe integer.',
  calls:
    'Observed client/provider concurrency or business-call count differs from serial RPC work.',
  diagnostics: 'The side emitted a report or provider rejection; timing cannot pass.',
  source: 'A selected workspace export has no real source file; dist fallback is forbidden.',
  pollution: 'A bundle included workspace package source outside its selected root.',
  median: 'Exactly five complete positive measurements are required.',
  payload: '[REDACTED_PAYLOAD]',
  identifier: '[REDACTED_IDENTIFIER]'
} as const

/** Parse only this fixture's explicit key/value arguments without a general-purpose CLI layer. */
function argumentsOf(values: readonly string[]): ReadonlyMap<string, string> {
  /** The two command modes are switches; remaining options consume exactly one value. */
  const result = new Map<string, string>()
  for (let index = 0; index < values.length; index += 1) {
    /** Current option is never evaluated as shell text. */
    const key = values[index]!
    if (key === '--bundle' || key === '--run') result.set(key, 'true')
    else {
      assert(key.startsWith('--') && values[index + 1] !== undefined, text.arguments)
      result.set(key, values[++index]!)
    }
  }
  return result
}

/** Require a concrete path or setting before any bundle write or measurement begins. */
function required(options: ReadonlyMap<string, string>, key: string): string {
  /** Missing configuration fails before acquiring Hosts or timing work. */
  const value = options.get(key)
  assert(value, text.arguments)
  return value
}

/** Keep original semantic classifications and traverse every original cause/aggregate link once. */
function classify(error: unknown, seen = new Set<unknown>()): unknown {
  if (seen.has(error)) return { repeatedCause: true }
  if (error !== null && typeof error === 'object') seen.add(error)
  /** Native errors and existing local rejection DTOs share only this diagnostic projection. */
  const value = (error ?? {}) as Record<string, unknown>
  /** Fixed fixture payloads and auth-like identifiers are redacted before any output is written. */
  const message = String(value.message ?? error)
    .replace(/feature-record-payload/g, text.payload)
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, text.identifier)
  /** Original aggregate entries remain attributable even when multiple branches share one code. */
  const errors = Array.isArray(value.errors) ? value.errors : []
  return {
    source: value.source ?? null,
    code: value.code ?? null,
    name: value.name ?? typeof error,
    reason: value.reason ?? null,
    message,
    cause: value.cause === undefined ? null : classify(value.cause, seen),
    errors: errors.map((entry) => classify(entry, seen))
  }
}

/** Stable numeric ordering is used only for the compile-time fixed five-round population. */
function numericOrder(left: number, right: number): number {
  return left - right
}

/** Compute the exact median without accepting incomplete, failed or nonpositive timing rounds. */
function medianOfFive(values: readonly number[]): number {
  assert(values.length === roundCount && values.every((value) => value > 0), text.median)
  // roundCount is the compile-time constant 5, so this sort never grows with runtime input.
  return [...values].sort(numericOrder)[2]!
}

/** Own one selected source root's package export map for the isolated bundler resolver. */
class SourceResolver {
  /** Absolute source root is fixed before resolving the first package edge. */
  readonly #root: string
  /** One precomputed package index keeps each import resolution independent of package count. */
  readonly #packages = new Map<string, Readonly<{ root: string; manifest: IPackageManifest }>>()

  /** Read metadata only; no dist file, package install or build is consulted. */
  constructor(root: string) {
    this.#root = realpathSync(root)
    for (const entry of readdirSync(join(this.#root, 'packages'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      /** Only package manifests under this selected source root participate in the index. */
      const path = join(this.#root, 'packages', entry.name)
      if (!existsSync(join(path, 'package.json'))) continue
      /** Existing package exports remain the authoritative package/subpath mapping. */
      const manifest = JSON.parse(
        readFileSync(join(path, 'package.json'), 'utf8')
      ) as IPackageManifest
      this.#packages.set(manifest.name, { root: path, manifest })
    }
  }

  /**
   * Resolve every @migaia edge to this root's real TypeScript source, never installed workspace
   * links.
   */
  readonly resolve = (request: Readonly<{ path: string }>) => {
    /** Package name has the fixed scoped-name prefix; remaining components form its subpath. */
    const parts = request.path.split('/')
    /** Direct indexing avoids searching exports by suffix or choosing a nearby implementation. */
    const name = parts.slice(0, 2).join('/')
    /** One selected manifest supplies the requested subpath's published implementation entry. */
    const selected = this.#packages.get(name)
    assert(selected, text.source + ' ' + request.path)
    /** Root and subpath exports share the repository's maintained export table. */
    const key = parts.length === 2 ? '.' : './' + parts.slice(2).join('/')
    /** Runtime default is used only to locate its corresponding real source file. */
    const entry = selected.manifest.exports[key]
    /** Every source in this task uses a default implementation export. */
    const target = typeof entry === 'string' ? entry : entry?.default
    assert(target, text.source + ' ' + request.path)
    /** Compiled export names are rewritten to real source candidates under the same owning package. */
    const stem = target.replace(/^\.\/dist\//, './src/').replace(/\.(?:js|mjs|cjs)$/, '')
    // The repository permits exactly these three TypeScript source extensions.
    for (const extension of ['.ts', '.tsx', '.mts']) {
      /** No import ever falls back to generated dist or a different workspace root. */
      const path = resolve(selected.root, stem + extension)
      if (existsSync(path)) return { path }
    }
    assert.fail(text.source + ' ' + request.path)
  }
}

/** Create one self-contained source bundle; caller must run this build through the exclusive window. */
async function bundle(options: ReadonlyMap<string, string>): Promise<void> {
  /** Node resolution supplies the installed bundler; it never selects implementation source. */
  const require = createRequire(import.meta.url)
  /** Vite owns esbuild in this workspace when it is not directly exposed at the root. */
  const esbuild = createRequire(require.resolve('vite/package.json'))('esbuild') as {
    build(
      options: Record<string, unknown>
    ): Promise<{ metafile: { inputs: Record<string, unknown> } }>
  }
  /** Source roots remain physically distinct even when the caller uses symlinked temp paths. */
  const root = realpathSync(required(options, '--root'))
  /** API shape is explicit and cannot be inferred from missing exports. */
  const form = required(options, '--form')
  assert(form === 'array' || form === 'record', text.arguments)
  /** This same fixture is deliberately shared; all implementation imports are source-root isolated. */
  const entry = fileURLToPath(new URL('./feature-record-side.ts', import.meta.url))
  /** One bounded alias resolver owns every workspace package edge. */
  const resolver = new SourceResolver(root)
  /** Build output belongs to the caller's selected ignored evidence directory. */
  const output = resolve(required(options, '--out'))
  /** Complete input metadata proves whether either source bundle crossed its root boundary. */
  const result = await esbuild.build({
    absWorkingDir: root,
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    nodePaths: [
      fileURLToPath(new URL('../../../node_modules', import.meta.url)),
      fileURLToPath(new URL('../../../node_modules/.pnpm/node_modules', import.meta.url))
    ],
    banner: {
      js: "import { createRequire as featureRecordRequire } from 'node:module'; const require = featureRecordRequire(import.meta.url);"
    },
    metafile: true,
    define: {
      FEATURE_RECORD_SOURCE_ROOT: JSON.stringify(root),
      FEATURE_RECORD_REVISION: JSON.stringify(required(options, '--revision')),
      FEATURE_RECORD_FORM: String(form === 'record')
    },
    plugins: [
      {
        name: 'selected-workspace-source',
        setup: (build: any) => {
          build.onResolve({ filter: /^@migaia\// }, resolver.resolve)
        }
      }
    ]
  })
  /** Shared fixture code is the sole allowed workspace source outside the selected root. */
  const shared = realpathSync(entry)
  for (const input of Object.keys(result.metafile.inputs)) {
    /** Metadata input names are rooted at the selected build working directory. */
    const path = isAbsolute(input) ? input : resolve(root, input)
    if (path.includes('/packages/') && !path.includes('/node_modules/') && path !== shared)
      assert(!relative(root, path).startsWith('..'), text.pollution + ' ' + path)
  }
  writeFileSync(output + '.meta.json', JSON.stringify(result.metafile, null, 2) + '\n')
}

/**
 * Time successful public calls only; warmup, acquisition, diagnostics projection and cleanup stay
 * out.
 */
async function measure(
  side: ISideModule,
  label: ISideReceipt['label'],
  round: number,
  samples: number,
  warmup: number
): Promise<ISideReceipt> {
  /** The module creates an independent pair even when A and A2 use the same baseline code image. */
  const session = side.createSession()
  /** A side retains all original failures rather than replacing failed rounds with a rerun. */
  const thrown: IFailureObservation[] = []
  /** Completed counts cannot include a failed call or an issued-but-unsettled request. */
  let completed = 0
  /** A failed setup has no timing value and cannot contribute to the ratio gate. */
  let elapsedNs: number | null = null
  /** Current phase remains available for the original caught failure. */
  let phase: IMeasurementPhase = 'setup'
  try {
    await session.open()
    phase = 'warmup'
    session.phase(phase)
    for (let index = 0; index < warmup; index += 1) await session.invoke()
    assert.equal(session.failures().length, 0, text.diagnostics)
    phase = 'measurement'
    session.phase(phase)
    /** One monotonic interval includes the same serial awaited real RPC call path in every variant. */
    const started = process.hrtime.bigint()
    for (let index = 0; index < samples; index += 1) {
      await session.invoke()
      completed += 1
    }
    elapsedNs = Number(process.hrtime.bigint() - started)
    assert.equal(session.failures().length, 0, text.diagnostics)
    assert.deepEqual(
      session.statistics(),
      {
        clientPeak: 1,
        providerPeak: 1,
        providerCalls: samples + warmup
      },
      text.calls
    )
  } catch (error) {
    thrown.push({ kind: 'thrown', phase, operation: completed, error })
  }
  session.phase('cleanup')
  try {
    await session.close()
  } catch (error) {
    thrown.push({ kind: 'thrown', phase: 'cleanup', operation: completed, error })
  }
  /** Reports and onRejected are separate original observations, not deduplicated error counts. */
  const observations = [...thrown, ...session.failures()]
  return {
    type: 'side',
    round,
    label,
    status: observations.length || completed !== samples ? 'fail' : 'pass',
    completed,
    warmup,
    elapsedNs,
    nsPerCall: elapsedNs === null || completed !== samples ? null : elapsedNs / samples,
    observed: session.statistics(),
    failures: observations.map((event) => ({ ...event, error: classify(event.error) }))
  }
}

/**
 * Preserve each completed side before the next begins, including runner cleanup failures after
 * work.
 */
function append(path: string, value: unknown): void {
  appendFileSync(path, JSON.stringify(value) + '\n')
}

/** Run all fifteen independent pairs in one process and judge exactly the user's five-round formula. */
async function run(options: ReadonlyMap<string, string>): Promise<void> {
  /** Code images are separately bundled and imported once; A2 creates fresh baseline Hosts. */
  const a = (await import(pathToFileURL(resolve(required(options, '--a'))).href)) as ISideModule
  /** B has a distinct private native identity registry and source implementation image. */
  const b = (await import(pathToFileURL(resolve(required(options, '--b'))).href)) as ISideModule
  assert(
    a.provenance.form === 'array' &&
      b.provenance.form === 'record' &&
      a.provenance.sourceRoot !== b.provenance.sourceRoot,
    text.module
  )
  /** Default sample and warmup counts are equal across every side and every retained round. */
  const samples = Number(options.get('--samples') ?? 10_000)
  /** Warmup primes the actual call path in each fresh independent Host pair. */
  const warmup = Number(options.get('--warmup') ?? 1_000)
  assert(
    Number.isSafeInteger(samples) && samples > 0 && Number.isSafeInteger(warmup) && warmup >= 0,
    text.count
  )
  /** Append-only JSONL evidence survives a later side failure or exclusive-runner cleanup error. */
  const output = resolve(required(options, '--out'))
  writeFileSync(
    output,
    JSON.stringify({
      type: 'configuration',
      rounds: roundCount,
      samples,
      warmup,
      concurrency: 1,
      scenario: 'real memory RPC send with timeout + retry + limitsFeature',
      order: orders,
      a: a.provenance,
      a2: a.provenance,
      b: b.provenance,
      failureVocabulary: { a: a.failureVocabulary, b: b.failureVocabulary },
      runtime: process.version,
      pid: process.pid,
      formula: 'median(B/A) <= min(1 + max(abs(A2/A - 1)), 1.05)'
    }) + '\n'
  )
  /** Exactly one entry per label is retained for each of the compile-time fixed five rounds. */
  const rounds: { a: number; a2: number; b: number; noise: number; ratio: number }[] = []
  for (let round = 0; round < roundCount; round += 1) {
    /** Rotation prevents a fixed first-run allocation/JIT advantage for either implementation. */
    const measured = new Map<ISideReceipt['label'], number>()
    for (const label of orders[round % orders.length]!) {
      /** Every side finishes its own warmup, timing and cleanup before the next side starts. */
      const receipt = await measure(label === 'B' ? b : a, label, round + 1, samples, warmup)
      append(output, receipt)
      if (receipt.status !== 'pass' || receipt.nsPerCall === null) {
        append(output, { type: 'verdict', status: 'error', completeRounds: rounds.length })
        process.exitCode = 2
        return
      }
      measured.set(label, receipt.nsPerCall)
    }
    /** Ratios compare independent Hosts measured in this same interleaved round. */
    const baseline = measured.get('A')!
    /** Fresh baseline noise calibration uses the same code and identical runtime path. */
    const noise = measured.get('A2')! / baseline - 1
    /** Every round is retained, including the least favorable candidate ratio. */
    const ratio = measured.get('B')! / baseline
    rounds.push({ a: baseline, a2: measured.get('A2')!, b: measured.get('B')!, noise, ratio })
    append(output, { type: 'round', round: round + 1, ...rounds[rounds.length - 1] })
  }
  /** Noise is the largest absolute A2/A change across all five retained rounds. */
  let maxNoise = 0
  for (const round of rounds) maxNoise = Math.max(maxNoise, Math.abs(round.noise))
  /** The user caps any same-run noise allowance at five percent. */
  const threshold = Math.min(1 + maxNoise, 1.05)
  /** The gate compares the median of paired ratios, never the ratio of separate medians. */
  const medianRatio = medianOfFive(rounds.map((round) => round.ratio))
  /** A failed gate stops this implementation step; all numbers remain in the evidence file. */
  const status = medianRatio <= threshold ? 'pass' : 'fail'
  append(output, { type: 'verdict', status, medianRatio, maxNoise, threshold, rounds })
  process.exitCode = status === 'pass' ? 0 : 1
}

/** Select explicit authoring or measurement mode; an imported fixture never starts work itself. */
async function main(): Promise<void> {
  /** Arguments contain only source paths, revision labels and numeric fixture settings. */
  const options = argumentsOf(process.argv.slice(2))
  if (options.has('--bundle') && !options.has('--run')) await bundle(options)
  else if (options.has('--run') && !options.has('--bundle')) await run(options)
  else assert.fail(text.arguments)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({ type: 'fixture-error', error: classify(error) }) + '\n')
    process.exitCode = 2
  })
}
