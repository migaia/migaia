import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  checkErrorRegistry,
  collectErrorRegistry,
  REGISTRY_END,
  REGISTRY_START,
  repositoryRoot,
  writeErrorRegistry
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
  /** Additive I3 codes stay separate from the frozen pre-migration registry fixture. */
  const added = JSON.parse(
    readFileSync(join(repositoryRoot, 'packages/rpc/test/fixtures/error-format-added-codes.json'), 'utf8')
  )
  /** Additive I5 codes remain separate from both the frozen and I3 fixture sets. */
  const controlAdded = JSON.parse(
    readFileSync(join(repositoryRoot, 'packages/rpc/test/fixtures/control-semantics-added-codes.json'), 'utf8')
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
  assert.deepEqual(codes('@migaia/rpc/contract'), [...frozen.contract, ...added.contract, ...controlAdded.contract].sort())
  assert.deepEqual(
    codes('@migaia/rpc/core'),
    [...frozen.core.filter((code) => !retired.has(code)), ...added.core, ...controlAdded.core].sort()
  )
  assert.equal(codes('@migaia/capability/graph').length, 15)
  assert.deepEqual(codes('@migaia/rpc-contract'), [])
  assert.deepEqual(codes('@migaia/web-rpc'), [])
  assert.doesNotMatch(
    readFileSync(join(repositoryRoot, 'scripts/error-registry.mjs'), 'utf8'),
    /capability\/src\/graph/
  )
})

/** Lists every package-owned error-code declaration file below `directory`. */
const listErrorCodeFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    /** Absolute path of this directory entry. */
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listErrorCodeFiles(path)
    return entry.name === 'error-code.ts' ? [path] : []
  })

/** First sentence of the header JSDoc that precedes a file's first `export const`. */
const headerSentence = (text) => {
  /** Header comment body, when the file starts with one. */
  const body = text.slice(0, text.indexOf('export const')).match(/\/\*\*([\s\S]*?)\*\//)?.[1]
  if (body === undefined) return undefined
  /** Header text flattened to one line the way the generator flattens JSDoc. */
  const flat = body
    .split('\n')
    .map((line) => line.replace(/^\s*\*?\s?/, '').trim())
    .filter((line) => line.length > 0 && !line.startsWith('@'))
    .join(' ')
  /** Index of the first sentence terminator. */
  const boundary = flat.search(/[。！？]|[.!?](?:\s|$)/)
  return (boundary < 0 ? flat : flat.slice(0, boundary + 1)).replaceAll('|', '\\|').trim()
}

test('A13 attributes each entry JSDoc to its own code, never to the file header', () => {
  const root = createFixture(
    "/** Header sentence. */\nexport const ExampleErrorCode = {\n  /** Entry scenario. */\n  first: 'FIRST',\n  /** Second scenario. */\n  second: 'SECOND'\n} as const\n"
  )
  try {
    assert.deepEqual(
      collectErrorRegistry(root).map(({ code, scenario }) => ({ code, scenario })),
      [
        { code: 'FIRST', scenario: 'Entry scenario.' },
        { code: 'SECOND', scenario: 'Second scenario.' }
      ]
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('A13 rejects a first code without JSDoc even when a file header precedes it', () => {
  const root = createFixture(
    "/** Header sentence. */\nexport const ExampleErrorCode = {\n  first: 'FIRST',\n  /** Second scenario. */\n  second: 'SECOND'\n} as const\n"
  )
  try {
    assert.throws(() => collectErrorRegistry(root), /error code FIRST is missing descriptive JSDoc/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('A13 lists every utils code with its own scenario and regenerates a checkable registry', () => {
  const rows = collectErrorRegistry()
  /** Declared utils code values, read from the canonical declaration file. */
  const utilsCodes = [
    ...readFileSync(join(repositoryRoot, 'packages/utils/src/error-code.ts'), 'utf8').matchAll(
      /^\s*[A-Za-z][A-Za-z0-9]*\s*:\s*'([A-Z][A-Z0-9_]*)'/gm
    )
  ].map((match) => match[1])
  /** Registry rows owned by the utils package. */
  const utilsRows = rows.filter((row) => row.source === '@migaia/utils')
  assert.equal(utilsRows.length, 20)
  assert.deepEqual(new Set(utilsRows.map((row) => row.code)), new Set(utilsCodes))
  /** Header first sentences of every error-code file in the repository. */
  const headers = new Set(
    listErrorCodeFiles(join(repositoryRoot, 'packages'))
      .map((file) => headerSentence(readFileSync(file, 'utf8')))
      .filter((sentence) => sentence !== undefined && sentence.length > 0)
  )
  assert.ok(headers.size > 0)
  assert.deepEqual(
    rows.filter((row) => headers.has(row.scenario)),
    []
  )
  /** Scratch repository that reuses the real packages with its own registry document. */
  const root = mkdtempSync(join(tmpdir(), 'migai-error-registry-live-'))
  try {
    symlinkSync(join(repositoryRoot, 'packages'), join(root, 'packages'), 'dir')
    mkdirSync(join(root, 'docs/contracts'), { recursive: true })
    writeFileSync(
      join(root, 'docs/contracts/error-codes.md'),
      `# Registry\n${REGISTRY_START}\nstale\n${REGISTRY_END}\n`
    )
    writeErrorRegistry(root)
    assert.doesNotThrow(() => checkErrorRegistry(root))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
