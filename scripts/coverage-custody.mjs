import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselinePath = join(repositoryRoot, 'coverage-baseline.json')
const metricNames = Object.freeze(['lines', 'statements', 'functions', 'branches'])

/** Packages owned by Rust/wasm-bindgen coverage rather than V8. */
export const NON_V8_PACKAGES = Object.freeze({
  wasm: 'Rust and wasm-bindgen coverage is owned by the package wasm runner'
})

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
  const coveragePackages = owners.filter((packageName) => !nonV8.includes(packageName))
  const missingDisposition = nonV8.filter((packageName) => !owners.includes(packageName))
  if (missingDisposition.length > 0) {
    throw new Error(
      `non-V8 inventory entry is not a current test owner: ${missingDisposition.join(', ')}`
    )
  }
  if (coveragePackages.length === 0)
    throw new Error('package test inventory has no TypeScript coverage owners')
  return { owners, coveragePackages, nonV8 }
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
    env: { ...process.env, CI: 'true' },
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

/** Return deleted package runtime sources for explicit custody disposition. */
export const deletedRuntimeFilesFromGit = () =>
  run('git', ['diff', '--diff-filter=D', '--name-only', 'HEAD', '--', 'packages'])
    .split('\n')
    .filter(Boolean)
    .filter((name) => changedRuntimeFiles([name]).length > 0)

/** Capture one package report while retaining package-owned build and threshold behavior. */
const capturePackage = (packageName, reportRoot) => {
  const packageReport = join(reportRoot, packageName)
  try {
    const manifest = readPackageManifest(packageName)
    if (manifest.scripts?.test?.includes('pnpm run build'))
      run('pnpm', ['--dir', `packages/${packageName}`, 'run', 'build'])
    run('pnpm', [
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
    ])
  } catch (error) {
    throw new Error(`coverage capture failed for ${packageName}`, { cause: error })
  }
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
  return { metrics: summaryMetrics(summary), files }
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
  const { coveragePackages } = assertInventory()
  const existing = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null
  if (existing) {
    assertExclusions(existing.exclusions)
    assertPackageReportsComplete(coveragePackages, existing.packages)
  }
  const reportRoot = mkdtempSync(join(tmpdir(), 'migai-coverage-custody-'))
  try {
    const packages = {}
    const files = {}
    const coverageDetails = {}
    for (const packageName of coveragePackages) {
      const report = capturePackage(packageName, reportRoot)
      packages[packageName] = report.metrics
      assertCompleteMetrics(report.metrics, packageName)
      for (const [sourcePath, entry] of Object.entries(report.files)) {
        const relativePath = normalizeCoveragePath(sourcePath)
        files[relativePath] = entry.metrics
        coverageDetails[relativePath] = { ...entry.metrics, branchMap: entry.branchMap }
      }
      if (existing?.packages?.[packageName]) {
        assertCompleteMetrics(existing.packages[packageName], packageName)
        assertMonotonic(report.metrics, existing.packages[packageName], packageName)
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
    if (existing) assertChangedFilesCovered(filesRequiringCoverage, detail, existing.files)
    else assertChangedFilesPresent(filesRequiringCoverage, detail)

    const result = {
      version: 1,
      generatedBy: 'scripts/coverage-custody.mjs',
      packages,
      files,
      exclusions: NON_V8_PACKAGES,
      changedRuntimeFiles: changedFiles,
      deletedRuntimeFiles: deletedFiles
    }
    if (process.argv.includes('--update-baseline')) writeBaselineAtomically(result)
    console.log(
      JSON.stringify({
        packages: coveragePackages.length,
        changedRuntimeFiles: changedFiles.length,
        baseline: process.argv.includes('--update-baseline')
      })
    )
  } finally {
    rmSync(reportRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
