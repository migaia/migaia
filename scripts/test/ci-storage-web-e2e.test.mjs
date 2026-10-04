import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

/** @typedef {import('@playwright/test/reporter').JSONReport} IPlaywrightReport */

/** The Makefile and optional classifier are copied from the actual candidate. */
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** Independent fixture text pins the exact K269 browser assertion. */
const known = {
  title: 'Secure cookie 遵循真实浏览器的 loopback 语义，普通 cookie 也正常',
  message:
    'Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: false\nReceived: true'
}

/**
 * Models the complete 40-case, two-browser matrix with one known failed assertion.
 *
 * @returns {IPlaywrightReport} The full report consumed by the real Makefile gate.
 */
const report = () => ({
  config: { rootDir: '', projects: [{ name: 'chromium' }, { name: 'webkit' }] },
  errors: [],
  stats: { expected: 79, unexpected: 1, flaky: 0, skipped: 0 },
  suites: [
    {
      title: 'cookie.spec.ts',
      file: 'cookie.spec.ts',
      specs: Array.from({ length: 40 }, (_, index) => ({
        title: index === 0 ? known.title : `other case ${index}`,
        file: 'cookie.spec.ts',
        line: index === 0 ? 3 : 20 + index,
        column: 1,
        tests: ['chromium', 'webkit'].map((projectName) => {
          /** Only this exact WebKit assertion represents the accepted existing defect. */
          const failed = index === 0 && projectName === 'webkit'
          return {
            projectName,
            expectedStatus: 'passed',
            status: failed ? 'unexpected' : 'expected',
            results: [
              {
                status: failed ? 'failed' : 'passed',
                retry: 0,
                ...(failed
                  ? {
                      error: { message: known.message },
                      errorLocation: { file: '', line: 12, column: 32 },
                      errors: [
                        {
                          message: `${known.message}\n> 12 |   expect(result.secureVisible).toBe(browserName === 'chromium')`
                        }
                      ]
                    }
                  : { errors: [] })
              }
            ]
          }
        })
      }))
    }
  ]
})

/**
 * Runs the actual release-check with a synthetic Playwright producer, without skipping any gate.
 *
 * @param {IPlaywrightReport} input Report emitted by the mocked browser process.
 * @param {string[]} [arguments_] The selected real Makefile entry and explicit CI policy.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} The real make exit and summary.
 */
const runGate = (
  input,
  arguments_ = ['release-check', 'PACKAGE=storage-web', 'STORAGE_WEB_K269_WAIVE=1']
) => {
  /** Temporary files stay inside this checkout and are removed by their creator. */
  const directory = mkdtempSync(join(repositoryRoot, 'node_modules/.k269-gate-'))
  try {
    mkdirSync(join(directory, 'scripts'), { recursive: true })
    mkdirSync(join(directory, 'packages/storage-web/e2e'), { recursive: true })
    mkdirSync(join(directory, 'node_modules/.bin'), { recursive: true })
    writeFileSync(join(directory, 'package.json'), '{"type":"commonjs"}')
    copyFileSync(join(repositoryRoot, 'Makefile'), join(directory, 'Makefile'))
    /** The pre-implementation Makefile runs without a classifier, yielding a business RED. */
    const classifier = 'scripts/ci-storage-web-e2e.mjs'
    if (existsSync(join(repositoryRoot, classifier)))
      copyFileSync(join(repositoryRoot, classifier), join(directory, classifier))
    copyFileSync(
      join(repositoryRoot, 'packages/storage-web/e2e/cookie.spec.ts'),
      join(directory, 'packages/storage-web/e2e/cookie.spec.ts')
    )
    writeFileSync(
      join(directory, 'packages/storage-web/package.json'),
      JSON.stringify({
        scripts: {
          fmt: 'oxfmt src',
          lint: 'lint',
          typecheck: 'typecheck',
          test: 'test',
          'test:e2e': 'playwright test --config=e2e/playwright.config.ts',
          build: 'build'
        }
      })
    )
    input.config.rootDir = join(directory, 'packages/storage-web/e2e')
    input.suites[0].specs[0].tests[1].results[0].errorLocation.file = join(
      input.config.rootDir,
      'cookie.spec.ts'
    )
    writeFileSync(join(directory, 'report-fixture.json'), JSON.stringify(input))
    /** Successful non-browser gates isolate the K269 decision inside release-check. */
    const formatter = join(directory, 'node_modules/.bin/oxfmt')
    writeFileSync(formatter, '#!/bin/sh\nexit 0\n')
    chmodSync(formatter, 0o755)
    /** Emits a fresh JSON report only when the real runner requests one. */
    const producer = join(directory, 'node_modules/.bin/pnpm')
    writeFileSync(
      producer,
      `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs')
if (process.argv.includes('test:e2e')) {
  /** The selected synthetic result is the only browser producer input. */
  const report = readFileSync(process.env.K269_TEST_REPORT, 'utf8')
  if (process.env.PLAYWRIGHT_JSON_OUTPUT_FILE) writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, report)
  process.stdout.write('synthetic complete storage-web E2E report\\n')
  process.exit(1)
}
`
    )
    chmodSync(producer, 0o755)
    return spawnSync('make', arguments_, {
      cwd: directory,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      env: {
        ...process.env,
        PATH: `${join(directory, 'node_modules/.bin')}:${process.env.PATH}`,
        K269_TEST_REPORT: join(directory, 'report-fixture.json')
      }
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('K269 exact storage-web E2E failure gate', () => {
  it('[A272] keeps standalone release validation blocking without the CI waiver', () => {
    /** Publication preflight must not inherit the CI-only exception for an existing defect. */
    const result = runGate(report(), ['ship-ci', 'RELEASE_PACKAGES=storage-web'])
    assert.notEqual(result.status, 0, `[A272] standalone ship-ci must block K269\n${result.stdout}`)
    assert.match(result.stdout, /FAIL \| storage-web\/test:e2e/)
  })

  it('[A269] warns only for the exact existing Secure cookie assertion', () => {
    /** Only the one accepted browser failure may make release-check non-blocking. */
    const result = runGate(report())
    assert.equal(result.status, 0, `[A269] exact K269 failure must WARN\n${result.stdout}`)
    assert.match(result.stdout, /WARN \| storage-web\/test:e2e/)
    assert.match(result.stdout, /已知既有失败 K269，见 storage-web owner/)
  })

  it('[A270] blocks when one additional failure appears', () => {
    /** A second failed browser case must never inherit the singleton exception. */
    const input = report()
    input.stats.expected--
    input.stats.unexpected++
    input.suites[0].specs[1].tests[0] = structuredClone(input.suites[0].specs[0].tests[1])
    input.suites[0].specs[1].tests[0].projectName = 'chromium'
    /** This is the user-requested discriminating extra-failure case. */
    const result = runGate(input)
    assert.notEqual(result.status, 0, '[A270] additional failure remains blocking')
    assert.match(result.stdout, /FAIL \| storage-web\/test:e2e/)
  })

  it('[A271] blocks when the same case fails through another assertion', () => {
    /** Same title/file alone cannot authorize a changed failure. */
    const input = report()
    input.suites[0].specs[0].tests[1].results[0].error.message = 'Error: Timeout 30000ms exceeded'
    /** The actual Makefile must retain this non-K269 failure as blocking. */
    const result = runGate(input)
    assert.notEqual(result.status, 0, '[A271] other failure of the same case remains blocking')
    assert.match(result.stdout, /FAIL \| storage-web\/test:e2e/)
  })
})
