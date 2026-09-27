import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** Repository root and retired names are fixed by rpc-merge A6. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const legacyPattern =
  /@migaia\/(?:rpc-contract|web-rpc)|(?:rpc-contract|web-rpc)\/|packages\/(?:rpc-contract|web-rpc)/g
/** A5 cases intentionally name legacy sources while checking their absence. */
const permittedA5Titles = new Set([
  'A5 uses a layer ERROR_SOURCE and falls back to the package name',
  'A5 maps merged RPC codes and preserves capability graph ownership'
])

/** Return source-like files, excluding build products and S1 historical evidence. */
function filesUnder(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    const relativePath = relative(root, path).replaceAll('\\', '/')
    if (entry.isDirectory()) {
      if (['node_modules', 'dist'].includes(entry.name)) return []
      if (relativePath === 'packages/rpc/test/merge') return []
      if (relativePath === 'website') return []
      return filesUnder(path)
    }
    if (relativePath.startsWith('scripts/test/rpc-merge-')) return []
    if (/^packages\/rpc\/test\/fixtures\/legacy-.*\.json$/.test(relativePath)) return []
    if (relativePath.startsWith('packages/storage-web/test/fixtures/storage-v2-')) return []
    if (
      relativePath === 'packages/event-subscriber/test/fixtures/storage-v2-b00-capability-map.json'
    )
      return []
    return [path]
  })
}

/** Mask only the two A5 cases before scanning the remaining registry tests. */
function scanText(file) {
  const source = readFileSync(file, 'utf8')
  if (relative(root, file) !== 'scripts/test/error-registry.test.mjs') return source
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let result = source
  for (const statement of [...parsed.statements].reverse()) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue
    const call = statement.expression
    if (call.expression.getText(parsed) !== 'test') continue
    const title = call.arguments[0]
    if (!title || !ts.isStringLiteral(title)) continue
    if (!permittedA5Titles.has(title.text)) continue
    result =
      result.slice(0, statement.pos) +
      source.slice(statement.pos, statement.end).replace(/[^\n]/g, ' ') +
      result.slice(statement.end)
  }
  return result
}

/** Enumerate exactly the SDD's package, fixture, script, and root reader surfaces. */
function readerFiles() {
  const packageFiles = readdirSync(join(root, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const packageRoot = join(root, 'packages', entry.name)
      const tree = ['src', 'test', 'e2e'].flatMap((name) => filesUnder(join(packageRoot, name)))
      const metadata = readdirSync(packageRoot)
        .filter(
          (name) =>
            name === 'package.json' ||
            /^tsconfig.*\.json$/.test(name) ||
            /^vitest.*\.ts$/.test(name) ||
            ['README.md', 'USEGUIDE.md'].includes(name)
        )
        .map((name) => join(packageRoot, name))
      return [...tree, ...metadata]
    })
  return [
    ...packageFiles,
    ...filesUnder(join(root, 'fixtures')),
    ...filesUnder(join(root, 'scripts')),
    ...['Makefile', 'package.json', 'pnpm-lock.yaml', 'coverage-baseline.json'].map((name) =>
      join(root, name)
    )
  ]
}

test('A6 removes every old RPC package reader and both obsolete package directories', () => {
  assert.equal(existsSync(join(root, 'packages/rpc-contract')), false)
  assert.equal(existsSync(join(root, 'packages/web-rpc')), false)
  const matches = readerFiles().flatMap((file) => {
    const relativePath = relative(root, file)
    const source = scanText(file)
    return [...source.matchAll(legacyPattern)].map(
      (match) => `${relativePath}:${source.slice(0, match.index).split('\n').length}:${match[0]}`
    )
  })
  assert.equal(matches.length, 0, matches.slice(0, 30).join('\n'))
})
