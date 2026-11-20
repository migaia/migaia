/** CI package scheduling; one preparation build feeds read-only release checks and custody. */
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  appendFileSync
} from 'node:fs'
import { availableParallelism, constants, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CAPTURE_EXIT_CODE_FILE,
  CI_COVERAGE_REPORT_ENV,
  NON_V8_PACKAGES,
  RPC_COVERAGE_FAMILY,
  coverageArguments,
  readPackageManifest
} from './coverage-custody.mjs'
import { assertAllFresh, DistStampErrorCode } from './dist-stamp.mjs'

/** @typedef {'required' | 'warning'} IGatePolicy */
/** @typedef {{ name: string; state: string; code: number; seconds: number }} IGateResult */
/**
 * @typedef {{
 *   name: string
 *   gates: IGateResult[]
 *   started: number
 *   finished: number
 *   family: boolean
 * }} IPackageResult
 *   `family` marks an RPC owner whose test runs in the shared family capture.
 */
/** @typedef {{ jobs: number; workers: number; reportRoot: string; env: NodeJS.ProcessEnv }} ICiRuntime */
/** @typedef {{ cwd?: string; env?: NodeJS.ProcessEnv; log?: string }} ICommandOptions */
/** @typedef {{ rpc: boolean; website: boolean }} ICiScope */
/** @typedef {{ name: string; path: string }} IWorkspaceProject */
/** @typedef {{ part: string[]; apps: string[] }} ICiExtra */
/** @typedef {{ prefixes: readonly string[]; rpc: boolean }} ICiFamily */
/** @typedef {{ packages: string[]; apps: string[]; filters: string[] }} IFamilySelection */

/** All commands resolve relative to the checkout containing this scheduler. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Stable result states retain the existing Makefile log-reader contract. */
const GateState = Object.freeze({
  pass: 'PASS',
  fail: 'FAIL',
  warning: 'WARN',
  skipWarning: 'SKIP-WARN',
  skipBlocking: 'SKIP-BLOCKING'
})
/** Root gate labels stay in the original full-CI summary order. */
const GateName = Object.freeze({
  build: 'workspace/build',
  dependencies: 'dependencies-check',
  release: 'release-plan-check',
  ship: 'ship-ci',
  store: 'store-ship-ci',
  part: 'part-packages-ci',
  registry: 'registry:check',
  consumers: 'typecheck:consumers',
  docs: 'check-docs-independence',
  docsExamples: 'docs-examples',
  custody: 'coverage-custody-report',
  conformance: 'rpc/test:conformance',
  parity: 'rpc/test:suite-parity'
})
/** Root fixture gates remain unchanged; this scheduler adds no testing surface. */
const rootTestGates = Object.freeze([
  'test:coverage-custody',
  'test:dist-stamp',
  'test:docs-independence',
  'test:js-exceptions',
  'test:registry',
  'test:release',
  'test:tree-shaking'
])
/**
 * Application gates in run order. Applications have no build output or coverage owner, so each gate
 * is the app's own package script; `fmt` is the read-only Makefile check.
 */
const appGates = Object.freeze(['fmt', 'lint', 'typecheck', 'typecheck:test', 'test'])
/** Fast application gates: the static prefix of `appGates`, without tests. */
const appFastGates = Object.freeze(['fmt', 'lint', 'typecheck', 'typecheck:test'])
/**
 * Library families with their own CI target (`make <family>-ci`, `make <family>-ci-fast`). A family
 * is every package and app whose directory starts with one of its prefixes, plus their workspace
 * dependency closure. `rpc` adds the conformance and suite-parity gates.
 *
 * @type {Readonly<Record<string, ICiFamily>>}
 */
const ciFamilies = Object.freeze({
  storage: Object.freeze({ prefixes: Object.freeze(['storage-']), rpc: false }),
  rpc: Object.freeze({ prefixes: Object.freeze(['rpc-']), rpc: true }),
  log: Object.freeze({ prefixes: Object.freeze(['log-']), rpc: false }),
  part: Object.freeze({ prefixes: Object.freeze(['part-', 'partom-']), rpc: false })
})
/** Foreign conformance peers require the same executables as Makefile. */
const conformanceTools = Object.freeze(['python3', 'rustc', 'cargo', 'go'])
/** Both runtime owners and their integration suite participate in the one RPC capture. */
const familyOwners = Object.freeze([
  ...RPC_COVERAGE_FAMILY.runtimeOwners,
  RPC_COVERAGE_FAMILY.runner
])
/** The six package configs exclude these family-only suites; their failures belong to root gates. */
const familyOnlyTestFile =
  /\/test\/(?:process\/conformance[^/]*\.test\.ts|bridge\/conformance-faults\.test\.ts|merge\/suite-parity\.test\.ts)$/
/**
 * Timing ratios, real timeouts and CPU-bound string checks run serially on a quiet machine before
 * the ordinary pool starts.
 */
const exclusivePackages = Object.freeze(['lifecycle', 'utils', 'plugin-host'])
/** Number of unfinished ordinary chains that may still overlap the single RPC family capture. */
const familyOverlapChains = 2
/**
 * Conformance runs as two concurrent serial lanes split by whole file: the long resource suite
 * alone, and every other conformance file. Each lane keeps the original false/1 config.
 */
const conformanceLanes = Object.freeze([
  /** The clock-bound resource suite starts early, alongside the RPC family capture. */
  Object.freeze({
    id: 'r',
    early: true,
    args: Object.freeze(['test/process/conformance-resources.test.ts'])
  }),
  Object.freeze({
    id: 'o',
    early: false,
    args: Object.freeze(['--exclude', 'test/process/conformance-resources.test.ts'])
  })
])
/**
 * Short per-checkout prefix for lane-private TMPDIR roots. Lanes must not share Go/Rust peer build
 * output; /tmp keeps Unix socket paths under the macOS length limit; the stable name lets later
 * runs reuse native build caches.
 */
const conformanceTemporaryPrefix = join(
  '/tmp',
  'ci-' + createHash('sha256').update(repositoryRoot).digest('hex').slice(0, 8)
)
/** Shared inputs invalidate every package gate; pnpm still owns all package dependency selection. */
const sharedInputPaths = new Set([
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.base.json',
  'turbo.json',
  'Makefile'
])
/** Only root tool configurations and scripts trigger the explicitly requested full fallback. */
const rootToolConfig =
  /^(?:\.?ox(?:fmt|lint)(?:rc|\.config)?|vitest\.config|eslint\.config|\.eslintrc)(?:\.|$)/
