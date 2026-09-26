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
  'intended-cost-custody.test.ts'
])

/** Map a frozen title to its required new file and unchanged test name. */
function migratedTitle(title: string): string | undefined {
  const [file, name] = title.split('::')
  if (retiredSuites.has(file.split('/').at(-1) ?? '')) return undefined
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
  const mappedName = name.replace(
    'publishes only runtime-neutral root/framing exports and dependencies',
    'publishes only runtime-neutral contract/framing exports with an explicit dependency allowlist'
  )
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
    expect(run.status, `${run.stdout.slice(-2000)}\n${run.stderr.slice(-2000)}`).toBe(0)
    const report = JSON.parse(
      run.stdout.slice(run.stdout.indexOf('{'), run.stdout.lastIndexOf('}') + 1)
    ) as {
      testResults: { name: string; assertionResults: { fullName: string; status: string }[] }[]
    }
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
    const stale: string[] = []
    for (const file of testSources(join(packageRoot, 'test'))) {
      for (const literal of stringsIn(file)) {
        if (
          /^(?:\.\.?\/)*src\/(?!contract\/|core\/|browser\/)/.test(literal) ||
          /packages\/(?:rpc|web-rpc|rpc-contract)\/src\/(?!contract\/|core\/|browser\/)/.test(
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
