import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractPackedPackage } from './executable-acceptance-tooling.mjs'

/** Package root whose already-built output is packed and consumed. */
const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Isolated archive/extraction root removed after every success or failure. */
const temporary = mkdtempSync(join(tmpdir(), 'migaia-plugin-host-packed-'))

/** Runs one packed acceptance program with attributable output and exit status. */
const run = (script, args = []) =>
  execFileSync(process.execPath, [resolve(packageRoot, script), ...args], {
    cwd: packageRoot,
    stdio: 'inherit'
  })

try {
  execFileSync('pnpm', ['pack', '--pack-destination', temporary], {
    cwd: packageRoot,
    stdio: 'inherit'
  })
  const archives = readdirSync(temporary).filter((entry) => entry.endsWith('.tgz'))
  if (archives.length !== 1)
    throw new Error(`expected one packed archive, received ${archives.length}`)
  const archive = join(temporary, archives[0])
  const extracted = join(temporary, 'extracted')
  mkdirSync(extracted)
  const extractedRoot = extractPackedPackage(extracted, archive)
  run('test/ownership-packed-smoke.mjs')
  run('test/packed-consumer-smoke.mjs', [extractedRoot])
  run('test/packed-feature-types.mjs', [archive])
} finally {
  rmSync(temporary, { force: true, recursive: true })
}
