import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/** Repository root; this file lives in `scripts/test/`. */
const root = fileURLToPath(new URL('../..', import.meta.url))

/** Registry of the plain-JavaScript files AGENTS.md allows in a TypeScript-only repository. */
const registry = JSON.parse(
  readFileSync(new URL('../fixtures/js-exceptions.json', import.meta.url), 'utf8')
)

/**
 * Lists tracked `.js`, `.mjs` and `.cjs` files. Untracked build output such as `dist/` never
 * appears, so generated files stay out of the registry.
 *
 * @returns {string[]} Repository-relative paths.
 */
function listTrackedJavaScript() {
  return execFileSync('git', ['ls-files', '-z', '--', '*.js', '*.mjs', '*.cjs'], {
    cwd: root,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
}

/** Registered paths, indexed once for the set comparisons below. */
const registered = new Set(registry.exceptions.map((entry) => entry.path))

test('every tracked JavaScript file is a registered exception', () => {
  const unregistered = listTrackedJavaScript().filter((path) => !registered.has(path))
  assert.deepEqual(
    unregistered,
    [],
    'convert these files to TypeScript, or register them in scripts/fixtures/js-exceptions.json with a reason'
  )
})

test('every registered exception is still tracked', () => {
  const tracked = new Set(listTrackedJavaScript())
  const stale = registry.exceptions.map((entry) => entry.path).filter((path) => !tracked.has(path))
  assert.deepEqual(stale, [], 'remove these stale entries from scripts/fixtures/js-exceptions.json')
})

test('every registered exception is unique and states a reason', () => {
  assert.equal(registered.size, registry.exceptions.length, 'duplicate registry paths')
  for (const entry of registry.exceptions)
    assert.ok(
      typeof entry.reason === 'string' && entry.reason.trim().length > 0,
      `${entry.path} has no reason`
    )
})

/** Directory or file prefixes where non-TypeScript source in another language is required. */
const foreignRoots = (registry.foreignLanguageRoots ?? []).map((entry) => entry.path)

/**
 * Lists tracked Python, Go, Rust and shell files.
 *
 * @returns {string[]} Repository-relative paths.
 */
function listTrackedForeign() {
  return execFileSync('git', ['ls-files', '-z', '--', '*.py', '*.go', '*.rs', '*.sh'], {
    cwd: root,
    encoding: 'utf8'
  })
    .split('\0')
    .filter(Boolean)
}

test('every tracked foreign-language file lives under a registered root', () => {
  const unregistered = listTrackedForeign().filter(
    (path) => !foreignRoots.some((prefix) => path.startsWith(prefix))
  )
  assert.deepEqual(
    unregistered,
    [],
    'register these roots in scripts/fixtures/js-exceptions.json foreignLanguageRoots with a reason'
  )
})

test('every registered foreign-language root still holds a tracked file and states a reason', () => {
  const tracked = listTrackedForeign()
  for (const entry of registry.foreignLanguageRoots ?? []) {
    assert.ok(
      tracked.some((path) => path.startsWith(entry.path)),
      `${entry.path} is stale`
    )
    assert.ok(
      typeof entry.reason === 'string' && entry.reason.trim().length > 0,
      `${entry.path} has no reason`
    )
  }
})
