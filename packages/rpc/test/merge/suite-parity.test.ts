import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import legacyTitles from '../fixtures/legacy-test-titles.json'

/** Root used by migrated Vitest suite and source-literal scan. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** Six adapter suites move from old web-rpc tests into browser layer. */
const browserSuites = new Set([
  'broadcast-channel.test.ts',
  'rtc-data-channel.test.ts',
  'web-transport.test.ts',
  'window-source-proof.test.ts',
  'worker-lifecycle.test.ts',
  'worker-metadata.test.ts'
])
/** Only retired historical custody suites may disappear from default test titles. */
const retiredSuites = new Set([
  'approved-migration-candidate.test.ts',
  'provenance.test.ts',
  'delivery-successor-transaction.test.ts',
  'intended-cost-custody.test.ts',
  'error-serialization.test.ts'
])
/** Exact historical titles retired by rpc-layering R5 after deleting unused control code. */
const retiredLayeringTitles = new Set([
  'packages/web-rpc/test/internal/control-task-registry.test.ts::ControlTaskRegistry purges expired unordered aborts before applying its hard cap',
  'packages/web-rpc/test/internal/control-task-registry.test.ts::ControlTaskRegistry deduplicates control tasks before they reach the wire owner',
  'packages/web-rpc/test/internal/control-task-registry.test.ts::ControlTaskRegistry keeps variation admission in the control owner',
  'packages/web-rpc/test/internal/control-task-registry.test.ts::ControlTaskRegistry does not consume variation quota when replay capacity is full',
  'packages/web-rpc/test/internal/control-task-registry.test.ts::ControlTaskRegistry requires a boolean lease decision and skips tombstones when retain rejects',
  'packages/web-rpc/test/internal/async-control.test.ts::async control removes abort listeners when delay completes',
  'packages/web-rpc/test/internal/async-control.test.ts::async control rolls back earlier delay listeners when a later registration fails',
  'packages/web-rpc/test/internal/async-control.test.ts::async control observes delay listener cleanup failures without replacing the result',
  'packages/web-rpc/test/internal-ownership-boundaries.test.ts::internal ownership boundary semantics keeps control and variation admission duplicate-safe and expiry-aware'
])

/** Map each non-retired frozen title to its required current file and test name. */
function migratedTitle(title: string): string | undefined {
  const [file, name] = title.split('::')
  if (retiredSuites.has(file.split('/').at(-1) ?? '') || retiredLayeringTitles.has(title))
    return undefined
  let path: string
  if (file.startsWith('packages/rpc-contract/test/')) {
    path = file.replace('packages/rpc-contract/test/', 'packages/rpc/test/contract/')
  } else if (
    file.startsWith('packages/web-rpc/test/adapters/') &&
    browserSuites.has(file.split('/').at(-1) ?? '')
  ) {
    path = file.replace('packages/web-rpc/test/', 'packages/rpc/test/browser/')
  } else {
    path = file.replace('packages/web-rpc/test/', 'packages/rpc/test/core/')
  }
  const mappedName = name
    .replace(
      'publishes only runtime-neutral root/framing exports and dependencies',
      'publishes only runtime-neutral contract/framing exports with an explicit dependency allowlist'
    )
    .replace('tagWebRpcError keeps', 'tagRpcError keeps')
    .replace('38 unique codes', '22 unique codes')
    .replace('22 unique codes', '23 unique codes')
    .replace('23 unique codes', '24 unique codes')
    .replace('24 unique codes', '25 unique codes')
    .replace('25 unique codes', '26 unique codes')
    .replace(
      'does not let a hostile code getter escape',
      'reports a hostile code getter as PROPERTY_READ_FAILED with the original cause'
    )
    .replace(
      'uses the canonical UNKNOWN code for untagged and cyclic errors alike',
      'uses the canonical UNKNOWN code for untagged errors and marks cyclic edges truncated'
    )
    .replace('a WebRpcLifecycleError', 'a RpcLifecycleError')
    .replace('real WebRpcPluginHost Promise', 'real RpcPluginHost Promise')
  return `${path}::${mappedName}`
}

/** Collect source files for a literal scan, excluding historical data snapshots. */
function testSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'fixtures' ? [] : testSources(path)
    return /\.(?:ts|mts|mjs|js)$/.test(entry.name) ? [path] : []
  })
}

/** Parse all static string literals, including import.meta.glob arguments. */
function stringsIn(file: string): string[] {
  const parsed = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const values: string[] = []
  /** Visit each descendant once and retain literal content, not surrounding syntax. */
  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) values.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(parsed)
  return values
}

describe('A7 migrated suite parity', () => {
  it('keeps every non-retired legacy file and title passed', () => {
    const run = spawnSync(
      'pnpm',
      ['exec', 'vitest', 'run', '--reporter=json', '--exclude', 'test/merge/suite-parity.test.ts'],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, CI: '1' }
      }
    )
    const report = JSON.parse(
      run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)
    ) as {
      testResults: {
        name: string
        message?: string
        assertionResults: { fullName: string; status: string; failureMessages?: string[] }[]
      }[]
    }
    /** Preserve the actual nested failure rather than only the last passing report rows. */
    const failures = report.testResults.flatMap((file) =>
      file.assertionResults
        .filter((item) => item.status === 'failed')
        .map((item) => ({
          file: file.name,
          title: item.fullName,
          failures: item.failureMessages
        }))
    )
    expect(run.status, `${JSON.stringify(failures)}\n${run.stderr}`).toBe(0)
    const actual = new Map<string, string>(
      report.testResults.flatMap((file) =>
        file.assertionResults.map(
          (test) =>
            [
              `${relative(resolve(packageRoot, '../..'), file.name)}::${test.fullName}`,
              test.status
            ] as const
        )
      )
    )
    const expected = [...legacyTitles.contract, ...legacyTitles.core]
      .map(migratedTitle)
      .filter((title): title is string => title !== undefined)
    for (const title of expected) expect(actual.get(title), title).toBe('passed')
  }, 30_000)

  it('contains no stale source or export-key literals in migrated tests', () => {
    // The delivered bridge and threads owners are valid destinations; obsolete roots still fail.
    const stale: string[] = []
    for (const file of testSources(join(packageRoot, 'test'))) {
      for (const literal of stringsIn(file)) {
        if (
          /^(?:\.\.?\/)*src\/(?!contract(?:\/|$)|core(?:\/|$)|browser(?:\/|$)|remote(?:\/|$)|process(?:\/|$)|bridge\/jsonrpc(?:\/|$)|threads(?:\/|$))/.test(
            literal
          ) ||
          /packages\/(?:rpc|web-rpc|rpc-contract)\/src\/(?!contract(?:\/|$)|core(?:\/|$)|browser(?:\/|$)|remote(?:\/|$)|process(?:\/|$)|bridge\/jsonrpc(?:\/|$)|threads(?:\/|$))/.test(
            literal
          ) ||
          literal.includes(['src/core/', 'core.ts'].join('')) ||
          /^\.\/(?:internal|adapters|features|middleware|wire|transport-constants|client|provider|full)(?:\/|$)/.test(
            literal
          )
        )
          stale.push(`${relative(packageRoot, file)}: ${literal}`)
      }
    }
    expect(stale).toEqual([])
  })
})
