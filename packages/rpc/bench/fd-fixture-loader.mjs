import { readFileSync, mkdirSync, writeFileSync, lstatSync, symlinkSync } from 'node:fs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { IpcBenchPreparationText } from './text.mjs'

/** Runtime identifiers used by the canonical factory; paths change only at module loading. */
const fixtureImports = Object.freeze({
  spawn: 'node:child_process',
  once: 'node:events',
  randomUUID: 'node:crypto',
  CapabilityLevel: '@migaia/supervision',
  ProcessCapability: '@migaia/supervision/process',
  createNodeProcessLauncher: '../../../src/process/adapters/node-child-process.js',
  nodeByteStream: '../../../src/process/adapters/node-byte-stream.js'
})

/**
 * Reject a changed canonical runtime import instead of silently running a stale hand-written list.
 *
 * @param {string} source Canonical TypeScript fixture.
 * @param {string} body Type-erased factory body; type-only imports are deliberately absent.
 * @returns {void} All imports used by the body agree with the maintained preamble.
 * @throws {import('node:assert').AssertionError} A used import is added, renamed or moved.
 */
export function assertFdFixtureImports(source, body) {
  /** Derive used runtime imports from the fixture itself, including mixed type/value imports. */
  const used = {}
  for (const match of source.matchAll(
    /import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g
  )) {
    if (match[1]) continue
    for (const binding of match[2].split(',')) {
      const name = binding.trim()
      if (!name || name.startsWith('type ')) continue
      const local = name.split(/\s+as\s+/).at(-1)
      if (new RegExp(`\\b${local}\\b`).test(body)) used[local] = match[3]
    }
  }
  assert.deepEqual(used, fixtureImports, IpcBenchPreparationText.fdImportsDrifted)
}

/**
 * Load the existing caller FD launcher unchanged through offline type erasure (K249/D-b).
 *
 * @returns {Promise<import('@migaia/supervision/process').IProcessLauncher>} Original fixture
 *   factory result.
 * @throws {Error} Missing original declaration, type erasure or canonical adapter load failure.
 */
export async function loadFdLauncher() {
  /** Bun delegates preparation-time type erasure to Node; neither compiler runs in the window. */
  if (process.versions.bun) {
    const path = execFileSync('node', [fileURLToPath(import.meta.url), '--prepare'], {
      encoding: 'utf8'
    }).trim()
    return (await import(pathToFileURL(path).href)).fdLauncher()
  }
  const path = await prepare()
  return (await import(pathToFileURL(path).href)).fdLauncher()
}

/** Erase the sole canonical function body into a worktree-specific temporary module. */
async function prepare() {
  const { stripTypeScriptTypes } = await import('node:module')
  const fixture = new URL('../test/bridge/fixtures/jsonrpc-process.ts', import.meta.url)
  const source = readFileSync(fixture, 'utf8')
  const start = source.indexOf('export function fdLauncher(')
  const end = source.indexOf('\n/**', start)
  assert.ok(start >= 0 && end >= 0, IpcBenchPreparationText.fdDeclarationMissing)
  /**
   * Only module locations change; the maintained factory implementation is never copied or
   * rewritten.
   */
  const preamble = `import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {CapabilityLevel} from '@migaia/supervision';
import {ProcessCapability} from '@migaia/supervision/process';
import {createNodeProcessLauncher} from '@migaia/rpc/process/adapters/node-child-process';
import {nodeByteStream} from ${JSON.stringify(new URL('../dist/process/adapters/node-byte-stream.js', import.meta.url).href)};
`
  const body = stripTypeScriptTypes(source.slice(start, end))
  assertFdFixtureImports(source, body)
  const key = createHash('sha256').update(fixture.href).digest('hex').slice(0, 12)
  const directory = join(tmpdir(), `rpc-bench-fd-${key}`)
  mkdirSync(directory, { recursive: true })
  mkdirSync(join(directory, 'node_modules/@migaia'), { recursive: true })
  for (const name of ['rpc', 'supervision']) {
    const link = join(directory, 'node_modules/@migaia', name)
    if (!lstatSync(link, { throwIfNoEntry: false }))
      symlinkSync(resolve(fileURLToPath(new URL('../../', import.meta.url)), name), link)
  }
  const path = join(directory, 'fd-launcher.mjs')
  writeFileSync(path, preamble + body)
  return path
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--prepare'))
  prepare().then(
    (path) => console.log(path),
    (error) => {
      console.error(error)
      process.exitCode = 1
    }
  )
