import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  realpathSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This package's finite native Redis runtime closure is packed into a separate disposable consumer. */
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** Every workspace dependency is extracted from its real package tarball, including its metadata. */
const packageNames = [
  'utils',
  'lifecycle',
  'serialize',
  'event-subscriber',
  'capability',
  'middleware-pipeline',
  'plugin-host',
  'logger',
  'storage-contract',
  'storage-host',
  'storage-plugin-redis'
]
/** Generated fixtures and installed links stay outside the repository and are always removed. */
const directory = mkdtempSync(join(tmpdir(), 'migaia-redis-packed-'))
try {
  /** Packing uses the original package scripts and declared files, with no source entry aliases. */
  const pack = join(directory, 'pack')
  const consumer = join(directory, 'consumer')
  mkdirSync(pack, { recursive: true })
  mkdirSync(join(consumer, 'node_modules', '@migaia'), { recursive: true })
  const extracted = new Map<string, string>()
  for (const name of packageNames) {
    const source = resolve(packageDirectory, '..', name)
    execFileSync('rtk', ['proxy', 'pnpm', 'pack', '--pack-destination', pack], {
      cwd: source,
      stdio: 'pipe'
    })
    const metadata = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8')) as {
      name: string
      version: string
    }
    const target = join(directory, 'extract', name)
    mkdirSync(target, { recursive: true })
    execFileSync('rtk', [
      'proxy',
      'tar',
      '-xzf',
      join(
        pack,
        metadata.name.replace('@', '').replace('/', '-') + '-' + metadata.version + '.tgz'
      ),
      '-C',
      target
    ])
    extracted.set(metadata.name, join(target, 'package'))
  }
  for (const [name, target] of extracted) {
    symlinkSync(target, join(consumer, 'node_modules', name), 'dir')
    const metadata = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    const source = resolve(packageDirectory, '..', name.split('/')[1]!)
    for (const dependency of Object.keys({
      ...metadata.dependencies,
      ...metadata.peerDependencies
    })) {
      const packed = extracted.get(dependency)
      const installed = join(source, 'node_modules', dependency)
      if (!packed && dependency.startsWith('@migaia/'))
        throw new Error(`unpacked runtime dependency: ${dependency}`)
      if (!packed && name === '@migaia/serialize') continue
      const linked = packed ?? realpathSync(installed)
      mkdirSync(dirname(join(target, 'node_modules', dependency)), { recursive: true })
      symlinkSync(linked, join(target, 'node_modules', dependency), 'dir')
    }
  }
  /** Application-owned peers are installed at the external consumer's own package boundary. */
  for (const peer of ['redis', 'ioredis'])
    symlinkSync(
      realpathSync(join(packageDirectory, 'node_modules', peer)),
      join(consumer, 'node_modules', peer),
      'dir'
    )
  writeFileSync(join(consumer, 'package.json'), '{"type":"module"}\n')
  writeFileSync(
    join(consumer, 'native.mts'),
    readFileSync(join(packageDirectory, 'test', 'runtime', 'native.mts'), 'utf8')
  )
  execFileSync('rtk', ['proxy', 'node', 'native.mts'], { cwd: consumer, stdio: 'inherit' })
  console.log(
    JSON.stringify({
      tarballs: readdirSync(pack).filter((name) => name.endsWith('.tgz')).length,
      consumers: 1,
      result: 'PASS'
    })
  )
} finally {
  rmSync(directory, { recursive: true, force: true })
}
