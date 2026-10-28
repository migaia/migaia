import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

/** The repository root supplies real package publications and consumer source files. */
const repository = fileURLToPath(new URL('../../../../', import.meta.url))
/** Each row keeps the published subpath stable while renaming its one factory export. */
const factories = [
  ['rpc-host', 'features', 'retry', 'retry'],
  ['rpc-host', 'features', 'timeout', 'timeout'],
  ['rpc-host', 'plugins', 'auth', 'auth'],
  ['rpc-host', 'plugins', 'chunk', 'chunk'],
  ['rpc-host', 'plugins', 'batch', 'batch'],
  ['rpc-host', 'plugins', 'error-map', 'errorMap'],
  ['rpc-host', 'plugins', 'schema', 'schema'],
  ['rpc-host', 'plugins', 'limits', 'limits'],
  ['rpc-host', 'plugins', 'idempotency', 'idempotency'],
  ['rpc-plugin-process', 'features', 'send-queue', 'sendQueue'],
  ['rpc-plugin-process', 'features', 'flow-control', 'flowControl'],
  ['rpc-plugin-process', 'features', 'log', 'ipcLog']
] as const
/** Consumer scope excludes the separately owned website documentation migration. */
const consumers = [
  'rpc-host',
  'rpc-plugin-process',
  'rpc-plugin-browser',
  'rpc-plugin-coroutines',
  'rpc-plugin-devtools',
  'rpc-plugin-pool',
  'rpc-plugin-thread',
  'rpc-integration',
  'tray',
  'store-worker'
] as const

/** Assert public aggregate/subpath identity in the owning package's actual Node realm. */
function verifyFactory(owner: string, group: string, subpath: string, previous: string): void {
  /** Self-reference resolves package.json exports without borrowing a sibling dependency. */
  const aggregate = `@migaia/${owner}/${group}`
  /** The renamed export deliberately retains the previous public subpath. */
  const renamed = `${previous}Feature`
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `
import { strict as assert } from 'node:assert'
/** Resolve the real aggregate in its package self-reference realm. */
const aggregate = await import(${JSON.stringify(aggregate)})
/** The existing subpath must expose the exact same function object. */
const direct = await import(${JSON.stringify(`${aggregate}/${subpath}`)})
assert.equal(typeof aggregate[${JSON.stringify(renamed)}], 'function')
assert.equal(direct.default, aggregate[${JSON.stringify(renamed)}])
assert.equal(direct[${JSON.stringify(renamed)}], aggregate[${JSON.stringify(renamed)}])
assert.equal(Object.hasOwn(aggregate, ${JSON.stringify(previous)}), false)
assert.equal(Object.hasOwn(direct, ${JSON.stringify(previous)}), false)
`
    ],
    { cwd: resolve(repository, 'packages', owner), stdio: 'pipe' }
  )
}

/** Match only exports of the twelve factories, including source/dist relative references. */
function factoryNames(module: string, file: string): Set<string> {
  /** A relative consumer resolves to the same source or emitted owner as its public entry. */
  const relative = module.startsWith('.')
    ? resolve(dirname(file), module).replace(/\.(?:ts|js)$/, '')
    : ''
  /** This lookup is bounded by the twelve compile-time publication rows above. */
  const names = new Set<string>()
  for (const [owner, group, subpath, previous] of factories) {
    /** Public paths and their source layout differ only for host flow features. */
    const publicEntry = `@migaia/${owner}/${group}`
    /** The seven host flow factories live under features/<name>/index. */
    const sourceGroup = owner === 'rpc-host' && group === 'plugins' ? 'features' : group
    /** Host flow folders have index entries; process and retry/timeout use direct files. */
    const leaf = owner === 'rpc-host' && group === 'plugins' ? `${subpath}/index` : subpath
    if (
      module === publicEntry ||
      module === `${publicEntry}/${subpath}` ||
      relative === resolve(repository, 'packages', owner, 'src', group, 'index') ||
      relative === resolve(repository, 'packages', owner, 'dist', group, 'index') ||
      relative === resolve(repository, 'packages', owner, 'src', sourceGroup, leaf) ||
      relative === resolve(repository, 'packages', owner, 'dist', sourceGroup, leaf)
    )
      names.add(previous)
  }
  return names
}

