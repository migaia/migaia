import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** Workspace root used for the tracked-source and manifest checks. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** Only tracked test, e2e, fixture, and repository script sources are guarded. */
const SCAN_PREFIXES = ['packages/', 'scripts/', 'fixtures/']
/** The registry maintainer and its isolated temporary-root test are intentional exceptions. */
const EXEMPT = new Map([
  ['scripts/error-registry.mjs', 'maintains the local untracked registry'],
  ['scripts/test/error-registry.test.mjs', 'creates its own temporary registry fixture']
])
/** Source extensions whose string literals can name workspace files. */
const SOURCE_SUFFIX = /\.(?:ts|tsx|mts|cts|js|mjs|cjs)$/
/** A path component naming the workspace documentation tree. */
const DOCS_COMPONENT = /(?:^|[\s/\\])docs[/\\]/

/** Returns tracked and untracked non-ignored paths without shell glob expansion. */
function workspacePaths() {
  const result = spawnSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    }
  )
  assert.equal(result.status, 0, result.stderr)
  return [...new Set(result.stdout.split('\0').filter(Boolean))].sort()
}

/** Selects only the R1 source paths from a Git path inventory. */
function isGuardedSource(path) {
  if (!SOURCE_SUFFIX.test(path)) return false
  if (path.startsWith(SCAN_PREFIXES[1]) || path.startsWith(SCAN_PREFIXES[2])) return true
  return /^packages\/[^/]+\/(?:test|e2e)\//.test(path)
}

/**
 * Finds literal path reads of the workspace documentation tree. TypeScript's scanner ignores
 * comments while retaining precise token positions.
 *
 * @param {string} sourceText JavaScript or TypeScript source text.
 * @returns {{ line: number; literal: string }[]} Matching literals and line numbers.
 */
export function findDocsReads(sourceText) {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    sourceText
  )
  const matches = []
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token !== ts.SyntaxKind.StringLiteral &&
      token !== ts.SyntaxKind.NoSubstitutionTemplateLiteral &&
      token !== ts.SyntaxKind.TemplateHead &&
      token !== ts.SyntaxKind.TemplateMiddle &&
      token !== ts.SyntaxKind.TemplateTail
    )
      continue
    const literal = scanner.getTokenText()
    const content = scanner.getTokenValue()
    if (content !== 'docs' && !DOCS_COMPONENT.test(content)) continue
    const line = sourceText.slice(0, scanner.getTokenPos()).split('\n').length
    matches.push({ line, literal })
  }
  return matches
}

/**
 * Finds package scripts that depend on the ignored documentation tree.
 *
 * @param {{ scripts?: Record<string, string> }} manifest A package manifest.
 * @returns {[string, string][]} Offending script names and values.
 */
export function findDocsScripts(manifest) {
  return Object.entries(manifest.scripts ?? {}).filter(
    ([, value]) => value === 'docs' || DOCS_COMPONENT.test(value)
  )
}

test('TDI A2 recognizes real path literals without treating comments or names as reads', () => {
  /** Build the fixture path at runtime so the guard does not flag its own test data. */
  const docs = 'do' + 'cs'
  const source = [
    `new URL('../../../${docs}/x.sdd.md', import.meta.url)`,
    `resolve(root, '${docs}/contracts/a.md')`,
    `/** ${docs}/a.md */`,
    `// ${docs}/a.md`,
    `'define-feature-${docs}'`,
    `'${docs}\\n'`
  ].join('\n')
  assert.deepEqual(
    findDocsReads(source).map(({ line }) => line),
    [1, 2]
  )
  assert.deepEqual(findDocsScripts({ scripts: { a: 'node x.mjs', b: `cat ${docs}/a.md` } }), [
    ['b', `cat ${docs}/a.md`]
  ])
  assert.deepEqual(
    [...EXEMPT.keys()],
    ['scripts/error-registry.mjs', 'scripts/test/error-registry.test.mjs']
  )
})

test(
  'TDI A1 scans tracked test and script sources',
  {
    skip: process.env.TDI_ENFORCE ? false : 'S1 red baseline; enable after S4 removes the readers'
  },
  () => {
    const paths = workspacePaths()
    const sources = paths.filter(isGuardedSource)
    assert.ok(sources.length > 0, 'source inventory must not be empty')
    const violations = []
    for (const path of sources) {
      if (EXEMPT.has(path)) continue
      for (const { line } of findDocsReads(readFileSync(join(root, path), 'utf8')))
        violations.push(`${path}:${line}`)
    }
    for (const path of paths.filter(
      (entry) => entry === 'package.json' || /^packages\/[^/]+\/package\.json$/.test(entry)
    )) {
      const manifest = JSON.parse(readFileSync(join(root, path), 'utf8'))
      for (const [name, value] of findDocsScripts(manifest))
        violations.push(`${path}:scripts.${name} ${value}`)
    }
    assert.deepEqual(violations, [], violations.join('\n'))
    assert.ok(!paths.includes('packages/storage-web/test/reconcile-error-registry.mjs'))
  }
)

/** Explicit refs keep unrelated earlier production changes out of this SDD's preserve check. */
const base = process.env.TDI_BASE
const change = process.env.TDI_CHANGE
test(
  'TDI A6 leaves production source untouched',
  {
    skip: base && change ? false : 'set TDI_BASE and TDI_CHANGE to audit source preservation'
  },
  () => {
    const pathspec = 'packages/*/src/**'
    for (const args of [
      ['diff', '--name-only', base, change, '--', pathspec],
      ['status', '--porcelain', '--untracked-files=all', '--', pathspec]
    ]) {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stdout, '', `${args.join(' ')}: ${result.stdout}`)
    }
  }
)
