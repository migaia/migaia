import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/** Compare signed current baseline with the exact frozen old-package counts. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const old = JSON.parse(
  readFileSync(join(root, 'packages/rpc/test/fixtures/legacy-coverage.json'), 'utf8')
)
const current = JSON.parse(readFileSync(join(root, 'coverage-baseline.json'), 'utf8')).packages

test('A10 merged RPC coverage preserves covered counts and combined percentages', () => {
  assert.ok(current.rpc, 'rpc coverage entry is required')
  assert.equal(Object.hasOwn(current, 'rpc-contract'), false)
  assert.equal(Object.hasOwn(current, 'web-rpc'), false)
  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    const covered = old['rpc-contract'][metric].covered + old['web-rpc'][metric].covered
    const total = old['rpc-contract'][metric].total + old['web-rpc'][metric].total
    const pct = Math.round((covered / total) * 10_000) / 100
    assert.ok(
      current.rpc[metric].covered >= covered,
      `${metric}: covered ${current.rpc[metric].covered} < ${covered}`
    )
    assert.ok(current.rpc[metric].pct >= pct, `${metric}: pct ${current.rpc[metric].pct} < ${pct}`)
    assert.ok(
      current.capability[metric].covered >= old.capability[metric].covered,
      `${metric}: capability coverage fell`
    )
  }
})
