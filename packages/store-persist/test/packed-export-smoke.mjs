import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root used as the source of the store-persist publish-boundary tarball. */
const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Canonical runtime dependency needed by the packed codec and error constructors. */
const utilsDirectory = resolve(packageDirectory, '../utils')
/** Runtime-neutral collection codec dependency needed by the packed default codec. */
const contractDirectory = resolve(packageDirectory, '../storage-contract')
/** Isolated consumer proving package resolution from extracted tarballs. */
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-store-persist-packed-'))

/** Packs store-persist and its runtime utility dependency, then imports the extracted package. */
function main() {
  try {
    const packDirectory = join(smokeDirectory, 'pack')
    const extractDirectory = join(smokeDirectory, 'extract')
    const consumerDirectory = join(smokeDirectory, 'consumer')
    mkdirSync(packDirectory, { recursive: true })
    mkdirSync(extractDirectory, { recursive: true })
    for (const sourceDirectory of [utilsDirectory, contractDirectory, packageDirectory])
      execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
        cwd: sourceDirectory,
        stdio: 'inherit'
      })
    const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
    const utilsTarball = tarballs.find((entry) => entry.startsWith('migaia-utils-'))
    const contractTarball = tarballs.find((entry) => entry.startsWith('migaia-storage-contract-'))
    const packageTarball = tarballs.find((entry) => entry.startsWith('migaia-store-persist-'))
    if (utilsTarball === undefined || contractTarball === undefined || packageTarball === undefined)
      throw new Error('packed store-persist dependency set is incomplete')
    const utilsExtractDirectory = join(extractDirectory, 'utils')
    const contractExtractDirectory = join(extractDirectory, 'storage-contract')
    const packageExtractDirectory = join(extractDirectory, 'package')
    mkdirSync(utilsExtractDirectory, { recursive: true })
    mkdirSync(contractExtractDirectory, { recursive: true })
    mkdirSync(packageExtractDirectory, { recursive: true })
    execFileSync('tar', ['-xzf', join(packDirectory, utilsTarball), '-C', utilsExtractDirectory])
    execFileSync('tar', [
      '-xzf',
      join(packDirectory, contractTarball),
      '-C',
      contractExtractDirectory
    ])
    execFileSync('tar', [
      '-xzf',
      join(packDirectory, packageTarball),
      '-C',
      packageExtractDirectory
    ])
    mkdirSync(join(packageExtractDirectory, 'package', 'node_modules', '@migaia'), {
      recursive: true
    })
    symlinkSync(
      join(utilsExtractDirectory, 'package'),
      join(packageExtractDirectory, 'package', 'node_modules', '@migaia/utils'),
      'dir'
    )
    symlinkSync(
      join(contractExtractDirectory, 'package'),
      join(packageExtractDirectory, 'package', 'node_modules', '@migaia/storage-contract'),
      'dir'
    )
    mkdirSync(join(contractExtractDirectory, 'package', 'node_modules', '@migaia'), {
      recursive: true
    })
    symlinkSync(
      join(utilsExtractDirectory, 'package'),
      join(contractExtractDirectory, 'package', 'node_modules', '@migaia/utils'),
      'dir'
    )
    mkdirSync(consumerDirectory, { recursive: true })
    writeFileSync(join(consumerDirectory, 'package.json'), '{"type":"module"}\n', 'utf8')
    writeFileSync(
      join(consumerDirectory, 'smoke.mjs'),
      "import { defaultJsonCodec } from '" +
        join(packageExtractDirectory, 'package', 'dist', 'index.js') +
        "'\nconst raw = await defaultJsonCodec.encode({ ok: true })\nif (raw !== '{\\\"ok\\\":true}') throw new Error('packed codec mismatch')\n",
      'utf8'
    )
    execFileSync(process.execPath, ['smoke.mjs'], { cwd: consumerDirectory, stdio: 'inherit' })
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
}

main()