/** Package-only packed scripts may omit precisely these known preparation builds. */
const packedCommands = Object.freeze({
  'event-subscriber': [
    'pnpm build && node test/packed-export-smoke.mjs',
    'node',
    'test/packed-export-smoke.mjs'
  ],
  utils: [
    'pnpm run build && node test/packed-export-smoke.mjs',
    'node',
    'test/packed-export-smoke.mjs'
  ],
  'plugin-host': ['pnpm run build && node test/packed-smoke.mjs', 'node', 'test/packed-smoke.mjs'],
  'storage-host': [
    'pnpm run build && node test/authoring-packed-export-smoke.mjs',
    'node',
    'test/authoring-packed-export-smoke.mjs'
  ],
  'store-persist': [
    'pnpm run build && node test/packed-export-smoke.mjs',
    'node',
    'test/packed-export-smoke.mjs'
  ],
  /**
   * Family CI selects the integration runner; its packed smoke rebuilds every RPC owner first,
   * which would clean `dist/` under the conformance lanes and other readers.
   */
  'rpc-integration': [
    'pnpm -r --workspace-concurrency=2 --filter @migaia/rpc-contract --filter @migaia/rpc-host --filter @migaia/rpc-plugin-process --filter @migaia/rpc-plugin-thread --filter @migaia/rpc-plugin-browser --filter @migaia/rpc-plugin-coroutines --filter @migaia/rpc-plugin-pool --filter @migaia/rpc-plugin-devtools run build && node test/core/packed-export-smoke.mjs',
    'node',
    'test/core/packed-export-smoke.mjs'
  ],
  'storage-plugin-browser': [
    'pnpm run build && vitest run test/bundle-boundary.spec.ts',
    'pnpm',
    'exec',
    'vitest',
    'run',
    'test/bundle-boundary.spec.ts'
  ]
})
/** Turbo builds packages only; the website keeps its own bun gates and is never a turbo task. */
const workspaceBuildArgs = Object.freeze([
  '-r',
  '--workspace-concurrency=2',
  '--filter=./packages/*',
  'run',
  'build'
])

/**
 * Run one package script through Turbo so unchanged inputs replay their cached result. `--only`
 * skips dependency tasks: the preparation build has already produced every dist.
 *
 * @param {string} name Package directory name.
 * @param {string} gate Package script name.
 * @returns {string[]} Pnpm arguments that execute the cached Turbo task.
 */
const turboGateArgs = (name, gate) => [
  'exec',
  'turbo',
  'run',
  gate,
  `--filter=./packages/${name}`,
  '--only'
]

/** CLI and error text belongs to the scheduler rather than scattered throw sites. */
const text = Object.freeze({
  summary: '\n==> CI summary',
  package: (name) => `\n==> checking @migaia/${name}`,
  gate: (name) => `\n==> ${name}`,
  counts: (passed, failed, warnings) =>
    `==> passed=${passed} blocking=${failed} non-blocking=${warnings}`,
  result: ({ state, name, code, seconds }) => `${state} | ${name} | exit=${code} | ${seconds}s`,
  report: (root) =>
    `==> CI coverage reports: ${root}\n==> signing reuse: ${CI_COVERAGE_REPORT_ENV}=${root}`,
  jobs: (jobs, workers) => `==> CI_JOBS=${jobs}; nested workers=${workers}`,
  invalidJobs: 'CI_JOBS must be a positive integer',
  invalidArguments:
    'usage: node scripts/ci-run.mjs ci|affected --release "packages" --store "packages" [--part "packages"] [--apps "apps"] | packages --packages "packages" | family --family name [--fast]',
  invalidBase: 'CI_BASE must name an existing Git commit',
  affected: (base) => '==> affected scope; CI_BASE=' + base,
  selection: (names) => '==> selected packages: ' + (names.join(' ') || '(none)'),
  fallback: (paths) => '==> full fallback: shared inputs changed: ' + paths.join(', '),
  selectionReason: '==> selection: pnpm Git dependents filter, including untracked package inputs',
  emptyDiff: '==> affected scope: empty diff; no gates run',
  plan: (names) => '==> planned gates: ' + (names.join(' ') || '(none)'),
  missingPackage: (name) => `unknown CI package: ${name}`,
  missingApp: (name) => `unknown CI app: ${name}`,
  unknownFamily: (name) =>
    `unknown CI family: ${name}; expected one of ${Object.keys(ciFamilies).join(', ')}`,
  familySelection: (name, packages, apps) =>
    `==> ${name} family closure: ${[...packages, ...apps.map((app) => 'apps/' + app)].join(' ')}`,
  packedChanged: (name) => `CI packed preparation no longer matches the declared ${name} script`,
  missingTools: (tools) => `rpc/test:conformance (missing: ${tools.join(' ')})`,
  family: '\n==> RPC family coverage (exclusive)',
  familyFailure: (code) =>
    `==> RPC family capture exit=${code}; custody retains runner and threshold failure ownership`,
  preparation: '==> preparing fresh workspace output for package checks',
  spawnFailure: (command, error) => `${command}: ${error.message}`,
  failure: (error) => `ci-run: ${error.stack ?? error}`
})

/**
 * Run a child without translating its exit status; optional capture logs retain stdout and stderr.
 *
 * @param {string} command Executable already installed in the inherited toolchain PATH.
 * @param {string[]} args Executable arguments, never shell source.
 * @param {ICommandOptions} [options] Working directory, capture environment and optional raw log.
 * @returns {Promise<number>} Native exit code, or the conventional signal/missing-executable code.
 */
export const runCommand = (command, args, options = {}) =>
  new Promise((finish) => {
    /** A spawn failure is reported once, then the close event resolves the gate normally. */
    let spawnError = null
    /** Streaming pipes retain raw capture evidence while preserving live CI output. */
    const child = spawn(command, args, {
      cwd: options.cwd ?? repositoryRoot,
      env: options.env ?? process.env,
      stdio: ['inherit', 'pipe', 'pipe']
    })
    /**
     * Forward each chunk to its original channel and the capture log, without buffering test
     * output.
     */
    const forward = (channel, chunk) => {
      channel.write(chunk)
      if (options.log) appendFileSync(options.log, chunk)
    }
    child.stdout.on('data', (chunk) => forward(process.stdout, chunk))
    child.stderr.on('data', (chunk) => forward(process.stderr, chunk))
    child.on('error', (error) => {
      spawnError = error
      console.error(text.spawnFailure(command, error))
    })
    child.on('close', (code, signal) =>
      finish(
        code ??
          (signal
            ? 128 + (constants.signals[signal] ?? 0)
            : spawnError?.code === 'ENOENT'
              ? 127
              : 1)
      )
    )
  })

/**
 * Preserve the existing required/warning policy around one command.
 *
 * @param {string} name Existing gate name.
 * @param {IGatePolicy} policy Whether a nonzero exit blocks the run.
 * @param {string} command Executable.
 * @param {string[]} args Arguments.
 * @param {ICommandOptions} [options] Child execution context.
 * @returns {Promise<IGateResult>} Actual result, retained until the stable summary is printed.
 */
export const runGate = async (name, policy, command, args, options = {}) => {
  console.log(text.gate(name))
  /** Match Makefile's integer elapsed-second result format. */
  const started = Math.floor(Date.now() / 1000)
  /** Only the warning policy may downgrade a real nonzero child exit. */
  const code = await runCommand(command, args, options)
  return {
    name,
    code,
    state: code === 0 ? GateState.pass : policy === 'warning' ? GateState.warning : GateState.fail,
    seconds: Math.floor(Date.now() / 1000) - started
  }
}

/**
 * Print results in declaration order after all deferred package tests have finished.
 *
 * @param {IGateResult[]} results Ordered gate results.
 * @returns {number} The existing finish_ci success/failure status.
 */
