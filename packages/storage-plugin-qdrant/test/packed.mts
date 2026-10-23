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

/**
 * This package's finite native vector runtime closure is packed into a separate disposable
 * consumer.
 */
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
  'storage-plugin-qdrant'
]
/** Generated fixtures and installed links stay outside the repository and are always removed. */
const directory = mkdtempSync(join(tmpdir(), 'migaia-qdrant-packed-'))
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
  mkdirSync(join(consumer, 'node_modules', '@qdrant'), { recursive: true })
  symlinkSync(
    realpathSync(join(packageDirectory, 'node_modules', '@qdrant/js-client-rest')),
    join(consumer, 'node_modules', '@qdrant/js-client-rest'),
    'dir'
  )
  writeFileSync(join(consumer, 'package.json'), '{"type":"module"}\n')
  writeFileSync(
    join(consumer, 'native.mjs'),
    `import assert from 'node:assert/strict'
import {createStorageHost,createOrgId} from '@migaia/storage-host'
import {vector,ttl,lockKey,DeleteCountMode} from '@migaia/storage-contract'
import {qdrantBackendPlugin,ERROR_SOURCE} from '@migaia/storage-plugin-qdrant'
import {fetchHttp} from '@migaia/storage-plugin-qdrant/http'
import {qdrantClientHttp} from '@migaia/storage-plugin-qdrant/client'
import {qdrantManagementFeature} from '@migaia/storage-plugin-qdrant/features/management'
import {qdrantHybridFeature} from '@migaia/storage-plugin-qdrant/features/hybrid'
import {qdrantRecommendFeature} from '@migaia/storage-plugin-qdrant/features/recommend'
import {qdrantGroupByFeature} from '@migaia/storage-plugin-qdrant/features/group-by'
import {QdrantClient} from '@qdrant/js-client-rest'
/** The shared service launcher supplies every runtime's identical native endpoint. */
const url=process.env.MIGAIA_QDRANT_URL
assert.ok(url,'configured native Qdrant service required')
assert.equal(ERROR_SOURCE,'storage.backend.qdrant')
for(const native of [fetchHttp(url),qdrantClientHttp(new QdrantClient({url}))]){
 const created=[],http={...native,createCollection:async(...args)=>{const result=await native.createCollection(...args);created.push(args[0]);return result}},org=createOrgId(),host=await createStorageHost({org,plugins:[qdrantBackendPlugin({url,http,collectionPrefix:crypto.randomUUID()},{management:qdrantManagementFeature(),hybrid:qdrantHybridFeature(),recommend:qdrantRecommendFeature(),groups:qdrantGroupByFeature()})]})
 try{
  const store=host.backend('qdrant'),collection=store.use(vector).collection('runtime',{dimensions:2,metric:'cosine'})
  await collection.upsert([{id:'one\\ud800',vector:[100,0],payload:{kind:'same'}},{id:'two',vector:[0,1],payload:{kind:'same'}}])
  const hits=await collection.near([1,0],{exact:true}).topK(2).withVector().all()
  assert.equal(hits[0].id,'one\\ud800');assert.deepEqual(hits[0].vector,[100,0])
  assert.equal(await store.use(ttl).expire(lockKey.vector('runtime','two'),0),true)
  assert.equal((await collection.near([1,0]).topK(2).all()).length,1)
  assert.equal(await collection.deleteWhere({kind:'same'},{count:DeleteCountMode.scroll}),2)
  assert.equal(typeof store.api.qdrantManagement.purgeExpired,'function')
  assert.equal('transaction'in store,false);assert.equal('deleteByFilter'in store,false)
  await host.dropOrg(org)
 }finally{await host.dispose();for(const name of created)await native.deleteCollection(name)}
 assert.match(await native.getVersion(),/^1\\./)
}
console.log('qdrant native runtime PASS: HTTP + borrowed SDK')

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
