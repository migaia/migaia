import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** Public surface and retained packed checks frozen by rpc-merge A11. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const legacy = JSON.parse(
  readFileSync(join(root, 'packages/rpc/test/fixtures/legacy-exports.json'), 'utf8')
)
const checks = [
  'subpath-imports',
  'obsolete-subpaths',
  'identity-observer-hidden',
  'define-feature-docs',
  'composed-runtime-hidden',
  'legacy-envelope-rejection',
  'contract-normalize',
  'legacy-codec-rejection',
  'canonical-protocol',
  'root-entry',
  'canonical-chunk',
  'type-contract-tsc',
  'selective-browser'
]
const obsolete = [
  '.',
  './browser',
  './core/memory',
  './core/message-port',
  './core/web-worker',
  './core/wire',
  './core/middleware/protocol',
  './core/middleware/chunk',
  './core/features/chunk',
  './core/internal/chunk-attachment'
]

/** Read the packed script's literal obsolete-subpath probe instead of matching comments. */
function obsoleteProbe(script) {
  const parsed = ts.createSourceFile(
    'packed-export-smoke.mjs',
    script,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  )
  for (const statement of parsed.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'obsoleteSubpaths')
        continue
      assert.ok(declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer))
      return declaration.initializer.elements.map((element) => {
        assert.ok(ts.isStringLiteral(element), 'obsoleteSubpaths must contain literal names')
        return element.text
      })
    }
  }
  assert.fail('obsoleteSubpaths literal probe is missing')
}

test('A11 packed consumer runs every preserved check against all 24 deep exports', () => {
  const script = readFileSync(join(root, 'packages/rpc/test/core/packed-export-smoke.mjs'), 'utf8')
  const run = spawnSync('pnpm', ['--filter', './packages/rpc', 'run', 'test:packed'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: '1' }
  })
  assert.equal(run.status, 0, `${run.stdout.slice(-3000)}\n${run.stderr.slice(-3000)}`)
  const lines = `${run.stdout}\n${run.stderr}`.split(/\r?\n/)
  const observedChecks = lines.flatMap((line) => {
    const match = /^CHECK ([a-z-]+) PASS$/.exec(line.trim())
    return match ? [match[1]] : []
  })
  assert.equal(observedChecks.length, 13)
  assert.deepEqual(observedChecks.sort(), [...checks].sort())
  const subpaths = new Map(
    lines.flatMap((line) => {
      const match = /^SUBPATH (@migaia\/rpc\/\S+) (\d+)$/.exec(line.trim())
      return match ? [[match[1], Number(match[2])]] : []
    })
  )
  assert.equal(subpaths.size, 24)
  for (const [name, record] of Object.entries(legacy)) {
    assert.equal(subpaths.get(name), record.names.length, name)
  }
  assert.deepEqual([...obsoleteProbe(script)].sort(), [...obsolete].sort())
  assert.ok(script.includes('@migaia/rpc/core/composed'))
  assert.ok(script.includes('dist/contract/'))
  assert.ok(script.includes('@migaia/rpc/core'))
})