export const printSummary = (results) => {
  console.log(text.summary)
  for (const result of results) console.log(text.result(result))
  /** Required failures and blocking skips alone determine the final status. */
  const failed = results.filter(
    ({ state }) => state === GateState.fail || state === GateState.skipBlocking
  ).length
  /** Successful gates retain the original separate pass count. */
  const passed = results.filter(({ state }) => state === GateState.pass).length
  console.log(text.counts(passed, failed, results.length - failed - passed))
  return failed ? 1 : 0
}

/**
 * Allocate the global pool budget and a fresh capture root retained for later custody signing.
 *
 * @returns {ICiRuntime} Shared worker and raw-report context.
 * @throws {Error} CI_JOBS is explicitly set to an invalid value.
 */
export const createRuntime = () => {
  /** CPU availability respects the current host's process affinity limits. */
  const cores = availableParallelism()
  /** Explicit CI_JOBS may trade parallelism for memory without changing test semantics. */
  const jobs = process.env.CI_JOBS === undefined ? cores : Number(process.env.CI_JOBS)
  if (!Number.isSafeInteger(jobs) || jobs < 1) throw new Error(text.invalidJobs)
  /** Reports survive successful CI so the signed candidate can reuse the exact same capture. */
  const reportRoot = mkdtempSync(join(tmpdir(), 'migai-ci-coverage-'))
  /** Ordinary tests share the pool's CPU budget; the tray package keeps its existing single worker. */
  const workers = Math.max(1, Math.floor(cores / jobs))
  /** Child Make targets and custody receive only this invocation's reports. */
  const env = {
    ...process.env,
    CI: 'true',
    PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false',
    [CI_COVERAGE_REPORT_ENV]: reportRoot
  }
  console.log(text.jobs(jobs, workers))
  console.log(text.report(reportRoot))
  return { jobs, workers, reportRoot, env }
}

/**
 * Dispatch independent package jobs without multiplying each job's nested worker count.
 *
 * @template T
 * @param {T[]} entries Jobs in stable declaration order.
 * @param {number} jobs Maximum simultaneous jobs.
 * @param {(entry: T) => Promise<void>} execute Existing package gate chain.
 * @returns {Promise<void>} Resolves after every independent job completes.
 */
export const runPool = async (entries, jobs, execute) => {
  /** Every worker takes the next index synchronously before awaiting its package chain. */
  let next = 0
  /** A worker continues after a gate failure because gate results never reject for child exits. */
  const worker = async () => {
    while (next < entries.length) {
      /** The index advances once before control yields to another worker. */
      const entry = entries[next++]
      await execute(entry)
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, entries.length) }, worker))
}

/**
 * Capture the original custody V8 command while retaining package-owned release test arguments.
 *
 * @param {string} name Package owner.
 * @param {ICiRuntime} runtime Current capture root and worker budget.
 * @returns {Promise<IGateResult>} The package test's native child status.
 */
const captureTest = async (name, runtime) => {
  /** Each package's existing coverage invocation owns its complete test inventory. */
  const args = coverageArguments(name, runtime.reportRoot)
  args.push(`--maxWorkers=${name === 'tray' ? 1 : runtime.workers}`)
  /** Exit markers prevent custody from retrying failed captures merely because V8 wrote JSON. */
  const result = await runGate(`${name}/test`, 'required', 'pnpm', args, {
    env: runtime.env,
    log: join(runtime.reportRoot, `${name}-capture.log`)
  })
  mkdirSync(join(runtime.reportRoot, name), { recursive: true })
  writeFileSync(join(runtime.reportRoot, name, CAPTURE_EXIT_CODE_FILE), `${result.code}\n`)
  return result
}

/**
 * Run mandatory format/types in their original package order; RPC tests wait for the family phase.
 *
 * @param {IPackageResult} result Mutable results owned by one package job.
 * @param {ICiRuntime} runtime Child environment and worker budget.
 * @returns {Promise<void>} Resolves after the prefix and, for ordinary owners, the complete chain.
 */
const beginPackage = async (result, runtime) => {
  await runStaticGates(result, runtime)
  if (result.family) return
  result.gates.push(
    Object.hasOwn(NON_V8_PACKAGES, result.name)
      ? await runGate(
          `${result.name}/test`,
          'required',
          'pnpm',
          ['--filter', `./packages/${result.name}`, 'run', 'test'],
          { env: runtime.env }
        )
      : await captureTest(result.name, runtime)
  )
  await finishPackage(result, runtime)
}

/**
 * Run one package's static gates: format check, lint, typecheck and every `typecheck:*` script.
 * Full CI runs them before the package test; fast mode runs only these.
 *
 * @param {IPackageResult} result Mutable results owned by one package job.
 * @param {ICiRuntime} runtime Child environment.
 * @returns {Promise<void>} Resolves after the last static gate.
 */
const runStaticGates = async (result, runtime) => {
  /** Optional typecheck scripts are discovered exactly as release-check already does. */
  const manifest = readPackageManifest(result.name)
  console.log(text.package(result.name))
  result.started = Date.now()
  result.gates.push(
    await runGate(
      `${result.name}/fmt`,
      'required',
      'make',
      ['--no-print-directory', 'fmt-check', `DIRECTORY=./packages/${result.name}`],
      { env: runtime.env }
    )
  )
  for (const gate of [
    'lint',
    'typecheck',
    ...Object.keys(manifest.scripts ?? {})
      .filter((name) => name.startsWith('typecheck:'))
      .sort()
  ])
    result.gates.push(
      await runGate(
        `${result.name}/${gate}`,
        'required',
        'pnpm',
        turboGateArgs(result.name, gate),
        { env: runtime.env }
      )
    )
  result.finished = Date.now()
}

/**
 * Finish packed/browser gates after the package test, then assert build output instead of cleaning
 * it.
 *
 * @param {IPackageResult} result Package-owned ordered results.
 * @param {ICiRuntime} runtime Shared worker/report context.
 * @returns {Promise<void>} Resolves after all existing optional gates and the final freshness gate.
 * @throws {Error} A known packed script changed, requiring explicit review of preparation removal.
 */
const finishPackage = async (result, runtime) => {
  /** Manifest scripts remain the source of truth for optional release checks. */
  const manifest = readPackageManifest(result.name)
  for (const gate of ['test:packed', 'test:e2e']) {
    if (!manifest.scripts?.[gate]) continue
    /** Only scripts listed in `packedCommands` have a preparation prefix eligible for removal. */
    const packed = gate === 'test:packed' ? packedCommands[result.name] : null
    if (packed) {
      if (manifest.scripts[gate] !== packed[0]) throw new Error(text.packedChanged(result.name))
      /** Pnpm preserves the original script PATH for compilers launched from temporary consumers. */
      const command = packed[1] === 'node' ? 'pnpm' : packed[1]
      /**
       * The storage-plugin-browser narrow packed run must not overwrite the full unit's coverage
       * reports.
       */
      const args = packed[1] === 'node' ? ['exec', ...packed.slice(1)] : packed.slice(2)
      if (result.name === 'storage-plugin-browser')
        args.push(
          `--maxWorkers=${runtime.workers}`,
          `--coverage.reportsDirectory=${join(runtime.reportRoot, 'storage-plugin-browser-packed')}`
        )
      result.gates.push(
        await runGate(`${result.name}/${gate}`, 'required', command, args, {
          cwd: join(repositoryRoot, 'packages', result.name),
          env: runtime.env
        })
      )
    } else {
      /** Playwright shares the same nested worker budget as ordinary Vitest jobs. */
      const args = ['--filter', `./packages/${result.name}`, 'run', gate]
      if (gate === 'test:e2e') args.push('--workers=1')
      result.gates.push(
        await runGate(`${result.name}/${gate}`, 'required', 'pnpm', args, { env: runtime.env })
      )
    }
  }
  result.gates.push(
    await runGate(
      `${result.name}/build`,
      'required',
      'node',
      [join(repositoryRoot, 'scripts/dist-stamp.mjs'), 'assert'],
      { cwd: join(repositoryRoot, 'packages', result.name), env: runtime.env }
    )
  )
  result.finished = Date.now()
}

