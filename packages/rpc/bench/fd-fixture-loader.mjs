import { readFileSync, mkdirSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

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
  if (start < 0 || end < 0) throw new Error('Canonical FD fixture declaration missing')
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
  const key = createHash('sha256').update(fixture.href).digest('hex').slice(0, 12)
  const directory = join(tmpdir(), `rpc-bench-fd-${key}`)
  mkdirSync(directory, { recursive: true })
  mkdirSync(join(directory, 'node_modules/@migaia'), { recursive: true })
  for (const name of ['rpc', 'supervision']) {
    const link = join(directory, 'node_modules/@migaia', name)
    if (!existsSync(link))
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
