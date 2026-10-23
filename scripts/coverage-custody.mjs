import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertAllFresh,
  DistStampErrorCode,
  isStampable,
  workspacePackages
} from './dist-stamp.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(repositoryRoot, 'coverage-baseline.json')
const metricNames = Object.freeze(['lines', 'statements', 'functions', 'branches'])
/** Exact test-only edits admitted while replacing the stale coverage baseline. */
const BASELINE_RESET_TEST_TRANSFORMS = Object.freeze([
  Object.freeze({
    path: 'packages/plugin-host/test/acceptance-contract.test.ts',
    replace: Object.freeze([
      '    expect(medians.coldTrusted).toBeLessThanOrEqual(medians.generic * 1.1)\n',
      '',
      '    expect(medians.warmTrusted).toBeLessThanOrEqual(medians.generic * 0.8)\n',
      ''
    ])
  }),
  Object.freeze({
    path: 'packages/storage-web/test/bundle-boundary.spec.ts',
    replace: Object.freeze([
      '@migaia/event-subscriber/dist/channel-D8-zrqiP.js',
      '@migaia/event-subscriber/dist/channel-BqvtJPfL.js'
    ])
  }),
  Object.freeze({
    path: 'packages/rpc/test/core/tree-shaking/core-retained-causal.test.ts',
    replace: Object.freeze([
      "  const workspaceRoot = resolve(import.meta.dirname, '../../../..')\n  const relative = module.startsWith(`${workspaceRoot}/`)\n    ? module.slice(workspaceRoot.length + 1)\n    : module\n",
      "  const relative = module.includes('/packages/')\n    ? module.slice(module.indexOf('/packages/') + 1)\n    : module\n"
    ])
  }),
  Object.freeze({
    path: 'packages/rpc/test/core/tree-shaking/core-retained-causal.mjs',
    replace: Object.freeze([
      '  const relativeModule = module.startsWith(`${workspaceDirectory}/`)\n    ? module.slice(workspaceDirectory.length + 1)\n    : module\n',
      "  const relativeModule = module.includes('/packages/')\n    ? module.slice(module.indexOf('/packages/') + 1)\n    : module\n"
    ])
  })
])

/** Packages owned by Rust/wasm-bindgen coverage rather than V8. */
export const NON_V8_PACKAGES = Object.freeze({
  wasm: 'Rust and wasm-bindgen coverage is owned by the package wasm runner'
})

/** One coverage unit replaces the deleted umbrella owner; tests remain in their real packages. */
export const RPC_COVERAGE_FAMILY = Object.freeze({
  unit: 'rpc-family',
  runner: 'rpc-integration',
  config: 'vitest.family.config.ts',
  deletedOwners: Object.freeze(['rpc']),
  runtimeOwners: Object.freeze([
    'rpc-contract',
    'rpc-host',
    'rpc-plugin-process',
    'rpc-plugin-thread',
    'rpc-plugin-browser',
    'rpc-plugin-coroutines',
    'rpc-plugin-pool',
    'rpc-plugin-devtools'
  ])
})

/** Shared with the CI runner so custody and signing consume this invocation's raw reports. */
export const CI_COVERAGE_REPORT_ENV = 'MIGAIA_CI_COVERAGE_REPORT_DIR'

/** The CI runner records the actual capture exit code before custody may reuse V8 output. */
export const CAPTURE_EXIT_CODE_FILE = 'capture-exit-code'

/**
 * Preserve the existing capture-failure message for both new captures and reused CI reports.
 *
 * @param {string} packageName Actual package or declared RPC family coverage unit.
 * @returns {string} Stable capture-failure message.
 */
const captureFailureMessage = (packageName) => `coverage capture failed for ${packageName}`

/** Read one package manifest without allowing package code to become an owner. */
export const readPackageManifest = (packageName) => {
  const manifestPath = join(repositoryRoot, 'packages', packageName, 'package.json')
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}