/**
 * Run the existing family config once and attribute failed files only to their actual test owners.
 *
 * @param {IPackageResult[]} packages Packages whose deferred test rows must be completed.
 * @param {ICiRuntime} runtime Fresh invocation report root.
 * @returns {Promise<void>} Resolves after capture evidence and every deferred package tail are
 *   complete.
 */
const captureFamily = async (packages, runtime) => {
  console.log(text.family)
  /** JSON test results supply evidence for owner-specific failures without guessing from stderr. */
  const resultsPath = join(runtime.reportRoot, 'rpc-family-tests.json')
  /** The family config owns its shared worker budget and large-frame serialization. */
  const args = [
    ...coverageArguments(RPC_COVERAGE_FAMILY.unit, runtime.reportRoot),
    '--reporter=default',
    '--reporter=json',
    `--outputFile.json=${resultsPath}`
  ]
  /** Family capture time belongs to the existing package test rows rather than a new root gate. */
  const started = Math.floor(Date.now() / 1000)
  /** Its actual exit marker leaves threshold or unattributed runner failures owned by custody. */
  const code = await runCommand('pnpm', args, {
    env: runtime.env,
    log: join(runtime.reportRoot, 'rpc-family-capture.log')
  })
  /** Packed/browser tails must not inflate subsequent owners' shared capture elapsed time. */
  const seconds = Math.floor(Date.now() / 1000) - started
  mkdirSync(join(runtime.reportRoot, RPC_COVERAGE_FAMILY.unit), { recursive: true })
  writeFileSync(
    join(runtime.reportRoot, RPC_COVERAGE_FAMILY.unit, CAPTURE_EXIT_CODE_FILE),
    `${code}\n`
  )
  /** Vitest still emits JSON after an assertion failure; absent JSON means no owner evidence exists. */
  const testResults = existsSync(resultsPath)
    ? (JSON.parse(readFileSync(resultsPath, 'utf8')).testResults ?? [])
    : []
  for (const result of packages) {
    /** Only a failed file under the actual package can make that package's test row fail. */
    const failed = testResults.some((entry) => {
      /** Keep the ordinary package gate's original executed-file scope within the broader family. */
      const path = entry.name.replaceAll('\\', '/')
      return (
        entry.status === 'failed' &&
        path.includes(`/packages/${result.name}/`) &&
        !familyOnlyTestFile.test(path)
      )
    })
    result.gates.push({
      name: `${result.name}/test`,
      state: failed ? GateState.fail : GateState.pass,
      code: failed ? code || 1 : 0,
      seconds
    })
    await finishPackage(result, runtime)
  }
  if (code !== 0) console.error(text.familyFailure(code))
}

/**
 * Run timing-sensitive package chains serially first, then the ordinary pool. The one RPC family
 * capture starts once every family owner prefix is done and at most two ordinary chains remain.
 *
 * @param {string[]} names Existing package declaration order.
 * @param {ICiRuntime} runtime Global job budget.
 * @param {{
 *   onFamilyReady?: () => void
 *   onPoolDrained?: () => Promise<void>
 *   partialFamilyAlone?: boolean
 * }} [hooks]
 *   `onFamilyReady` runs synchronously as the family capture starts; `onPoolDrained` is root work
 *   started once the ordinary pool drains and may overlap the capture and its tails.
 *   `partialFamilyAlone` (family CI) tests RPC owners with their own package configs unless every
 *   runtime owner is selected, so a dependency such as `rpc-contract` does not pull in the whole
 *   family capture.
 * @returns {Promise<IPackageResult[]>} Complete ordered package results; summaries never precede
 *   deferred tests or the drained-pool callback.
 */
export const runPackages = async (names, runtime, hooks = {}) => {
  /** Package maps prevent duplicate selected owners from running a second capture. */
  /** Unique selection, so a duplicated owner never runs a second capture. */
  const unique = [...new Set(names)]
  /** Whether selected RPC owners share one capture; always true outside family CI. */
  const shareCapture =
    !hooks.partialFamilyAlone ||
    RPC_COVERAGE_FAMILY.runtimeOwners.every((owner) => unique.includes(owner))
  const results = unique.map((name) => {
    if (!existsSync(join(repositoryRoot, 'packages', name, 'package.json')))
      throw new Error(text.missingPackage(name))
    return {
      name,
      gates: [],
      started: 0,
      finished: 0,
      family: shareCapture && familyOwners.includes(name)
    }
  })
  for (const result of results.filter(({ name }) => exclusivePackages.includes(name)))
    await beginPackage(result, runtime)
  /** Every remaining package chain keeps the original ordinary pool budget. */
  const ordinary = results.filter(({ name }) => !exclusivePackages.includes(name))
  /** The integration owner participates through the family config even when not publishable. */
  const family = results.filter((result) => result.family)
  /** Queued and running non-family chains; capture may overlap only the last few of them. */
  let ordinaryRemaining = ordinary.length - family.length
  /** Family owners whose format/lint/typecheck prefix has not finished yet. */
  let familyPrefixesRemaining = family.length
  /** Resolved by the first pool completion that satisfies the overlap rule; later resolves no-op. */
  const familyReady = Promise.withResolvers()
  /** Capture keeps the original coverage unit, failure ownership and post-capture package tails. */
  const familyCapture = family.length
    ? familyReady.promise.then(() => {
        hooks.onFamilyReady?.()
        return captureFamily(family, runtime)
      })
    : Promise.resolve()
  /** Root work waits for the whole ordinary pool, never for the family capture. */
  const pool = runPool(ordinary, runtime.jobs, async (result) => {
    await beginPackage(result, runtime)
    if (result.family) familyPrefixesRemaining -= 1
    else ordinaryRemaining -= 1
    if (familyPrefixesRemaining === 0 && ordinaryRemaining <= familyOverlapChains)
      familyReady.resolve()
  }).then(() => hooks.onPoolDrained?.())
  await Promise.all([pool, familyCapture])
  for (const result of results) printSummary(result.gates)
  return results
}

/**
 * List conformance peer executables missing from the inherited toolchain PATH.
 *
 * @returns {Promise<string[]>} Missing tool names; empty when conformance may run.
 */
const missingConformanceTools = async () => {
  /** Tools whose `command -v` lookup failed, in declaration order. */
  const missing = []
  for (const tool of conformanceTools)
    if (
      (await runCommand('/bin/sh', [
        '-c',
        'command -v "$1" >/dev/null 2>&1',
        'ci-tool-check',
        tool
      ])) !== 0
    )
      missing.push(tool)
  return missing
}

