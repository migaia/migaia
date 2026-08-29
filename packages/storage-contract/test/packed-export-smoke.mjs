import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package root used as the source of the storage-contract publish-boundary tarball. */
const contractDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Package root used as the source of the canonical utils dependency tarball. */
const utilsDirectory = resolve(contractDirectory, '../utils')
/** Isolated consumer workspace proving packed packages instead of workspace source. */
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-storage-contract-packed-'))

/** Packs both packages, installs them by symlink in an isolated consumer, and checks identity. */
function main() {
  try {
    const packDirectory = join(smokeDirectory, 'pack')
    const extractDirectory = join(smokeDirectory, 'extract')
    const consumerDirectory = join(smokeDirectory, 'consumer')
    mkdirSync(packDirectory, { recursive: true })
    mkdirSync(extractDirectory, { recursive: true })
    mkdirSync(join(consumerDirectory, 'node_modules', '@migaia'), { recursive: true })
    for (const packageDirectory of [utilsDirectory, contractDirectory])
      execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
        cwd: packageDirectory,
        stdio: 'inherit'
      })
    const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
    if (tarballs.length !== 2) throw new Error(`Expected two tarballs, found ${tarballs.length}`)
    const utilsTarball = tarballs.find((entry) => entry.startsWith('migaia-utils-'))
    const contractTarball = tarballs.find((entry) => entry.startsWith('migaia-storage-contract-'))
    if (utilsTarball === undefined || contractTarball === undefined)
      throw new Error(`Missing expected package tarballs: ${tarballs.join(', ')}`)
    const utilsExtractDirectory = join(extractDirectory, 'utils')
    const contractExtractDirectory = join(extractDirectory, 'contract')
    mkdirSync(utilsExtractDirectory, { recursive: true })
    mkdirSync(contractExtractDirectory, { recursive: true })
    execFileSync('tar', ['-xzf', join(packDirectory, utilsTarball), '-C', utilsExtractDirectory])
    execFileSync('tar', [
      '-xzf',
      join(packDirectory, contractTarball),
      '-C',
      contractExtractDirectory
    ])
    mkdirSync(join(contractExtractDirectory, 'package', 'node_modules', '@migaia'), {
      recursive: true
    })
    symlinkSync(
      join(utilsExtractDirectory, 'package'),
      join(contractExtractDirectory, 'package', 'node_modules', '@migaia/utils'),
      'dir'
    )
    symlinkSync(
      join(contractExtractDirectory, 'package'),
      join(consumerDirectory, 'node_modules', '@migaia/storage-contract'),
      'dir'
    )
    symlinkSync(
      join(utilsExtractDirectory, 'package'),
      join(consumerDirectory, 'node_modules', '@migaia/utils'),
      'dir'
    )
    writeFileSync(join(consumerDirectory, 'package.json'), '{"type":"module"}\n', 'utf8')
    writeFileSync(
      join(consumerDirectory, 'identity.mjs'),
      "import { collectionsJsonCodec, isArrayBuffer as contractBuffer, isUint8Array as contractBytes } from '@migaia/storage-contract'\nimport { isArrayBuffer as utilsBuffer, isUint8Array as utilsBytes } from '@migaia/utils/bytes'\nif (contractBuffer !== utilsBuffer || contractBytes !== utilsBytes) throw new Error('brand identity mismatch')\nconst originalClone = globalThis.structuredClone\nlet cloneCalls = 0\nglobalThis.structuredClone = (value) => { cloneCalls += 1; return originalClone(value) }\nlet nested = { leaf: 'ok' }\nfor (let index = 0; index < 128; index += 1) nested = { next: nested }\nconst encoded = await collectionsJsonCodec.encode(nested)\nif (cloneCalls !== 0 || !encoded.includes('\\\"leaf\\\":\\\"ok\\\"')) throw new Error('codec clone budget exceeded')\n",
      'utf8'
    )
    execFileSync(process.execPath, ['identity.mjs'], { cwd: consumerDirectory, stdio: 'inherit' })
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
}

main()
