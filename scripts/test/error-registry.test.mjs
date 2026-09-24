import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  checkErrorRegistry,
  collectErrorRegistry,
  REGISTRY_END,
  REGISTRY_START
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
