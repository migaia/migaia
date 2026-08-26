import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
const temporaryRoot = mkdtempSync(join(tmpdir(), 'migaia-web-rpc-control-d95-'))

/** Packs one isolated package copy and asserts the final B12c05 bridge deletion boundary. */
function main() {
  try {
    const packDirectory = join(temporaryRoot, 'pack')
    const extractDirectory = join(temporaryRoot, 'extract')
    mkdirSync(packDirectory, { recursive: true })
    mkdirSync(extractDirectory, { recursive: true })
    execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
      cwd: packageDirectory,
      stdio: 'inherit'
    })
    const tarball = readdirSync(packDirectory).find((entry) => entry.endsWith('.tgz'))
    if (!tarball) throw new Error('packed web-rpc tarball was not created')
    execFileSync('tar', ['-xzf', join(packDirectory, tarball), '-C', extractDirectory])
    const packageRoot = join(extractDirectory, 'package')
    const controlRuntime = readFileSync(join(packageRoot, 'dist/features/control.js'), 'utf8')
    const chunkRuntime = readFileSync(join(packageRoot, 'dist/features/chunk.js'), 'utf8')
    if (controlRuntime.includes('outboundCompatibility'))
      throw new Error('packed control still consumes the D95 compatibility bridge')
    if (chunkRuntime.includes('outboundCompatibility'))
      throw new Error('packed chunk retained the removed D95 compatibility bridge')
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

main()
