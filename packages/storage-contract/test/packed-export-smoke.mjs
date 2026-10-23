import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Package whose public adapter and real dependencies are packed for isolated consumption. */
const contractDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
/** Actual dependency closure includes serialize and its neutral lifecycle/utils dependencies. */
const packageDirectories = ['utils', 'lifecycle', 'serialize', 'storage-contract'].map((name) =>
  resolve(contractDirectory, '..', name)
)
/** Consumer resolves only extracted package tarballs, never workspace source or dist paths. */
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-storage-contract-packed-'))

/**
 * Packs the real dependency closure and verifies public codec composition plus canonical byte
 * ownership.
 *
 * @returns {void} Completes when the isolated Node consumer exits successfully.
 * @throws {Error} When packing, package extraction, dependency wiring or consumer assertions fail.
 */
function main() {
  try {
    /** Tarballs and extracted packages stay in a private disposable consumer workspace. */
    const packDirectory = join(smokeDirectory, 'pack')
    /** Package extraction preserves normal package-root resolution. */
    const extractDirectory = join(smokeDirectory, 'extract')
    /** The consumer contains only a module marker, fixture and published-package links. */
    const consumerDirectory = join(smokeDirectory, 'consumer')
    mkdirSync(packDirectory, { recursive: true })
    mkdirSync(extractDirectory, { recursive: true })
    mkdirSync(join(consumerDirectory, 'node_modules', '@migaia'), { recursive: true })
    for (const directory of packageDirectories)
      execFileSync('pnpm', ['pack', '--pack-destination', packDirectory], {
        cwd: directory,
        stdio: 'inherit'
      })
    /** Every input package must produce exactly one real tarball. */
    const tarballs = readdirSync(packDirectory).filter((entry) => entry.endsWith('.tgz'))
    if (tarballs.length !== packageDirectories.length)
      throw new Error(`Expected ${packageDirectories.length} tarballs, found ${tarballs.length}`)
    /** Extracted names are used only to wire each package's declared runtime dependencies. */
    const extracted = new Map()
    for (const directory of packageDirectories) {
      /** Package identity comes from its own metadata rather than a guessed tarball version. */
      const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      /** Pnpm replaces the scoped slash with a hyphen in packed archive names. */
      const prefix = metadata.name.replace('@', '').replace('/', '-') + '-'
      /** All four known names are distinct, so this lookup is bounded by the fixed closure. */
      const tarball = tarballs.find((entry) => entry.startsWith(prefix))
      if (!tarball) throw new Error(`Missing expected tarball for ${metadata.name}`)
      /** Each archive gets its own normal package root. */
      const target = join(extractDirectory, metadata.name.split('/')[1])
      mkdirSync(target, { recursive: true })
      execFileSync('tar', ['-xzf', join(packDirectory, tarball), '-C', target])
      extracted.set(metadata.name, join(target, 'package'))
    }
    for (const [name, directory] of extracted) {
      symlinkSync(directory, join(consumerDirectory, 'node_modules', name), 'dir')
      /** Wire only actual declared runtime dependencies after Node resolves each package realpath. */
      const metadata = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      for (const dependency of Object.keys(metadata.dependencies ?? {})) {
        /** Optional codec peers are not used by the public JSON composition being exercised. */
        const target = extracted.get(dependency)
        if (!target) throw new Error(`Unpacked runtime dependency ${dependency} of ${name}`)
        mkdirSync(join(directory, 'node_modules', '@migaia'), { recursive: true })
        symlinkSync(target, join(directory, 'node_modules', dependency), 'dir')
      }
    }
    writeFileSync(join(consumerDirectory, 'package.json'), '{"type":"module"}\n', 'utf8')
    writeFileSync(
      join(consumerDirectory, 'identity.mjs'),
      `import { fromValueCodec } from '@migaia/storage-contract'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import { isArrayBuffer as utilsBuffer, isUint8Array as utilsBytes } from '@migaia/utils/bytes'
if (!utilsBuffer(new ArrayBuffer(1)) || !utilsBytes(new Uint8Array(1))) throw new Error('canonical byte owner mismatch')
const originalClone = globalThis.structuredClone
let cloneCalls = 0
globalThis.structuredClone = value => { cloneCalls += 1; return originalClone(value) }
const codec = fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))
let nested = { leaf: 'ok' }
for (let index = 0; index < 128; index += 1) nested = { next: nested }
const encoded = await codec.encode(nested)
if (cloneCalls !== 0 || !encoded.includes('"leaf":"ok"')) throw new Error('codec clone budget exceeded')
const restored = await codec.decode(await codec.encode(new Map([['roles', new Set(['read'])]])))
if (!(restored instanceof Map) || !(restored.get('roles') instanceof Set) || !restored.get('roles').has('read')) throw new Error('collection codec composition failed')
`,
      'utf8'
    )
    execFileSync(process.execPath, ['identity.mjs'], { cwd: consumerDirectory, stdio: 'inherit' })
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
}

main()
