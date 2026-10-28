import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'

/** Repository root and retired names are fixed by the rpc merge. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/**
 * Only `web-rpc` stays retired. The later package split reintroduced `@migaia/rpc-contract` as the
 * canonical wire-contract owner, so its name is a live package, not a legacy reader.
 */
const legacyPattern = /@migaia\/web-rpc|web-rpc\/|packages\/web-rpc/g
/** Cases intentionally name legacy sources while checking their absence. */
const permittedLegacyTitles = new Set([
  'uses a layer ERROR_SOURCE and falls back to the package name',
  'maps merged RPC codes and preserves capability graph ownership'
])

/** Return source-like files, excluding build products and historical evidence. */
function filesUnder(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    const relativePath = relative(root, path).replaceAll('\\', '/')
    if (entry.isDirectory()) {
      if (['node_modules', 'dist'].includes(entry.name)) return []
      if (relativePath === 'packages/rpc-integration/test/merge') return []
      if (relativePath === 'website') return []
      return filesUnder(path)
    }
    if (relativePath.startsWith('scripts/test/rpc-merge-')) return []
    if (/^packages\/rpc-integration\/test\/fixtures\/legacy-.*\.json$/.test(relativePath)) return []
    if (relativePath.startsWith('packages/storage-plugin-browser/test/fixtures/storage-v2-')) return []
    if (
      relativePath === 'packages/event-subscriber/test/fixtures/storage-v2-capability-map.json'
    )
      return []
    return [path]
  })
}

/** Mask only the two legacy-source cases before scanning the remaining registry tests. */
function scanText(file) {
  const source = readFileSync(file, 'utf8')
  if (relative(root, file) !== 'scripts/test/error-registry.test.mjs') return source
  const statements = parseSync(file, source).program.body
  let result = source
  for (let index = statements.length - 1; index >= 0; index--) {
    const statement = statements[index]
    if (statement.type !== 'ExpressionStatement' || statement.expression.type !== 'CallExpression')
      continue
    const call = statement.expression
    if (source.slice(call.callee.start, call.callee.end) !== 'test') continue
    const title = call.arguments[0]
    if (title?.type !== 'Literal' || typeof title.value !== 'string') continue
    if (!permittedLegacyTitles.has(title.value)) continue
    /** Blank from the previous statement's end, so leading comments go with the test block. */
    const start = index > 0 ? statements[index - 1].end : 0
    result =
      result.slice(0, start) +
      source.slice(start, statement.end).replace(/[^\n]/g, ' ') +
      result.slice(statement.end)
  }
  return result
}

/** Enumerate exactly the package, fixture, script, and root reader surfaces. */
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

test('removes every old RPC package reader and both obsolete package directories', () => {
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