/** Collect old exported keys without treating default bindings, fields or utils retry as exports. */
function legacyReads(text: string, file: string): string[] {
  /** Each match records the imported key before an optional local alias. */
  const reads: string[] = []
  /** These two patterns cover static named imports and literal dynamic import destructuring. */
  const imports = [
    /\bimport\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g,
    /\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(?:await\s+)?import\(['"]([^'"]+)['"]\)/g
  ]
  for (const pattern of imports) {
    for (const match of text.matchAll(pattern)) {
      /** Only keys from the resolved owner can represent a retired factory export. */
      const names = factoryNames(match[2]!, file)
      for (const item of match[1]!.split(',')) {
        /** Remove type-only syntax while preserving imported/destructured key ownership. */
        const name = item
          .trim()
          .replace(/^type\s+/, '')
          .split(/\s+as\s+|\s*:\s*/)[0]!
        if (names.has(name)) reads.push(`${match[2]}:${name}`)
      }
    }
  }
  /** Namespace bindings have the same public key contract as named imports. */
  const namespaces = [
    /\bimport\s*\*\s*as\s*(\w+)\s+from\s+['"]([^'"]+)['"]/g,
    /\b(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?import\(['"]([^'"]+)['"]\)/g
  ]
  /** Resolve each namespace once so member scanning stays linear in the source size. */
  const bindings = new Map<string, { module: string; names: Set<string> }>()
  for (const pattern of namespaces) {
    for (const match of text.matchAll(pattern)) {
      bindings.set(match[1]!, { module: match[2]!, names: factoryNames(match[2]!, file) })
    }
  }
  /** All dot and string-computed reads share one traversal, independent of binding count. */
  const members = /\b(\w+)(?:\.(\w+)|\[['"]([^'"]+)['"]\])/g
  for (const member of text.matchAll(members)) {
    /** Only a binding resolved to one of the factory publications owns a retired key. */
    const binding = bindings.get(member[1]!)
    /** Dot and string-computed reads select the same exported key. */
    const name = member[2] ?? member[3]!
    if (binding?.names.has(name)) reads.push(`${binding.module}:${name}`)
  }
  return reads
}

/** Cover the admitted source, fixtures and bilingual package examples with one cursor traversal. */
function verifyConsumers(): void {
  /** A queue cursor visits every consumer file once without shifting a growable array. */
  const directories = consumers.map(consumerDirectory)
  /** Report every offending source instead of stopping at the first import. */
  const reads: string[] = []
  for (let cursor = 0; cursor < directories.length; cursor++) {
    for (const entry of readdirSync(directories[cursor]!, { withFileTypes: true })) {
      /** Dependencies, build output and coverage are not consumer source. */
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'coverage')
        continue
      /** Resolve each entry against its current directory, preserving actual relative imports. */
      const file = resolve(directories[cursor]!, entry.name)
      if (entry.isDirectory()) directories.push(file)
      else if (
        /\.(?:ts|tsx|mts|mjs)$/.test(extname(file)) ||
        /^README|^USEGUIDE/.test(entry.name)
      ) {
        if (file === fileURLToPath(import.meta.url)) continue
        for (const read of legacyReads(readFileSync(file, 'utf8'), file))
          reads.push(`${file}:${read}`)
      }
    }
  }
  /** Existing tree-shaking templates consume public factory names as actual import source. */
  const treeShaking = resolve(repository, 'scripts/test/package-tree-shaking.test.mjs')
  reads.push(...legacyReads(readFileSync(treeShaking, 'utf8'), treeShaking))
  expect(reads).toEqual([])
}

/** Resolve a fixed consumer package without capturing traversal state in a callback. */
function consumerDirectory(name: string): string {
  return resolve(repository, 'packages', name)
}

/** Prove aliases and namespaces are detected while unrelated values retain their spelling. */
function verifyScanControls(): void {
  /** This fixture deliberately includes the three retired export-read forms. */
  const rejected =
    "import { timeout as local } from '@migaia/rpc-host/features'; const { limits: limited } = await import('@migaia/rpc-host/plugins/limits'); import * as policies from '@migaia/rpc-host/plugins'; policies.auth; policies['chunk']"
  expect(legacyReads(rejected, resolve(repository, 'packages/rpc-host/test/example.ts'))).toEqual([
    '@migaia/rpc-host/features:timeout',
    '@migaia/rpc-host/plugins/limits:limits',
    '@migaia/rpc-host/plugins:auth',
    '@migaia/rpc-host/plugins:chunk'
  ])
  expect(
    legacyReads(
      "import timeout from '@migaia/rpc-host/features/timeout'; import { retry } from '@migaia/utils'; const options = { timeout: 1 };",
      resolve(repository, 'packages/rpc-host/test/example.ts')
    )
  ).toEqual([])
}

it.each(factories)('publishes %s/%s/%s through its renamed factory', verifyFactory)
it(
  'finds retired named, dynamic and namespace exports without matching local values',
  verifyScanControls
)
it('migrates every admitted consumer to the renamed public export keys', verifyConsumers)