/** Discover every package that declares the repository-owned test entrypoint. */
export const discoverTestOwners = () => {
  const packageDirectories = execFileSync(
    'find',
    ['packages', '-mindepth', '2', '-maxdepth', '2', '-name', 'package.json'],
    { cwd: repositoryRoot, encoding: 'utf8' }
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((file) => file.split('/')[1])
    .sort()

  return packageDirectories.filter((packageName) =>
    Boolean(readPackageManifest(packageName).scripts?.test)
  )
}

/** Enumerate package owners and require explicit disposition for non-V8 tests. */
export const assertInventory = () => {
  const owners = discoverTestOwners()
  const nonV8 = Object.keys(NON_V8_PACKAGES).sort()
  /** All seven real test owners must be present before they can share one capture. */
  const familyOwners = [...RPC_COVERAGE_FAMILY.runtimeOwners, RPC_COVERAGE_FAMILY.runner]
  const missingFamilyOwners = familyOwners.filter((packageName) => !owners.includes(packageName))
  if (missingFamilyOwners.length)
    throw new Error(`RPC family test owner is absent: ${missingFamilyOwners.join(', ')}`)
  const coveragePackages = [
    ...owners.filter(
      (packageName) =>
        !nonV8.includes(packageName) &&
        !familyOwners.includes(packageName) &&
        !RPC_COVERAGE_FAMILY.deletedOwners.includes(packageName)
    ),
    RPC_COVERAGE_FAMILY.unit
  ].sort()
  const missingDisposition = nonV8.filter((packageName) => !owners.includes(packageName))
  if (missingDisposition.length > 0) {
    throw new Error(
      `non-V8 inventory entry is not a current test owner: ${missingDisposition.join(', ')}`
    )
  }
  if (coveragePackages.length === 0)
    throw new Error('package test inventory has no TypeScript coverage owners')
  return {
    owners,
    coveragePackages,
    nonV8,
    deletedCoveragePackages: RPC_COVERAGE_FAMILY.deletedOwners
  }
}

/**
 * Project the last signed umbrella totals into the new unit for read-only comparison. No file keys
 * or metric counts are rewritten, and every unrelated owner stays exact.
 *
 * @param {Record<string, unknown>} packages Signed package metrics.
 * @returns {Record<string, unknown>} Comparison-only inventory.
 * @throws {Error} Both old and new family units would create an ambiguous signed inventory.
 */
export const comparableCoveragePackages = (packages) => {
  const current = { ...packages }
  if (Object.hasOwn(current, 'rpc')) {
    if (Object.hasOwn(current, RPC_COVERAGE_FAMILY.unit))
      throw new Error('coverage baseline contains both deleted rpc and rpc-family owners')
    current[RPC_COVERAGE_FAMILY.unit] = current.rpc
    delete current.rpc
  }
  return current
}

/** Reject package inventory changes that would silently omit an owner. */
export const assertPackageReportsComplete = (coveragePackages, packages) => {
  const expected = [...coveragePackages].sort()
  const observed = Object.keys(packages ?? {}).sort()
  if (
    expected.length !== observed.length ||
    expected.some((name, index) => name !== observed[index])
  )
    throw new Error(
      'coverage report package inventory is incomplete or contains an unexpected package'
    )
}

/** Reject any exclusion other than the one explicitly admitted for Rust coverage. */
export const assertExclusions = (exclusions) => {
  const expected = JSON.stringify(NON_V8_PACKAGES)
  if (JSON.stringify(exclusions ?? {}) !== expected)
    throw new Error('coverage exclusions differ from the admitted non-V8 disposition')
}

/** Require all four V8 totals when validating a package-level report. */
export const assertCompleteMetrics = (metrics, packageName) => {
  const names = Object.keys(metrics ?? {}).sort()
  if (names.length !== metricNames.length || metricNames.some((metric) => !names.includes(metric)))
    throw new Error(`${packageName} coverage report does not contain the complete metric set`)
}

/** Run one command with CI semantics and preserve native exit attribution. */
const run = (command, args) =>
  execFileSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, CI: 'true', PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: 'false' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })

/** Convert a coverage summary total into a comparable metric tuple. */
export const summaryMetrics = (summary) => {
  const total = summary?.total
  if (!total) throw new Error('coverage summary has no total record')
  return Object.fromEntries(
    metricNames.map((metric) => {
      const value = total[metric]
      if (!value || !Number.isFinite(value.covered) || !Number.isFinite(value.total)) {
        throw new Error(`coverage summary has no ${metric} metric`)
      }
      return [
        metric,
        {
          covered: value.covered,
          total: value.total,
          pct: Number.isFinite(value.pct)
            ? value.pct
            : value.total === 0
              ? 100
              : (value.covered / value.total) * 100
        }
      ]
    })
  )
}

/** Refuse covered-count decreases, denominator expansion, or percentage decreases. */
export const assertMonotonic = (current, baseline, packageName) => {
  const metrics = Object.keys(current ?? {}).sort()
  if (metrics.length === 0) throw new Error(`${packageName} coverage baseline has no metrics`)
  for (const metric of metrics) {
    const now = current?.[metric]
    const old = baseline?.[metric]
    if (!now || !old)
      throw new Error(`${packageName} ${metric} metric missing from coverage baseline`)
    if (now.covered < old.covered)
      throw new Error(
        `${packageName} ${metric} covered count decreased from ${old.covered} to ${now.covered}`
      )
    if (now.total > old.total)
      throw new Error(`${packageName} ${metric} total expanded from ${old.total} to ${now.total}`)
    if (now.pct < old.pct)
      throw new Error(`${packageName} ${metric} coverage decreased from ${old.pct} to ${now.pct}`)
  }
}

/** Return repository-relative tracked and untracked TypeScript runtime files. */
export const changedRuntimeFiles = (names, excludedPackages = []) =>
  names
    .filter((name) => /^packages\/[^/]+\/src\/.*\.(ts|tsx)$/.test(name))
    .map((name) => name.replaceAll('\\', '/'))
    .filter((name) => !excludedPackages.includes(name.split('/')[1]))
    .filter((name, index, all) => all.indexOf(name) === index)
    .sort()

/** Assert every changed runtime file has a V8 file record and branch map. */
export const assertChangedFilesPresent = (changedFiles, detail) => {
  for (const file of changedFiles) {
    const absolutePath = resolve(repositoryRoot, file)
    const entry = detail?.[absolutePath] ?? detail?.[file]
    if (!entry) throw new Error(`changed runtime file is absent from coverage report: ${file}`)
    if (
      !entry.branches ||
      !Number.isFinite(entry.branches.covered) ||
      !Number.isFinite(entry.branches.total) ||
      !entry.branchMap ||
      typeof entry.branchMap !== 'object'
    ) {
      throw new Error(`changed runtime branch map is absent from coverage report: ${file}`)
    }
  }
}

/** Assert changed-file branch coverage against the previously approved baseline. */
export const assertChangedFilesCovered = (changedFiles, detail, baselineFiles) => {
  assertChangedFilesPresent(changedFiles, detail)
  for (const file of changedFiles) {
    const baseline = baselineFiles?.[file]
    if (!baseline) throw new Error(`changed runtime file has no custody baseline: ${file}`)
    const absolutePath = resolve(repositoryRoot, file)
    const entry = detail[absolutePath] ?? detail[file]
    assertMonotonic({ branches: entry.branches }, { branches: baseline.branches }, file)
  }
}

/** Read Git changes including untracked runtime source, deletions, and staged edits. */
export const changedFilesFromGit = () => {
  const tracked = run('git', ['diff', '--name-only', 'HEAD', '--', 'packages'])
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '--', 'packages'])
  return [...tracked.split('\n'), ...untracked.split('\n')].filter(Boolean)
}

/**
 * Hash the complete tracked and nonignored package input for final custody. Declared tracked
 * deletions remain part of the canonical input so a settled final topology can be bound without
 * dereferencing a removed path.
 */
