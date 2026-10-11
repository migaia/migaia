/** CI package scheduling; one preparation build feeds read-only release checks and custody. */
import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  appendFileSync
} from 'node:fs'
import { availableParallelism, constants, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
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
/** @typedef {{ name: string; gates: IGateResult[]; started: number; finished: number }} IPackageResult */
/** @typedef {{ jobs: number; workers: number; reportRoot: string; env: NodeJS.ProcessEnv }} ICiRuntime */
/** @typedef {{ cwd?: string; env?: NodeJS.ProcessEnv; log?: string }} ICommandOptions */

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
  registry: 'registry:check',
  consumers: 'typecheck:consumers',
  docs: 'check-docs-independence',
  custody: 'coverage-custody-report',
  conformance: 'rpc/test:conformance',
  parity: 'rpc/test:suite-parity'
})
/** Root fixture gates remain unchanged; this scheduler adds no testing surface. */
const rootTestGates = Object.freeze([
  'test:coverage-custody',
  'test:dist-stamp',
  'test:tree-shaking'
])
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
/** The measured plugin-host acceptance suite must never compete with another package check. */
const exclusivePackages = Object.freeze(['plugin-host'])
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
  'storage-contract': [
    'pnpm run build && node test/packed-export-smoke.mjs',
    'node',
    'test/packed-export-smoke.mjs'
  ],
  'store-persist': [
    'pnpm run build && node test/packed-export-smoke.mjs',
    'node',
    'test/packed-export-smoke.mjs'
  ],
  'storage-web': [
    'pnpm run build && vitest run test/bundle-boundary.spec.ts',
    'pnpm',
    'exec',
    'vitest',
    'run',
    'test/bundle-boundary.spec.ts'
  ]
})
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
    'usage: node scripts/ci-run.mjs ci --release "packages" --store "packages" | packages --packages "packages"',
  missingPackage: (name) => `unknown CI package: ${name}`,
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
    /** Forward each chunk to its original channel and the capture log, without buffering test output. */
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
  /** Logger's root test file was already part of release-check and must not be omitted. */
  const args = coverageArguments(name, runtime.reportRoot)
  if (name === 'logger') args.splice(args.indexOf('--coverage'), 0, 'logger.test.ts')
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
        ['--filter', `./packages/${result.name}`, 'run', gate],
        { env: runtime.env }
      )
    )
  if (familyOwners.includes(result.name)) return
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
    /** Only the six current release scripts have a preparation prefix eligible for removal. */
    const packed = gate === 'test:packed' ? packedCommands[result.name] : null
    if (packed) {
      if (manifest.scripts[gate] !== packed[0]) throw new Error(text.packedChanged(result.name))
      /** The storage-web narrow packed run must not overwrite the full unit's coverage reports. */
      const args = packed.slice(2)
      if (result.name === 'storage-web')
        args.push(
          `--maxWorkers=${runtime.workers}`,
          `--coverage.reportsDirectory=${join(runtime.reportRoot, 'storage-web-packed')}`
        )
      result.gates.push(
        await runGate(`${result.name}/${gate}`, 'required', packed[1], args, {
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
  /** The family config retains its existing maxWorkers=2 and large-frame serialization. */
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
 * Schedule ordinary packages first, then known timing-sensitive work and one RPC family capture.
 *
 * @param {string[]} names Existing package declaration order.
 * @param {ICiRuntime} runtime Global job budget.
 * @returns {Promise<IPackageResult[]>} Complete ordered package results; summaries never precede
 *   deferred tests.
 */
export const runPackages = async (names, runtime) => {
  /** Package maps prevent duplicate selected owners from running a second capture. */
  const results = [...new Set(names)].map((name) => {
    if (!existsSync(join(repositoryRoot, 'packages', name, 'package.json')))
      throw new Error(text.missingPackage(name))
    return { name, gates: [], started: 0, finished: 0 }
  })
  await runPool(
    results.filter(({ name }) => !exclusivePackages.includes(name)),
    runtime.jobs,
    (result) => beginPackage(result, runtime)
  )
  for (const result of results.filter(({ name }) => exclusivePackages.includes(name)))
    await beginPackage(result, runtime)
  /** The integration owner participates through the family config even when not publishable. */
  const family = results.filter(({ name }) => familyOwners.includes(name))
  if (family.length) await captureFamily(family, runtime)
  for (const result of results) printSummary(result.gates)
  return results
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
 * Execute the original 18 full-CI gates; only package scheduling and capture reuse change.
 *
 * @param {string[]} releasePackages Existing foundation release plan.
 * @param {string[]} storePackages Existing store release plan.
 * @param {ICiRuntime} runtime Invocation context.
 * @returns {Promise<number>} Existing finish_ci blocking status.
 */
export const runCi = async (releasePackages, storePackages, runtime) => {
  /** Root rows stay in their old order even though both package groups now share one pool. */
  const results = []
  results.push(
    await runGate(GateName.build, 'required', 'pnpm', ['-r', 'run', 'build'], { env: runtime.env })
  )
  for (const name of [GateName.dependencies, GateName.release])
    results.push(
      await runGate(name, 'required', 'make', ['--no-print-directory', name], { env: runtime.env })
    )
  /** All readers begin only after the one topological workspace build has finished. */
  const packages = await runPackages([...releasePackages, ...storePackages], runtime)
  results.push(
    groupSummary(GateName.ship, releasePackages, packages),
    groupSummary(GateName.store, storePackages, packages)
  )
  for (const name of [GateName.registry, GateName.consumers])
    results.push(await runGate(name, 'required', 'pnpm', ['run', name], { env: runtime.env }))
  results.push(
    await runGate(GateName.docs, 'required', 'node', ['scripts/check-docs-independence.mjs'], {
      env: runtime.env
    })
  )
  for (const name of rootTestGates)
    results.push(await runGate(name, 'required', 'pnpm', ['run', name], { env: runtime.env }))
  results.push(
    await runGate(GateName.custody, 'required', 'node', ['scripts/coverage-custody.mjs'], {
      env: runtime.env
    })
  )
  /** Missing toolchains retain the original explicit blocking/warning skip policy. */
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
  if (missing.length)
    results.push({
      name: text.missingTools(missing),
      code: process.env.CI_ALLOW_MISSING_TOOLCHAINS === '1' ? 0 : 1,
      state:
        process.env.CI_ALLOW_MISSING_TOOLCHAINS === '1'
          ? GateState.skipWarning
          : GateState.skipBlocking,
      seconds: 0
    })
  else
    results.push(
      await runGate(
        GateName.conformance,
        'required',
        'pnpm',
        ['--filter', './packages/rpc-integration', 'run', 'test:conformance'],
        { env: runtime.env }
      )
    )
  results.push(
    await runGate(
      GateName.parity,
      'required',
      'pnpm',
      ['--filter', './packages/rpc-integration', 'run', 'test:suite-parity'],
      { env: runtime.env }
    )
  )
  for (const gate of ['fmt', 'lint', 'typecheck'])
    results.push(
      await runGate(
        `website/${gate}`,
        'required',
        'make',
        ['--no-print-directory', 'ci-website-check', `GATE=${gate}`],
        { env: runtime.env }
      )
    )
  results.push(
    await runGate('website/test', 'warning', 'make', ['--no-print-directory', 'ci-website-test'], {
      env: runtime.env
    })
  )
  return printSummary(results)
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
    return runCommand('pnpm', ['-r', 'run', 'build'], { env: runtime.env })
  }
}

/**
 * Parse the small Makefile CLI and preserve package declaration order.
 *
 * @param {string[]} argv Mode and explicit package-list options.
 * @returns {{ mode: string; release: string[]; store: string[]; packages: string[] }} Resolved
 *   command.
 * @throws {Error} Unsupported mode, option or missing option value.
 */
const parseArguments = (argv) => {
  /** Make passes each package list as one argument, avoiding shell splitting inside this module. */
  const [mode, ...args] = argv
  if (mode !== 'ci' && mode !== 'packages') throw new Error(text.invalidArguments)
  /** The three accepted lists are explicit inputs rather than a second release inventory. */
  const options = { release: [], store: [], packages: [] }
  for (let index = 0; index < args.length; index += 2) {
    /** An option without its full package-list argument cannot produce a trustworthy selection. */
    const key = args[index].slice(2)
    if (
      !args[index].startsWith('--') ||
      !Object.hasOwn(options, key) ||
      args[index + 1] === undefined
    )
      throw new Error(text.invalidArguments)
    options[key] = args[index + 1].trim().split(/\s+/).filter(Boolean)
  }
  return { mode, ...options }
}

/**
 * Makefile entrypoint; reports every gate before returning the original aggregate blocking status.
 *
 * @param {string[]} argv CLI arguments.
 * @returns {Promise<number>} CI blocking status or standalone preparation failure.
 */
export const main = async (argv) => {
  /** Parse before creating reports so invalid invocations have no filesystem effect. */
  const options = parseArguments(argv)
  /** One runtime owns the entire invocation's reports and nested worker budget. */
  const runtime = createRuntime()
  if (options.mode === 'ci') return runCi(options.release, options.store, runtime)
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
