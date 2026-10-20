import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseSync } from 'oxc-parser'

/** Public surface and retained packed checks frozen by the rpc merge. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** The reviewed current baseline owns exact names; export-mapping preserves historic deltas. */
const baseline = JSON.parse(
  readFileSync(join(root, 'scripts/fixtures/public-exports.baseline.json'), 'utf8')
).packages
/** Runtime artifacts after removal of the forwarding bridge package. */
const owners = ['rpc-contract', 'rpc-core', 'rpc-process', 'rpc-threads', 'rpc-browser']
const checks = [
  'five-packed-artifacts',
  'runtime-peer-pair',
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
  './browser',
  './memory',
  './message-port',
  './web-worker',
  './wire',
  './middleware/protocol',
  './middleware/chunk',
  './features/chunk',
  './internal/chunk-attachment'
]

/** Read the packed script's literal obsolete-subpath probe instead of matching comments. */
function obsoleteProbe(script) {
  for (const statement of parseSync('packed-export-smoke.mjs', script).program.body) {
    if (statement.type !== 'VariableDeclaration') continue
    for (const declaration of statement.declarations) {
      if (declaration.id.type !== 'Identifier' || declaration.id.name !== 'obsoleteSubpaths')
        continue
      assert.ok(declaration.init?.type === 'ArrayExpression')
      return declaration.init.elements.map((element) => {
        assert.ok(
          element?.type === 'Literal' && typeof element.value === 'string',
          'obsoleteSubpaths must contain literal names'
        )
        return element.value
      })
    }
  }
  assert.fail('obsoleteSubpaths literal probe is missing')
}

test('packed consumer runs every preserved check against the current five owners', () => {
  const script = readFileSync(
    join(root, 'packages/rpc-integration/test/core/packed-export-smoke.mjs'),
    'utf8'
  )
  const run = spawnSync('pnpm', ['--filter', './packages/rpc-integration', 'run', 'test:packed'], {
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
  assert.equal(observedChecks.length, checks.length)
  assert.deepEqual(observedChecks.sort(), [...checks].sort())
  const subpaths = new Map(
    lines.flatMap((line) => {
      const match =
        /^SUBPATH (@migaia\/rpc(?:-contract|-core|-process|-threads|-browser)(?:\/\S+)?) (\d+)$/.exec(
          line.trim()
        )
      return match ? [[match[1], Number(match[2])]] : []
    })
  )
  /** Packed imports must retain every reviewed runtime name count, including schema defaults. */
  const expected = owners.flatMap((owner) =>
    Object.entries(baseline['@migaia/' + owner]).map(([key, names]) => [
      '@migaia/' + owner + (key === '.' ? '' : key.slice(1)),
      names.length
    ])
  )
  expected.push(['@migaia/rpc-contract/schema/wire-error', 1])
  assert.equal(subpaths.size, expected.length)
  for (const [name, count] of expected) assert.equal(subpaths.get(name), count, name)
  assert.equal(subpaths.has('@migaia/rpc-bridge-jsonrpc'), false)
  assert.deepEqual([...obsoleteProbe(script)].sort(), [...obsolete].sort())
  assert.ok(script.includes('@migaia/rpc-core/composed'))
  assert.ok(script.includes('dist/contract/'))
  assert.ok(script.includes('@migaia/rpc-core'))
})