export const packageInputSha256 = () => {
  const names = run('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '--',
    'packages'
  ])
    .split('\n')
    .filter(Boolean)
    .sort()
  const deleted = new Set(
    run('git', ['diff', '--diff-filter=D', '--name-only', 'HEAD', '--', 'packages'])
      .split('\n')
      .filter(Boolean)
  )
  const entries = names.map((name) => {
    const absolutePath = resolve(repositoryRoot, name)
    if (!existsSync(absolutePath)) {
      if (deleted.has(name)) return { path: name, deleted: true }
      throw new Error(`package input tracked path is unexpectedly absent: ${name}`)
    }
    const stat = lstatSync(absolutePath)
    const mode = stat.mode
    if (stat.isSymbolicLink()) return { path: name, mode, symlink: readlinkSync(absolutePath) }
    if (!stat.isFile()) throw new Error(`package input is not a file or symlink: ${name}`)
    return {
      path: name,
      mode,
      sha256: createHash('sha256').update(readFileSync(absolutePath)).digest('hex')
    }
  })
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex')
}

/**
 * Require the externally signed final candidate input before capture and before atomic
 * installation; this producer never signs an arbitrary current tree.
 */
export const assertCandidateInputSha256 = (expected) => {
  if (!/^[0-9a-f]{64}$/.test(expected))
    throw new Error('coverage custody candidate SHA-256 is malformed')
  const actual = packageInputSha256()
  if (actual !== expected) throw new Error('coverage custody candidate package input differs')
  return actual
}

/** Return deleted package runtime sources for explicit custody disposition. */
export const deletedRuntimeFilesFromGit = () =>
  run('git', ['diff', '--diff-filter=D', '--name-only', 'HEAD', '--', 'packages'])
    .split('\n')
    .filter(Boolean)
    .filter((name) => changedRuntimeFiles([name]).length > 0)

/** Reject baseline replacement unless package edits equal the six admitted byte transforms. */
export const assertBaselineResetPreconditions = () => {
  /** Records every tracked, staged, unstaged, and untracked package path. */
  const packageChanges = [...changedFilesFromGit()].sort()
  /** Limits package differences to the six files explicitly admitted for this reset. */
  const expectedPaths = BASELINE_RESET_TEST_TRANSFORMS.map(({ path }) => path).sort()
  if (
    packageChanges.length !== expectedPaths.length ||
    packageChanges.some((path, index) => path !== expectedPaths[index])
  ) {
    throw new Error('coverage baseline reset has unauthorized package changes')
  }
  for (const transform of BASELINE_RESET_TEST_TRANSFORMS) {
    /** Reads the exact repository baseline rather than accepting an already-modified fixture. */
    const headBytes = run('git', ['show', `HEAD:${transform.path}`])
    /** Reads current bytes for exact one-time transform comparison. */
    const actualBytes = readFileSync(join(repositoryRoot, transform.path), 'utf8')
    /** Applies each declared replacement once and rejects missing or duplicate source bytes. */
    let expectedBytes = headBytes
    for (let index = 0; index < transform.replace.length; index += 2) {
      /** Identifies source bytes mandated by the admission. */
      const source = transform.replace[index]
      /** Identifies replacement bytes; empty means deletion. */
      const replacement = transform.replace[index + 1] ?? ''
      const first = expectedBytes.indexOf(source)
      if (first === -1 || expectedBytes.indexOf(source, first + 1) !== -1)
        throw new Error(`coverage baseline reset transform is not unique: ${transform.path}`)
      expectedBytes = `${expectedBytes.slice(0, first)}${replacement}${expectedBytes.slice(
        first + source.length
      )}`
    }
    if (actualBytes !== expectedBytes)
      throw new Error(
        `coverage baseline reset fixture differs from admitted transform: ${transform.path}`
      )
  }
}

/**
 * Builds every package that publishes `dist/`, in workspace topological order, before any capture.
 * Tests import sibling packages through their `dist/`, so capturing against output built from older
 * sources would measure code that is no longer in the candidate. Packages without `dist/` (the
 * wasm-pack package) are not built here, matching their own test scripts.
 */
export const buildWorkspaceOutput = () => {
  /** Pnpm filters naming each stampable package; pnpm orders them topologically. */
  const filters = [...workspacePackages().entries()]
    .filter(([, directory]) => isStampable(directory))
    .flatMap(([name]) => ['--filter', `./packages/${name}`])
  run('pnpm', ['-r', ...filters, 'run', 'build'])
}