/**
 * Create the conformance gate: concurrent whole-file lanes behind one required summary row. Each
 * lane runs the package's original `test:conformance` script (serial files, one worker) with a
 * private TMPDIR and RPC_H_EVIDENCE, so native peer builds and evidence files never collide. Early
 * lanes may start before the rest; every lane starts at most once.
 *
 * @param {ICiRuntime} runtime Child environment.
 * @returns {{ startEarly: () => void; finish: () => Promise<IGateResult> }} `startEarly` launches
 *   the early lanes; `finish` launches the rest, waits for every lane and returns one
 *   `rpc/test:conformance` result whose code is the first nonzero lane exit.
 */
const createConformanceGate = (runtime) => {
  /** Native exit promise of each launched lane, keyed by lane id. */
  const lanes = new Map()
  /** Row start in Makefile's integer seconds, set when the first lane launches. */
  let started = 0
  /**
   * Launch one lane unless it is already running.
   *
   * @param {(typeof conformanceLanes)[number]} lane Lane definition.
   * @returns {Promise<number>} The lane's native exit code.
   */
  const start = (lane) => {
    if (!lanes.has(lane.id)) {
      if (!started) {
        console.log(text.gate(GateName.conformance))
        started = Math.floor(Date.now() / 1000)
      }
      /** Persistent lane root; the native wrappers still decide freshness and rebuilds. */
      const temporaryDirectory = `${conformanceTemporaryPrefix}-${lane.id}`
      mkdirSync(temporaryDirectory, { recursive: true })
      lanes.set(
        lane.id,
        runCommand(
          'pnpm',
          ['--filter', './packages/rpc-integration', 'run', 'test:conformance', ...lane.args],
          {
            env: {
              ...runtime.env,
              TMPDIR: temporaryDirectory,
              RPC_H_EVIDENCE: join(temporaryDirectory, 'h-evidence')
            }
          }
        )
      )
    }
    return lanes.get(lane.id)
  }
  return {
    startEarly: () => {
      for (const lane of conformanceLanes) if (lane.early) start(lane)
    },
    finish: async () => {
      /** Native lane exits in declaration order, independent of completion order. */
      const codes = await Promise.all(conformanceLanes.map(start))
      /** Any failing lane fails the single required row with its own native code. */
      const code = codes.find((value) => value !== 0) ?? 0
      return {
        name: GateName.conformance,
        code,
        state: code === 0 ? GateState.pass : GateState.fail,
        seconds: Math.floor(Date.now() / 1000) - started
      }
    }
  }
}

/**
 * Aggregate a release-check using the same failure status produced by its former Make target.
 *
 * @param {IPackageResult} result Complete package gates.
 * @returns {IGateResult} One release-check row for the group summary.
 */
const packageSummary = (result) => ({
  name: `${result.name}/release-check`,
  state: result.gates.some(({ state }) => state === GateState.fail)
    ? GateState.fail
    : GateState.pass,
  code: result.gates.some(({ state }) => state === GateState.fail) ? 2 : 0,
  seconds: Math.floor((result.finished - result.started) / 1000)
})

/**
 * Record a ship/store group after every deferred test completes, preserving declaration order.
 *
 * @param {string} name Existing top-level group gate.
 * @param {string[]} names Packages declared by Makefile.
 * @param {IPackageResult[]} packages Completed package results.
 * @returns {IGateResult} Existing group result with the original Make aggregate failure code.
 */
const groupSummary = (name, names, packages) => {
  /** Pool completion order must not reorder the visible release plan. */
  const members = names
    .map((member) => packages.find((result) => result.name === member))
    .filter(Boolean)
  /** Each group retains its own release-check summary, just as the nested Make target did. */
  const results = members.map(packageSummary)
  /** Group duration is its actual span in the shared package pool. */
  const seconds = members.length
    ? Math.floor(
        (Math.max(...members.map(({ finished }) => finished)) -
          Math.min(...members.map(({ started }) => started))) /
          1000
      )
    : 0
  return {
    name,
    state: printSummary(results) ? GateState.fail : GateState.pass,
    code: results.some(({ code }) => code !== 0) ? 2 : 0,
    seconds
  }
}

/**
 * Finish an admitted conformance gate, or report the missing peer toolchains as a skip row whose
 * policy follows `CI_ALLOW_MISSING_TOOLCHAINS`.
 *
 * @param {ReturnType<typeof createConformanceGate> | undefined} conformance Admitted gate.
 * @param {string[]} missingTools Missing peer executables when the gate was not admitted.
 * @returns {Promise<IGateResult>} The conformance row.
 */
const finishConformance = (conformance, missingTools) =>
  conformance
    ? conformance.finish()
    : Promise.resolve({
        name: text.missingTools(missingTools),
        code: process.env.CI_ALLOW_MISSING_TOOLCHAINS === '1' ? 0 : 1,
        state:
          process.env.CI_ALLOW_MISSING_TOOLCHAINS === '1'
            ? GateState.skipWarning
            : GateState.skipBlocking,
        seconds: 0
      })

/**
 * Run the RPC suite-parity check owned by the integration package.
 *
 * @param {ICiRuntime} runtime Invocation context.
 * @returns {Promise<IGateResult>} The `rpc/test:suite-parity` row.
 */
const runParity = (runtime) =>
  runGate(
    GateName.parity,
    'required',
    'pnpm',
    ['--filter', './packages/rpc-integration', 'run', 'test:suite-parity'],
    { env: runtime.env }
  )

/**
 * Reject an application list naming a directory without a manifest, before any gate runs, so a typo
 * fails fast instead of aborting CI after the package pool.
 *
 * @param {string[]} apps Application directory names under `apps/`.
 * @returns {void}
 * @throws {Error} A listed application has no manifest.
 */
const assertApps = (apps) => {
  for (const name of apps)
    if (!existsSync(join(repositoryRoot, 'apps', name, 'package.json')))
      throw new Error(text.missingApp(name))
}

/**
 * Run every application's gates in order. Applications consume the workspace build but own no build
 * output or coverage unit, so their gates are their own scripts, run through pnpm.
 *
 * @param {string[]} apps Application directory names under `apps/`.
 * @param {ICiRuntime} runtime Invocation context.
 * @param {readonly string[]} [gates] Gates to run; fast mode passes `appFastGates`.
 * @returns {Promise<IGateResult[]>} Ordered `app/gate` rows; a missing script is a blocking skip,
 *   matching ci-fast.
 */
const runAppGates = async (apps, runtime, gates = appGates) => {
  /** Rows in application, then gate order. */
  const results = []
  for (const name of apps) {
    /** Directory relative to the repository root, as Make and pnpm filters expect it. */
    const directory = `./apps/${name}`
    /** Scripts decide which gates exist, as for packages. */
    const scripts = JSON.parse(
      readFileSync(join(repositoryRoot, directory, 'package.json'), 'utf8')
    ).scripts
    for (const gate of gates) {
      /** Visible row name keeps the apps/ prefix so it never collides with a package row. */
      const row = `apps/${name}/${gate}`
      if (!scripts?.[gate]) {
        results.push({ name: row, state: GateState.skipBlocking, code: 1, seconds: 0 })
        continue
      }
      results.push(
        gate === 'fmt'
          ? await runGate(
              row,
              'required',
              'make',
              ['--no-print-directory', 'fmt-check', `DIRECTORY=${directory}`],
              { env: runtime.env }
            )
          : await runGate(row, 'required', 'pnpm', ['--filter', directory, 'run', gate], {
              env: runtime.env
            })
      )
    }
  }
  return results
}

