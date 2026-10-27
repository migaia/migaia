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

/** This package's actual finite runtime closure is packed into a separate disposable consumer. */
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
  'storage-plugin-object'
]
/** Generated fixtures and installed links stay outside the repository and are always removed. */
const directory = mkdtempSync(join(tmpdir(), 'migaia-object-packed-'))
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
  writeFileSync(join(consumer, 'package.json'), '{"type":"module"}\n')
  writeFileSync(
    join(consumer, 'native.mjs'),
    `import assert from 'node:assert/strict'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { objectBackendPlugin } from '@migaia/storage-plugin-object'
import { STORAGE_OBJECT_ERROR_SOURCE } from '@migaia/storage-contract/error-code'
import { fsObjectDriver } from '@migaia/storage-plugin-object/fs'
import { s3ObjectDriver } from '@migaia/storage-plugin-object/s3'
import { objectPresignFeature } from '@migaia/storage-plugin-object/features/presign'
assert.equal(STORAGE_OBJECT_ERROR_SOURCE, 'storage.backend.object')
assert.equal(s3ObjectDriver({ config: { region: 'us-east-1' }, bucket: 'objects' }).kind, 's3')
assert.ok(objectPresignFeature())
const host = await createStorageHost({ plugins: [objectBackendPlugin({ driver: fsObjectDriver({ root: './objects' }) })] })
try {
  const objects = host.backend('object').use(blob)
  const info = await objects.put('file', new Uint8Array([1, 2, 3]), { metadata: { owner: 'ada' } })
  const object = await objects.get('file', { range: { start: 1, end: 2 } })
  assert.deepEqual(await object.bytes(), new Uint8Array([2, 3]))
  assert.equal(object.info.size, 3)
  await objects.put('file', new Uint8Array([4]), { ifMatch: info.etag })
  const other = host.org(createOrgId()).backend('object').use(blob)
  assert.equal(await other.head('file'), undefined)
  await other.put('file', new Uint8Array([5]))
  assert.equal(await objects.removeByPrefix(''), 1)
  assert.deepEqual(await (await other.get('file')).bytes(), new Uint8Array([5]))
} finally { await host.dispose() }
console.log('object packed consumer PASS')
`
  )
  execFileSync('rtk', ['proxy', 'node', 'native.mjs'], { cwd: consumer, stdio: 'inherit' })
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