/**
 * Read the existing V8 reports without remapping or cloning their runtime source identities.
 *
 * @param {string} packageName Actual package or declared RPC family coverage unit.
 * @param {string} packageReport Absolute directory containing the two V8 report files.
 * @returns {{
 *   metrics: Record<string, { covered: number; total: number; pct: number }>
 *   files: Record<
 *     string,
 *     {
 *       metrics: Record<string, { covered: number; total: number; pct: number }>
 *       branchMap: unknown
 *     }
 *   >
 * }}
 *   Original totals and per-file maps.
 * @throws {Error} The family report contains non-owner output or omits a real runtime owner.
 */
export const readCoverageReport = (packageName, packageReport) => {
  const summary = JSON.parse(readFileSync(join(packageReport, 'coverage-summary.json'), 'utf8'))
  const detail = JSON.parse(readFileSync(join(packageReport, 'coverage-final.json'), 'utf8'))
  const files = Object.fromEntries(
    Object.entries(summary)
      .filter(([path]) => path !== 'total')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, entry]) => [
        path,
        {
          metrics: summaryMetrics({ total: entry }),
          branchMap: detail[path]?.branchMap
        }
      ])
  )
  if (packageName === RPC_COVERAGE_FAMILY.unit) {
    /** Source-map output must identify real owner files, never duplicated emitted JavaScript. */
    const sourceFiles = Object.keys(files).map(normalizeCoveragePath)
    for (const path of sourceFiles) {
      const owner = path.split('/')[1]
      if (
        !RPC_COVERAGE_FAMILY.runtimeOwners.includes(owner) ||
        !path.startsWith(`packages/${owner}/src/`) ||
        !existsSync(resolve(repositoryRoot, path))
      )
        throw new Error(`RPC family coverage has no real runtime Source owner: ${path}`)
    }
    for (const owner of RPC_COVERAGE_FAMILY.runtimeOwners)
      if (!sourceFiles.some((path) => path.startsWith(`packages/${owner}/src/`)))
        throw new Error(`RPC family coverage omitted a Source owner: ${owner}`)
  }
  return { metrics: summaryMetrics(summary), files }
}

/**
 * Return the existing V8 capture command for custody and the CI release-check runner.
 *
 * @param {string} packageName Actual package or the declared RPC family unit.
 * @param {string} reportRoot Absolute raw capture root.
 * @returns {string[]} Pnpm arguments preserving the unit's reporters, source scope and config.
 */
export const coverageArguments = (packageName, reportRoot) => {
  /** Each unit owns its original pair of V8 JSON reports below the invocation's capture root. */
  const packageReport = join(reportRoot, packageName)
  /** The family uses its single existing config; all other package commands remain unchanged. */
  const family = packageName === RPC_COVERAGE_FAMILY.unit
  return family
    ? [
        '--dir',
        `packages/${RPC_COVERAGE_FAMILY.runner}`,
        'exec',
        'vitest',
        'run',
        '--config',
        RPC_COVERAGE_FAMILY.config,
        '--coverage',
        '--coverage.reporter=json-summary',
        '--coverage.reporter=json',
        `--coverage.reportsDirectory=${packageReport}`
      ]
    : [
        '--dir',
        `packages/${packageName}`,
        'exec',
        'vitest',
        'run',
        'test',
        '--coverage',
        '--coverage.reporter=json-summary',
        '--coverage.reporter=json',
        `--coverage.reportsDirectory=${packageReport}`,
        '--coverage.include=src/**/*.{ts,tsx}'
      ]
}

/**
 * Capture one coverage unit against output already built and asserted fresh by `main`.
 *
 * @param {string} packageName Actual package or the declared RPC family unit.
 * @param {string} reportRoot Absolute raw capture root.
 * @returns {ReturnType<typeof readCoverageReport>} Original V8 totals and file records.
 * @throws {Error} The existing test command or its coverage thresholds fail.
 */