/**
 * Execute repository gates and the maintained documentation examples after the preparation build.
 *
 * @param {string[]} releasePackages Existing foundation release plan.
 * @param {string[]} storePackages Existing store release plan.
 * @param {ICiRuntime} runtime Invocation context.
 * @param {ICiScope} [scope] Affected mode selects RPC and website gates; full CI retains both.
 * @param {ICiExtra} [extra] Unreleased part packages (package pool) and applications (root rows).
 * @returns {Promise<number>} Existing finish_ci blocking status.
 */
export const runCi = async (
  releasePackages,
  storePackages,
  runtime,
  scope = { rpc: true, website: true },
  extra = { part: [], apps: [] }
) => {
  assertApps(extra.apps)
  /** Root rows stay in their old order even though both package groups now share one pool. */
  const results = []
  results.push(
    await runGate(GateName.build, 'required', 'pnpm', [...workspaceBuildArgs], { env: runtime.env })
  )
  for (const name of [GateName.dependencies, GateName.release])
    results.push(
      await runGate(name, 'required', 'make', ['--no-print-directory', name], { env: runtime.env })
    )
  /** Root rows execute early but keep their original summary position after the groups. */
  const rootResults = []
  /** Tail rows run inside the root callback but keep their original post-custody positions. */
  const conformanceResults = []
  /** Suite-parity row, executed alongside conformance. */
  const parityResults = []
  /** Website rows in their original fmt, lint, typecheck, test order. */
  const websiteResults = []
  /** Application rows; they run after the root fixture gates, before the overlapping tails. */
  const appResults = []
  /** Peer tools missing for conformance; an empty list admits the gate. */
  const missingTools = scope.rpc ? await missingConformanceTools() : []
  /** Admitted conformance gate; its early lane starts with the RPC family capture. */
  const conformance = scope.rpc && !missingTools.length ? createConformanceGate(runtime) : undefined
  /** All readers begin only after the one topological workspace build has finished. */
  const packages = await runPackages(
    [...releasePackages, ...storePackages, ...extra.part],
    runtime,
    {
      onFamilyReady: () => conformance?.startEarly(),
      onPoolDrained: async () => {
        for (const name of [GateName.registry, GateName.consumers])
          rootResults.push(
            await runGate(name, 'required', 'pnpm', ['run', name], { env: runtime.env })
          )
        rootResults.push(
          await runGate(
            GateName.docs,
            'required',
            'node',
            ['scripts/check-docs-independence.mjs'],
            {
              env: runtime.env
            }
          )
        )
        rootResults.push(
          await runGate(
            GateName.docsExamples,
            'required',
            'make',
            ['--no-print-directory', 'docs-examples'],
            {
              env: runtime.env
            }
          )
        )
        for (const name of rootTestGates)
          rootResults.push(
            await runGate(name, 'required', 'pnpm', ['run', name], { env: runtime.env })
          )
        appResults.push(...(await runAppGates(extra.apps, runtime)))
        /** Conformance, suite-parity and the website chain share no inputs, so they overlap. */
        await Promise.all([
          scope.rpc &&
            finishConformance(conformance, missingTools).then((result) =>
              conformanceResults.push(result)
            ),
          scope.rpc && runParity(runtime).then((result) => parityResults.push(result)),
          scope.website &&
            (async () => {
              for (const gate of ['fmt', 'lint', 'typecheck'])
                websiteResults.push(
                  await runGate(
                    `website/${gate}`,
                    'required',
                    'make',
                    ['--no-print-directory', 'ci-website-check', `GATE=${gate}`],
                    { env: runtime.env }
                  )
                )
              websiteResults.push(
                await runGate(
                  'website/test',
                  'warning',
                  'make',
                  ['--no-print-directory', 'ci-website-test'],
                  {
                    env: runtime.env
                  }
                )
              )
            })()
        ])
      }
    }
  )
  if (releasePackages.length) results.push(groupSummary(GateName.ship, releasePackages, packages))
  if (storePackages.length) results.push(groupSummary(GateName.store, storePackages, packages))
  if (extra.part.length) results.push(groupSummary(GateName.part, extra.part, packages))
  results.push(...rootResults, ...appResults)
  /** Custody starts only after every capture, exit marker and family tail has completed. */
  results.push(
    await runGate(GateName.custody, 'required', 'node', ['scripts/coverage-custody.mjs'], {
      env: runtime.env
    })
  )
  results.push(...conformanceResults, ...parityResults, ...websiteResults)
  return printSummary(results)
}

/**
 * Read installed pnpm workspace metadata without creating a second dependency graph.
 *
 * @param {string[]} filters Pnpm selectors whose union determines the current project list.
 * @returns {IWorkspaceProject[]} Workspace names and absolute paths.
 */
const listProjects = (filters = []) =>
  JSON.parse(
    execFileSync(
      'pnpm',
      [
        ...(filters.length ? filters.flatMap((filter) => ['--filter', filter]) : ['-r']),
        'list',
        '--depth',
        '-1',
        '--json'
      ],
      { cwd: repositoryRoot, encoding: 'utf8' }
    )
  )

/**
 * Use pnpm's Git dependent selector, adding selectors only for untracked project inputs.
 *
 * @param {string[]} release Foundation release inventory owned by Makefile.
 * @param {string[]} store Store release inventory owned by Makefile.
 * @param {ICiExtra} unreleased Part package and application inventories owned by Makefile.
 * @returns {{
 *   release: string[]
 *   store: string[]
 *   extra: ICiExtra
 *   scope: ICiScope
 *   empty: boolean
 * }}
 *   Selected gates.
 * @throws {Error} CI_BASE is empty or cannot resolve to a Git commit.
 */
