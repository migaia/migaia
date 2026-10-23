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
 * This package's finite native PostgreSQL runtime closure is packed into a separate disposable
 * consumer.
 */
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/** The protected own-package row is compared against actual external tarball module namespaces. */
const expectedExports = JSON.parse(
  readFileSync(
    resolve(packageDirectory, '../../scripts/fixtures/public-exports.baseline.json'),
    'utf8'
  )
).packages['@migaia/storage-plugin-postgres']
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
  'storage-plugin-postgres'
]
/** Generated fixtures and installed links stay outside the repository and are always removed. */
const directory = mkdtempSync(join(tmpdir(), 'migaia-postgres-packed-'))
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
  for (const peer of ['pg', 'postgres', 'pg-copy-streams', 'pg-logical-replication'])
    symlinkSync(
      realpathSync(join(packageDirectory, 'node_modules', peer)),
      join(consumer, 'node_modules', peer),
      'dir'
    )
  writeFileSync(join(consumer, 'package.json'), '{"type":"module"}\n')
  writeFileSync(
    join(consumer, 'root.mjs'),
    `import { registerHooks } from 'node:module'
registerHooks({ resolve(specifier,context,next) {
  if (['pg','postgres','pg-copy-streams','pg-logical-replication','bun'].includes(specifier)) throw new Error('root loaded native peer: '+specifier)
  return next(specifier,context)
} })
await import('@migaia/storage-plugin-postgres')
console.log('postgres client-free packed root PASS')
`
  )
  execFileSync('rtk', ['proxy', 'node', 'root.mjs'], { cwd: consumer, stdio: 'inherit' })
  writeFileSync(
    join(consumer, 'native.mjs'),
    `import assert from 'node:assert/strict'
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { kv, vector } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { postgresJsDriver } from '@migaia/storage-plugin-postgres/postgres-js'
import { bunSqlDriver } from '@migaia/storage-plugin-postgres/bun'
import { pgvectorFeature } from '@migaia/storage-plugin-postgres/features/pgvector'
import { pgCopyFeature } from '@migaia/storage-plugin-postgres/features/copy'
import { pgListenFeature } from '@migaia/storage-plugin-postgres/features/listen'
import { pgLogicalReplicationFeature } from '@migaia/storage-plugin-postgres/features/logical-replication'
const expected=${JSON.stringify(expectedExports)}
for (const [entry,names] of Object.entries(expected)) {
 const actual=await import('@migaia/storage-plugin-postgres'+(entry==='.'?'':entry.slice(1)))
 assert.deepEqual(Object.keys(actual).sort(),names.toSorted())
}
assert.equal(typeof postgresJsDriver,'function')
assert.equal(typeof bunSqlDriver,'function')
assert.equal(typeof pgLogicalReplicationFeature,'function')
const pool=new Pool({connectionString:process.env.MIGAIA_PG_URL})
const host=await createStorageHost({plugins:[postgresBackendPlugin({driver:pgDriver(pool),prefix:'pg_packed_'+crypto.randomUUID().slice(0,8)},{vector:pgvectorFeature(),copy:pgCopyFeature(),listen:pgListenFeature()})]})
try {
 const store=host.backend('postgres')
 await store.use(kv).setMany([{key:['packed',1],value:'one'},{key:['packed',2],value:'two'}])
 assert.deepEqual(await store.use(kv).getMany([['packed',2],['packed',1]]),['two','one'])
 await store.transaction(async tx=>{await tx.set('inside','committed');await tx.putRecord({n:1},'record');await tx.sql\`SELECT 1\`.get()})
 assert.equal(await store.get('inside'),'committed')
 const collection=store.use(vector).collection('packed',{dimensions:1,metric:'dot'})
 await collection.upsert([{id:'a',vector:[2]}])
 assert.equal((await collection.near([1],{exact:true}).topK(1).all())[0].score,2)
 const table='pg_packed_copy_'+crypto.randomUUID().replaceAll('-','')
 await store.sql\`CREATE TABLE \${store.sql.id(table)} (id integer)\`.run()
 await store.api.copy.from({table:[table],columns:['id']},async function*(){yield new TextEncoder().encode('1\\n2\\n')})
 assert.equal((await store.sql\`SELECT count(*)::int4 AS count FROM \${store.sql.id(table)}\`.get()).count,2)
 const channel='pg_packed_'+crypto.randomUUID().replaceAll('-','')
 let notify
 const received=new Promise(resolve=>{notify=resolve})
 const listener=await store.api.notifications.listen(channel,value=>{if(value==='committed')notify()})
 try {await store.transaction(tx=>tx.api.notifications.notify(channel,'committed'));await received} finally {await listener.dispose()}
} finally {await host.dispose()}
assert.equal((await pool.query('SELECT 1::int4 AS alive')).rows[0].alive,1)
await pool.end()
console.log('postgres packed consumer PASS')
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