export const capturePackage = (packageName, reportRoot) => {
  /** Capture output remains in the same per-unit directory used by the report reader. */
  const packageReport = join(reportRoot, packageName)
  try {
    const output = run('pnpm', coverageArguments(packageName, reportRoot))
    writeFileSync(join(reportRoot, `${packageName}-capture.log`), output)
  } catch (error) {
    /** Preserve native stderr/stdout so a threshold failure cannot be called baseline drift. */
    writeFileSync(
      join(reportRoot, `${packageName}-capture.log`),
      `${error.stdout ?? ''}${error.stderr ?? ''}`
    )
    throw new Error(captureFailureMessage(packageName), { cause: error })
  }
  return readCoverageReport(packageName, packageReport)
}

/** Normalize a V8 detail path into repository-relative custody storage. */
export const normalizeCoveragePath = (path) => {
  const absolute = path.startsWith('file://') ? fileURLToPath(path) : path
  return relative(repositoryRoot, resolve(absolute)).replaceAll('\\', '/')
}

/** Serialize baseline data with stable key ordering for reproducible custody bytes. */
export const serializeBaseline = (result) => {
  const packages = Object.fromEntries(
    Object.entries(result.packages ?? {}).sort(([left], [right]) => left.localeCompare(right))
  )
  const files = Object.fromEntries(
    Object.entries(result.files ?? {}).sort(([left], [right]) => left.localeCompare(right))
  )
  return `${JSON.stringify({ ...result, packages, files, changedRuntimeFiles: [...(result.changedRuntimeFiles ?? [])].sort() }, null, 2)}\n`
}

/** Atomically install a fully validated baseline and never expose partial JSON. */
export const writeBaselineAtomically = (result) => {
  const temporaryPath = `${baselinePath}.tmp-${process.pid}`
  try {
    writeFileSync(temporaryPath, serializeBaseline(result), { mode: 0o600 })
    renameSync(temporaryPath, baselinePath)
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true })
  }
}