const selectAffected = (release, store, unreleased) => {
  /** The default remains explicit; an empty configured base is not silently replaced. */
  const base = process.env.CI_BASE ?? 'origin/main'
  if (!base) throw new Error(text.invalidBase)
  execFileSync('git', ['rev-parse', '--verify', '--end-of-options', base + '^{commit}'], {
    cwd: repositoryRoot,
    stdio: 'pipe'
  })
  /** Git and pnpm compare the same ref; NUL separation preserves filenames with whitespace. */
  const tracked = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', '--end-of-options', base, '--'],
    { cwd: repositoryRoot, encoding: 'utf8' }
  )
    .split('\0')
    .filter(Boolean)
  /** Pnpm's ref selector omits these files, so their owning projects need extra selectors. */
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
  /** Shared-input changes widen this invocation, never the underlying release inventory. */
  const changed = [...new Set([...tracked, ...untracked])]
  console.log(text.affected(base))
  if (!changed.length) {
    console.log(text.emptyDiff)
    return {
      release: [],
      store: [],
      extra: { part: [], apps: [] },
      scope: { rpc: false, website: false },
      empty: true
    }
  }
  /** The short fallback list is a CI policy; package consumers remain pnpm's responsibility. */
  const shared = changed.filter(
    (path) =>
      sharedInputPaths.has(path) ||
      path.startsWith('scripts/') ||
      (!path.includes('/') && rootToolConfig.test(path))
  )
  if (shared.length) {
    console.log(text.fallback(shared))
    console.log(
      text.selection([
        ...release,
        ...store,
        ...unreleased.part,
        ...unreleased.apps.map((name) => 'apps/' + name)
      ])
    )
    return { release, store, extra: unreleased, scope: { rpc: true, website: true }, empty: false }
  }
  /** Longest paths distinguish nested projects without treating the repository root as an owner. */
  const inventory = listProjects()
    .filter((project) => resolve(project.path) !== repositoryRoot)
    .sort((left, right) => right.path.length - left.path.length)
  /** Extra selectors use declared project names, leaving reverse closure traversal to pnpm. */
  const extra = new Set()
  for (const path of untracked) {
    /** An ignored file cannot enter this list; only the current workspace owner is added. */
    const absolute = resolve(repositoryRoot, path)
    /** Projects are provided by pnpm, including the website and any current app workspace. */
    const owner = inventory.find((project) => absolute.startsWith(resolve(project.path) + sep))
    if (owner) extra.add('...' + owner.name)
  }
  /** Multiple pnpm filters form a union, including each changed package and its dependents. */
  const selected = listProjects(['...[' + base + ']', ...extra])
  /** Repository-relative project paths, used to bind selection to the Makefile lists. */
  const paths = selected.map((project) =>
    relative(repositoryRoot, project.path).split(sep).join('/')
  )
  /** Directory names bind selection to the existing Makefile release lists. */
  const names = new Set(
    paths
      .filter((path) => /^packages\/[^/]+$/.test(path))
      .map((path) => path.slice('packages/'.length))
  )
  /** Selected application directory names. */
  const appNames = new Set(
    paths.filter((path) => /^apps\/[^/]+$/.test(path)).map((path) => path.slice('apps/'.length))
  )
  /** The website generator documents every current library, excluding the integration-only owner. */
  const website =
    selected.some((project) => resolve(project.path) === join(repositoryRoot, 'website')) ||
    [...names].some((name) => name !== RPC_COVERAGE_FAMILY.runner)
  console.log(text.selection([...names, ...[...appNames].map((name) => 'apps/' + name)]))
  console.log(text.selectionReason)
  return {
    release: release.filter((name) => names.has(name)),
    store: store.filter((name) => names.has(name)),
    extra: {
      part: unreleased.part.filter((name) => names.has(name)),
      apps: unreleased.apps.filter((name) => appNames.has(name))
    },
    scope: { rpc: [...names].some((name) => name.startsWith('rpc-')), website },
    empty: false
  }
}

/**
 * Resolve one family to its members and their workspace dependency closure.
 *
 * @param {string} name Family key from `ciFamilies`.
 * @returns {IFamilySelection} Package and app directory names in pnpm's order, plus the pnpm
 *   `<name>...` selectors that build the closure.
 * @throws {Error} Unknown family name.
 */
const selectFamily = (name) => {
  /** Family definition; unknown names fail before any command runs. */
  const family = Object.hasOwn(ciFamilies, name) ? ciFamilies[name] : undefined
  if (!family) throw new Error(text.unknownFamily(name))
  /** Every workspace project with a repository-relative directory. */
  const projects = listProjects().map((project) => ({
    name: project.name,
    path: relative(repositoryRoot, project.path).split(sep).join('/')
  }))
  /** `<name>...` selects a member and all of its workspace dependencies. */
  const filters = projects
    .filter(({ path }) =>
      family.prefixes.some(
        (prefix) => path.startsWith('packages/' + prefix) || path.startsWith('apps/' + prefix)
      )
    )
    .map((project) => project.name + '...')
  /** Closure paths reported by pnpm for the union of member selectors. */
  const closure = listProjects(filters).map((project) =>
    relative(repositoryRoot, project.path).split(sep).join('/')
  )
  return {
    packages: directoryNames(closure, 'packages/'),
    apps: directoryNames(closure, 'apps/'),
    filters
  }
}

/**
 * Keep direct children of one workspace root and return their sorted directory names.
 *
 * @param {string[]} paths Repository-relative project paths.
 * @param {string} root `packages/` or `apps/`.
 * @returns {string[]} Directory names in pnpm's listing order.
 */
const directoryNames = (paths, root) =>
  paths
    .filter((path) => path.startsWith(root) && !path.slice(root.length).includes('/'))
    .map((path) => path.slice(root.length))

/**
 * Run one family's CI. Fast mode runs the static gates of every closure package and app without a
 * build. Full mode builds the closure, runs every package chain (RPC owners share the family
 * capture only when all runtime owners are selected), then the app gates and, for `rpc`, the
 * conformance and suite-parity gates. Coverage custody and other repository gates stay in full CI.
 *
 * @param {string} name Family key.
 * @param {IFamilySelection} selection Resolved closure.
 * @param {boolean} fast Whether to run only static gates.
 * @param {ICiRuntime} runtime Invocation context.
 * @returns {Promise<number>} Blocking status.
 */
const runFamily = async (name, selection, fast, runtime) => {
  for (const member of selection.packages)
    if (!existsSync(join(repositoryRoot, 'packages', member, 'package.json')))
      throw new Error(text.missingPackage(member))
  assertApps(selection.apps)
  if (fast) {
    /** Static rows per package, in closure order. */
    const results = selection.packages.map((member) => ({
      name: member,
      gates: [],
      started: 0,
      finished: 0,
      family: false
    }))
    await runPool(results, runtime.jobs, (result) => runStaticGates(result, runtime))
    /** App rows run after the package pool, in app order. */
    const appResults = await runAppGates(selection.apps, runtime, appFastGates)
    return printSummary([...results.flatMap((result) => result.gates), ...appResults])
  }
  /** The closure build; readers below need its output. */
  const build = await runGate(
    `${name}/build`,
    'required',
    'pnpm',
    [
      '-r',
      '--workspace-concurrency=2',
      ...selection.filters.flatMap((filter) => ['--filter', filter]),
      'run',
      'build'
    ],
    { env: runtime.env }
  )
  if (build.code !== 0) return printSummary([build])
  /** Whether this family owns the RPC conformance and suite-parity gates. */
  const rpc = ciFamilies[name].rpc
  /** Peer tools missing for conformance; an empty list admits the gate. */
  const missingTools = rpc ? await missingConformanceTools() : []
  /** Admitted conformance gate; its early lane starts with the RPC family capture. */
  const conformance = rpc && !missingTools.length ? createConformanceGate(runtime) : undefined
  /** Rows produced once the package pool drains. */
  const tailRows = []
  /** Completed package results, summarized one row per package. */
  const packages = await runPackages(selection.packages, runtime, {
    partialFamilyAlone: true,
    onFamilyReady: () => conformance?.startEarly(),
    onPoolDrained: async () => {
      tailRows.push(...(await runAppGates(selection.apps, runtime)))
      if (rpc)
        tailRows.push(
          ...(await Promise.all([finishConformance(conformance, missingTools), runParity(runtime)]))
        )
    }
  })
  return printSummary([build, ...packages.map(packageSummary), ...tailRows])
}

