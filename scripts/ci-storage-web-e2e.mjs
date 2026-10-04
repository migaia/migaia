import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { stripVTControlCharacters } from 'node:util'

/** @typedef {import('@playwright/test/reporter').JSONReport} IPlaywrightReport */

/** This narrow CI exception belongs to K269; none of its fields are wildcarded. */
const StorageWebK269 = {
  /** K269 is restricted to the WebKit project; Chromium failures still block. */
  project: 'webkit',
  /** The storage owner retains this file; a renamed or moved test invalidates the exception. */
  file: 'packages/storage-web/e2e/cookie.spec.ts',
  /** Exact test title is part of the user-approved singleton failure identity. */
  title: 'Secure cookie 遵循真实浏览器的 loopback 语义，普通 cookie 也正常',
  /** The accepted source assertion is fixed at line 12, not any failure in the same case. */
  line: 12,
  /** Matcher call column binds the captured error to that exact source assertion. */
  column: 32,
  /** The source assertion must still be the approved secure-visible browser comparison. */
  assertion: "expect(result.secureVisible).toBe(browserName === 'chromium')",
  /** Only expected false/received true from the equality matcher is a known failure. */
  message:
    'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: false\nReceived: true',
  /** Required warning directs remediation to the owning storage-web program. */
  warning: '已知既有失败 K269，见 storage-web owner',
  /** Reports stay outside tracked source and are never reused by another command. */
  reportPrefix: 'node_modules/.storage-web-k269-',
  /** Each uniquely created directory holds exactly one Playwright JSON result. */
  reportName: 'report.json',
  /** A missing or corrupt structured result cannot authorize the exception. */
  invalidReport: 'K269 report missing or invalid; storage-web E2E remains blocking'
}

/**
 * Flattens actual nested Playwright suites without dropping child failures.
 *
 * @param {IPlaywrightReport['suites']} suites File and describe suites.
 * @returns {import('@playwright/test/reporter').JSONReportSpec[]} All reported cases.
 */
const allSpecs = (suites) =>
  suites.flatMap((suite) => [...suite.specs, ...allSpecs(suite.suites ?? [])])

/**
 * Accepts only the full matrix's one exact existing assertion failure. All other failures, skips,
 * retries, interruption, missing records, and global errors retain the blocking path.
 *
 * @param {IPlaywrightReport} report Fresh structured output from the full browser command.
 * @param {string} repositoryRoot Checkout owning the asserted source file.
 * @returns {boolean} Whether the failure set is exactly the K269 singleton.
 */
const isKnownStorageWebE2EFailure = (report, repositoryRoot) => {
  if (
    report.errors.length !== 0 ||
    report.stats.unexpected !== 1 ||
    report.stats.skipped !== 0 ||
    report.stats.flaky !== 0
  )
    return false
  /** Both configured browsers must run; this exception never authorizes a filtered matrix. */
  const projects = report.config.projects.map((project) => project.name).sort()
  if (projects.length !== 2 || projects[0] !== 'chromium' || projects[1] !== 'webkit') return false
  /** Resolves report-relative locations against the one owning checkout. */
  const cookieFile = resolve(repositoryRoot, StorageWebK269.file)
  if (
    readFileSync(cookieFile, 'utf8').split('\n')[StorageWebK269.line - 1]?.trim() !==
    StorageWebK269.assertion
  )
    return false
  /** Count actual outcomes as well as report stats so incomplete reports cannot authorize WARN. */
  let passed = 0
  /** Only one unexpected case can receive the narrowly matched exception. */
  let known = 0
  for (const spec of allSpecs(report.suites)) {
    for (const test of spec.tests) {
      if (test.expectedStatus !== 'passed' || test.results.length !== 1) return false
      /** The complete run has one terminal attempt per case under the existing retries=0 config. */
      const result = test.results[0]
      if (test.status === 'expected' && result.status === 'passed' && result.errors.length === 0) {
        passed++
        continue
      }
      if (
        test.status !== 'unexpected' ||
        result.status !== 'failed' ||
        test.projectName !== StorageWebK269.project ||
        spec.title !== StorageWebK269.title ||
        resolve(report.config.rootDir, spec.file) !== cookieFile ||
        result.errors.length !== 1 ||
        result.errorLocation?.file !== cookieFile ||
        result.errorLocation?.line !== StorageWebK269.line ||
        result.errorLocation?.column !== StorageWebK269.column ||
        stripVTControlCharacters(result.error?.message ?? '').trim() !== StorageWebK269.message
      )
        return false
      known++
    }
  }
  return known === 1 && passed > 0 && passed === report.stats.expected
}

/**
 * Runs the unchanged complete package script with an additional JSON reporter. Retains its report,
 * original exit, and terminal output; only the exact singleton returns the Makefile's dedicated
 * warning status. No tests are selected out or suppressed.
 *
 * @param {number} warningExitCode Canonical status supplied by the owning Makefile.
 * @returns {number} One for blocking failure, zero success, or the exact K269 warning status.
 */
const runStorageWebE2E = (warningExitCode) => {
  /** Copied Makefile discrimination fixtures keep the same relative owner structure. */
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  /** A unique retained report cannot be confused with an earlier successful or failed run. */
  const reportDirectory = mkdtempSync(join(repositoryRoot, StorageWebK269.reportPrefix))
  /** Absolute path is passed only to Playwright's existing JSON reporter. */
  const reportPath = join(reportDirectory, StorageWebK269.reportName)
  console.log(`K269 structured report: ${reportPath}`)
  /** Existing package script still executes every case in both configured projects. */
  const execution = spawnSync(
    'pnpm',
    ['--filter', './packages/storage-web', 'run', 'test:e2e', '--reporter=line,json'],
    {
      cwd: repositoryRoot,
      stdio: 'inherit',
      env: { ...process.env, PLAYWRIGHT_BROWSER: '', PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath }
    }
  )
  if (execution.error) console.error(execution.error)
  console.log(`K269 original e2e exit: ${execution.status}; signal: ${execution.signal ?? 'none'}`)
  if (execution.status === 0) return 0
  if (execution.status !== 1 || execution.signal) return 1
  try {
    /** Only a fresh completed report can prove the exact failure set. */
    const report = JSON.parse(readFileSync(reportPath, 'utf8'))
    if (isKnownStorageWebE2EFailure(report, repositoryRoot)) {
      console.log(`==> WARN storage-web/test:e2e: ${StorageWebK269.warning} (playwright exit=1)`)
      return warningExitCode
    }
  } catch (error) {
    console.error(StorageWebK269.invalidReport, error)
  }
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = runStorageWebE2E(Number(process.argv[2]))