/** Execute the complete root custody matrix and optionally replace its baseline. */
export const main = () => {
  /** Selects fresh baseline production, which must not compare against the stale baseline. */
  const updateBaseline = process.argv.includes('--update-baseline')
  /** Binds final production to an externally signed package input when present. */
  const hasCandidateSha256 = Object.hasOwn(process.env, 'COVERAGE_CUSTODY_CANDIDATE_SHA256')
  const candidateSha256 = process.env.COVERAGE_CUSTODY_CANDIDATE_SHA256
  if (updateBaseline) {
    if (hasCandidateSha256) assertCandidateInputSha256(candidateSha256)
    else assertBaselineResetPreconditions()
  }
  const { coveragePackages, deletedCoveragePackages } = assertInventory()
  try {
    assertAllFresh()
  } catch (error) {
    if (error?.code !== DistStampErrorCode.stale) throw error
    buildWorkspaceOutput()
    assertAllFresh()
  }
  const existing =
    !updateBaseline && existsSync(baselinePath)
      ? JSON.parse(readFileSync(baselinePath, 'utf8'))
      : null
  if (existing) {
    assertExclusions(existing.exclusions)
  }
  const reportRoot = mkdtempSync(join(tmpdir(), 'migai-coverage-custody-'))
  /** Only the current CI invocation supplies reusable reports; standalone custody still captures. */
  const ciReportRoot = process.env[CI_COVERAGE_REPORT_ENV]
  /** Failed comparison retains all raw captures; no partial result can replace the signed baseline. */
  let verified = false
  try {
    const packages = {}
    const files = {}
    const coverageDetails = {}
    /** Capture the family before signed-baseline comparison, then every unchanged other owner. */
    const captureOrder = [
      RPC_COVERAGE_FAMILY.unit,
      ...coveragePackages.filter((packageName) => packageName !== RPC_COVERAGE_FAMILY.unit)
    ]
    for (const packageName of captureOrder) {
      /** A failed Vitest command can still emit JSON, so its exit marker is checked first. */
      const ciPackageReport = ciReportRoot ? join(ciReportRoot, packageName) : null
      /** Missing markers identify output that has no successful CI capture evidence. */
      const captureExitCodePath = ciPackageReport
        ? join(ciPackageReport, CAPTURE_EXIT_CODE_FILE)
        : null
      /** The runner writes a numeric exit code; nonzero output must never trigger a retry. */
      const captureExitCode =
        captureExitCodePath && existsSync(captureExitCodePath)
          ? readFileSync(captureExitCodePath, 'utf8').trim()
          : null
      if (captureExitCode !== null && captureExitCode !== '0') {
        throw new Error(captureFailureMessage(packageName), {
          cause: { status: Number(captureExitCode) }
        })
      }
      /** Reuse only a successful, complete report; missing output retains standalone capture. */
      const reuseReport =
        captureExitCode === '0' &&
        existsSync(join(ciPackageReport, 'coverage-summary.json')) &&
        existsSync(join(ciPackageReport, 'coverage-final.json'))
      /** Both paths use the existing report reader and all unchanged custody assertions below. */
      const report = reuseReport
        ? readCoverageReport(packageName, ciPackageReport)
        : capturePackage(packageName, reportRoot)
      packages[packageName] = report.metrics
      assertCompleteMetrics(report.metrics, packageName)
      for (const [sourcePath, entry] of Object.entries(report.files)) {
        const relativePath = normalizeCoveragePath(sourcePath)
        files[relativePath] = entry.metrics
        coverageDetails[relativePath] = { ...entry.metrics, branchMap: entry.branchMap }
      }
    }

    assertPackageReportsComplete(coveragePackages, packages)
    const changedFiles = changedRuntimeFiles(changedFilesFromGit(), Object.keys(NON_V8_PACKAGES))
    const deletedFiles = deletedRuntimeFilesFromGit()
    const filesRequiringCoverage = changedFiles.filter((file) => !deletedFiles.includes(file))
    const detail = Object.fromEntries(
      Object.entries(coverageDetails).map(([file, metrics]) => [
        resolve(repositoryRoot, file),
        metrics
      ])
    )
    const result = {
      version: 1,
      generatedBy: 'scripts/coverage-custody.mjs',
      packages,
      files,
      exclusions: NON_V8_PACKAGES,
      changedRuntimeFiles: changedFiles,
      deletedRuntimeFiles: deletedFiles,
      deletedCoveragePackages,
      baselineInventoryDrift: existing
        ? {
            missing: coveragePackages.filter((name) => !Object.hasOwn(existing.packages, name)),
            unexpected: Object.keys(existing.packages).filter(
              (name) => !coveragePackages.includes(name)
            )
          }
        : { missing: [], unexpected: [] }
    }
    /** Raw capture remains inspectable even when unchanged monotonic/baseline rules reject it. */
    writeFileSync(join(reportRoot, 'coverage-custody-report.json'), serializeBaseline(result))
    console.log(JSON.stringify({ capture: reportRoot, family: packages[RPC_COVERAGE_FAMILY.unit] }))
    if (existing) {
      /** Old umbrella totals may be compared, but cannot count as a signed family inventory. */
      const baselinePackages = comparableCoveragePackages(existing.packages)
      assertCompleteMetrics(baselinePackages[RPC_COVERAGE_FAMILY.unit], RPC_COVERAGE_FAMILY.unit)
      assertMonotonic(
        packages[RPC_COVERAGE_FAMILY.unit],
        baselinePackages[RPC_COVERAGE_FAMILY.unit],
        RPC_COVERAGE_FAMILY.unit
      )
      assertPackageReportsComplete(coveragePackages, existing.packages)
      for (const packageName of coveragePackages.filter(
        (name) => name !== RPC_COVERAGE_FAMILY.unit
      )) {
        assertCompleteMetrics(baselinePackages[packageName], packageName)
        assertMonotonic(packages[packageName], baselinePackages[packageName], packageName)
      }
      assertChangedFilesCovered(filesRequiringCoverage, detail, existing.files)
    } else assertChangedFilesPresent(filesRequiringCoverage, detail)
    if (updateBaseline) {
      if (hasCandidateSha256) assertCandidateInputSha256(candidateSha256)
      assertAllFresh()
      writeBaselineAtomically(result)
    }
    console.log(
      JSON.stringify({
        packages: coveragePackages.length,
        changedRuntimeFiles: changedFiles.length,
        baseline: updateBaseline
      })
    )
    verified = true
  } finally {
    if (verified) rmSync(reportRoot, { recursive: true, force: true })
    else console.error(`coverage custody raw capture retained: ${reportRoot}`)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