/**
 * List the actual root gate plan before any build, test or capture directory is created.
 *
 * @param {string[]} release Selected foundation packages.
 * @param {string[]} store Selected Store packages.
 * @param {ICiScope} scope RPC and website consumers enabled by this selection.
 * @param {ICiExtra} extra Selected part packages and applications.
 * @returns {void}
 */
const printPlan = (release, store, scope, extra) => {
  /** Registry and custody remain full checks even when release checks select only affected owners. */
  const gates = [
    GateName.build,
    GateName.dependencies,
    GateName.release,
    ...(release.length ? [GateName.ship] : []),
    ...(store.length ? [GateName.store] : []),
    ...(extra.part.length ? [GateName.part] : []),
    GateName.registry,
    GateName.consumers,
    GateName.docs,
    ...rootTestGates,
    ...extra.apps.flatMap((name) => appGates.map((gate) => `apps/${name}/${gate}`)),
    GateName.custody,
    ...(scope.rpc ? [GateName.conformance, GateName.parity] : []),
    ...(scope.website ? ['website/fmt', 'website/lint', 'website/typecheck', 'website/test'] : [])
  ]
  console.log(text.plan(gates))
}

/**
 * Prepare standalone ship/store checks without cleaning output while package readers are running.
 *
 * @param {ICiRuntime} runtime Child environment.
 * @returns {Promise<number>} Native preparation build exit code, or zero when already fresh.
 * @throws {Error} A freshness failure other than the existing stale-output condition.
 */
const preparePackages = async (runtime) => {
  try {
    assertAllFresh()
    return 0
  } catch (error) {
    if (error?.code !== DistStampErrorCode.stale) throw error
    console.log(text.preparation)
    return runCommand('pnpm', [...workspaceBuildArgs], { env: runtime.env })
  }
}

/**
 * Parse the small Makefile CLI and preserve package declaration order.
 *
 * @param {string[]} argv Mode and explicit package-list options.
 * @returns {{
 *   mode: string
 *   release: string[]
 *   store: string[]
 *   part: string[]
 *   apps: string[]
 *   packages: string[]
 *   family: string[]
 *   fast: boolean
 * }}
 *   Resolved command.
 * @throws {Error} Unsupported mode, option or missing option value.
 */
const parseArguments = (argv) => {
  /** Make passes each package list as one argument, avoiding shell splitting inside this module. */
  const [mode, ...args] = argv
  if (mode !== 'ci' && mode !== 'packages' && mode !== 'affected' && mode !== 'family')
    throw new Error(text.invalidArguments)
  /** The accepted lists are explicit inputs rather than a second release inventory. */
  const options = {
    release: [],
    store: [],
    part: [],
    apps: [],
    packages: [],
    family: [],
    fast: false
  }
  /** Cursor over the remaining arguments; `--fast` takes no value, every list option takes one. */
  let index = 0
  while (index < args.length) {
    if (args[index] === '--fast') {
      options.fast = true
      index += 1
      continue
    }
    /** An option without its full package-list argument cannot produce a trustworthy selection. */
    const key = args[index].slice(2)
    if (
      !args[index].startsWith('--') ||
      key === 'fast' ||
      !Object.hasOwn(options, key) ||
      args[index + 1] === undefined
    )
      throw new Error(text.invalidArguments)
    options[key] = args[index + 1].trim().split(/\s+/).filter(Boolean)
    index += 2
  }
  if ((mode === 'family') !== (options.family.length === 1) || (options.fast && mode !== 'family'))
    throw new Error(text.invalidArguments)
  return { mode, ...options }
}

/**
 * Family entrypoint: resolve the closure, print it, honour `CI_DRY_RUN`, then run.
 *
 * @param {string} name Family key.
 * @param {boolean} fast Whether to run only static gates.
 * @returns {Promise<number>} Blocking status.
 */
const mainFamily = async (name, fast) => {
  /** Closure resolution is read-only and precedes any report directory. */
  const selection = selectFamily(name)
  console.log(text.familySelection(name, selection.packages, selection.apps))
  if (process.env.CI_DRY_RUN === '1') {
    console.log(text.plan(familyPlan(name, selection, fast)))
    return 0
  }
  return runFamily(name, selection, fast, createRuntime())
}

/**
 * List a family's planned rows without running anything.
 *
 * @param {string} name Family key.
 * @param {IFamilySelection} selection Resolved closure.
 * @param {boolean} fast Whether only static gates run.
 * @returns {string[]} Row names in run order.
 */
const familyPlan = (name, selection, fast) =>
  fast
    ? [
        ...selection.packages.map((member) => member + '/static'),
        ...selection.apps.flatMap((app) => appFastGates.map((gate) => `apps/${app}/${gate}`))
      ]
    : [
        name + '/build',
        ...selection.packages.map((member) => member + '/release-check'),
        ...selection.apps.flatMap((app) => appGates.map((gate) => `apps/${app}/${gate}`)),
        ...(ciFamilies[name].rpc ? [GateName.conformance, GateName.parity] : [])
      ]

/**
 * Makefile entrypoint; reports every gate before returning the original aggregate blocking status.
 *
 * @param {string[]} argv CLI arguments.
 * @returns {Promise<number>} CI blocking status or standalone preparation failure.
 */
export const main = async (argv) => {
  /** Parse before creating reports so invalid invocations have no filesystem effect. */
  const options = parseArguments(argv)
  if (options.mode === 'family') return mainFamily(options.family[0], options.fast)
  /** Selection and dry-run are read-only and must precede raw report allocation. */
  const selection =
    options.mode === 'affected'
      ? selectAffected(options.release, options.store, {
          part: options.part,
          apps: options.apps
        })
      : {
          release: options.release,
          store: options.store,
          extra: { part: options.part, apps: options.apps },
          scope: { rpc: true, website: true },
          empty: false
        }
  if (selection.empty) return 0
  if (process.env.CI_DRY_RUN === '1') {
    if (options.mode === 'packages') console.log(text.selection(options.packages))
    else
      console.log(
        text.selection([
          ...selection.release,
          ...selection.store,
          ...selection.extra.part,
          ...selection.extra.apps.map((name) => 'apps/' + name)
        ])
      )
    if (options.mode === 'packages')
      console.log(text.plan(options.packages.map((name) => name + '/release-check')))
    else printPlan(selection.release, selection.store, selection.scope, selection.extra)
    return 0
  }
  /** One runtime owns the entire invocation's reports and nested worker budget. */
  const runtime = createRuntime()
  if (options.mode !== 'packages')
    return runCi(selection.release, selection.store, runtime, selection.scope, selection.extra)
  /** Standalone ship/store begins with fresh output, then never rebuilds inside package jobs. */
  const prepared = await preparePackages(runtime)
  if (prepared !== 0) return prepared
  /** Final summary has the same package/release-check rows as the old serial target. */
  const packages = await runPackages(options.packages, runtime)
  return printSummary(packages.map(packageSummary))
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      console.error(text.failure(error))
      process.exitCode = 1
    }
  )
