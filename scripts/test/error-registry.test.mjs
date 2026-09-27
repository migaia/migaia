import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  checkErrorRegistry,
  collectErrorRegistry,
  REGISTRY_END,
  REGISTRY_START,
  repositoryRoot
} from '../error-registry.mjs'

/** Creates the smallest repository shape understood by the registry collector. */
const createFixture = (source) => {
  const root = mkdtempSync(join(tmpdir(), 'migai-error-registry-'))
  const packageRoot = join(root, 'packages/example')
  mkdirSync(join(packageRoot, 'src'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@migaia/example' }))
  writeFileSync(join(packageRoot, 'src/error-code.ts'), source)
  return root
}

test('rejects a code whose declaration has no descriptive JSDoc', () => {
  const root = createFixture("export const ExampleErrorCode = { broken: 'BROKEN' } as const\n")
  try {
    assert.throws(() => collectErrorRegistry(root), /missing descriptive JSDoc/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('rejects a present registry whose generated region is stale', () => {
  const root = createFixture(
    "export const ExampleErrorCode = {\n  /** Raised when the example input is invalid. */\n  broken: 'BROKEN'\n} as const\n"
  )
  try {
    mkdirSync(join(root, 'docs/contracts'), { recursive: true })
    writeFileSync(
      join(root, 'docs/contracts/error-codes.md'),
      `# Registry\n${REGISTRY_START}\nstale\n${REGISTRY_END}\n`
    )
    assert.throws(() => checkErrorRegistry(root), /registry is stale/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('accepts an absent ignored registry after validating declaration JSDoc', () => {
  const root = createFixture(
    "export const ExampleErrorCode = {\n  /** Raised when the example input is invalid. */\n  broken: 'BROKEN'\n} as const\n"
  )
  const warnings = []
  const originalWarn = console.warn
  console.warn = (message) => warnings.push(String(message))
  try {
    assert.doesNotThrow(() => checkErrorRegistry(root))
    assert.deepEqual(warnings, ['error registry is absent: docs/contracts/error-codes.md'])
  } finally {
    console.warn = originalWarn
    rmSync(root, { recursive: true, force: true })
  }
})

test('A5 uses a layer ERROR_SOURCE and falls back to the package name', () => {
  const root = createFixture(
    "export const ExampleErrorCode = {\n  /** Raised when the root input is invalid. */\n  rootInvalid: 'ROOT_INVALID'\n} as const\n"
  )
  try {
    const packageRoot = join(root, 'packages/example')
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@fixture/a' }))
    mkdirSync(join(packageRoot, 'src/x'), { recursive: true })
    writeFileSync(
      join(packageRoot, 'src/x/error-code.ts'),
      "export const ERROR_SOURCE = '@fixture/a/custom'\nexport const LayerErrorCode = {\n  /** Raised when the layer input is invalid. */\n  layerInvalid: 'LAYER_INVALID'\n} as const\n"
    )
    assert.deepEqual(
      collectErrorRegistry(root).map(({ source, code }) => ({ source, code })),
      [
        { source: '@fixture/a', code: 'ROOT_INVALID' },
        { source: '@fixture/a/custom', code: 'LAYER_INVALID' }
      ]
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('A5 maps merged RPC codes and preserves capability graph ownership', () => {
  const frozen = JSON.parse(
    readFileSync(join(repositoryRoot, 'packages/rpc/test/fixtures/legacy-error-codes.json'), 'utf8')
  )
  /** Core codes the successor rpc-layering BC1 deleted after this merge froze its code set. */
  const retired = new Set(
    JSON.parse(
      readFileSync(
        join(repositoryRoot, 'packages/rpc/test/fixtures/layering-retired-codes.json'),
        'utf8'
      )
    ).codes
  )
  const rows = collectErrorRegistry()
  const codes = (source) => rows.filter((row) => row.source === source).map((row) => row.code)
  assert.deepEqual(codes('@migaia/rpc/contract'), frozen.contract)
  assert.deepEqual(
    codes('@migaia/rpc/core'),
    frozen.core.filter((code) => !retired.has(code))
  )
  assert.equal(codes('@migaia/capability/graph').length, 15)
  assert.deepEqual(codes('@migaia/rpc-contract'), [])
  assert.deepEqual(codes('@migaia/web-rpc'), [])
  assert.doesNotMatch(
    readFileSync(join(repositoryRoot, 'scripts/error-registry.mjs'), 'utf8'),
    /capability\/src\/graph/
  )
})
