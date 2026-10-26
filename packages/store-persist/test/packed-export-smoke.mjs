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
const packageDirectory = resolve(fileURLToPath(new URL('..', import.meta.url)))
/**
 * The default codec and canonical disposal key require their real neutral runtime dependency
 * closure.
 */
const packageDirectories = [
  'utils',
  'lifecycle',
  'reactive',
  'serialize',
  'capability',
  'middleware-pipeline',
  'plugin-host',
  'event-subscriber',
  'storage-contract',
  'storage-host',
  'store-persist'
].map((name) => resolve(packageDirectory, '..', name))
/** Consumer resolves only extracted package tarballs, never workspace source or dist paths. */
const smokeDirectory = mkdtempSync(join(tmpdir(), 'migaia-store-persist-packed-'))

/**
 * Packs the real dependency closure and verifies public codec composition plus the default codec
 * through the actual dependency closure.
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
      /** All known names are distinct, so this lookup is bounded by the fixed closure. */
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
      `import * as api from '@migaia/store-persist'
const { defaultJsonCodec } = api
if ('assertEnvelope' in api || 'PersistEnvelopeError' in api) throw new Error('removed envelope export retained')
const raw = await defaultJsonCodec.encode({ roles: new Map([['Ada', new Set(['read'])]]) })
if (defaultJsonCodec.name !== 'collections-json@1' || !raw.includes('"$rpc":"map"')) throw new Error('packed codec format mismatch')
const restored = await defaultJsonCodec.decode(raw)
if (!(restored.roles instanceof Map) || !(restored.roles.get('Ada') instanceof Set)) throw new Error('packed collections lost')
try { await defaultJsonCodec.encode({ count: NaN }); throw new Error('invalid value accepted') }
catch (error) { if (error.code !== 'ENCODE_FAILED' || error.cause?.code !== 'INVALID_ARGUMENT' || error.cause.cause?.code !== 'ENCODE_FAILED') throw error }
`,
      'utf8'
    )
    execFileSync(process.execPath, ['identity.mjs'], { cwd: consumerDirectory, stdio: 'inherit' })
  } finally {
    rmSync(smokeDirectory, { recursive: true, force: true })
  }
}

main()
