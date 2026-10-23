import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { blob } from '@migaia/storage-contract'
import { detectServerRuntime } from '@migaia/utils'
import { objectBackendPlugin } from '../../dist/index.js'
import { fsObjectDriver } from '../../dist/fs.js'

/** The same built package and business cases run through each selected native runtime adapter. */
const directory = await mkdtemp(join(tmpdir(), 'migaia-object-runtime-'))
/** The host alone owns this installed native driver and its open content resources. */
const host = await createStorageHost({
  plugins: [objectBackendPlugin({ driver: fsObjectDriver({ root: directory }) })] as const
})
try {
  /** Byte/range/overwrite behavior proves the returned handle owns its immutable generation. */
  const objects = host.backend('object').use(blob)
  const info = await objects.put('file', new Uint8Array([1, 2, 3]), { metadata: { owner: 'ada' } })
  const snapshot = await objects.get('file')
  const range = await objects.get('file', { range: { start: 1, end: 2 } })
  assert.deepEqual(await range!.bytes(), new Uint8Array([2, 3]))
  assert.equal(range!.info.size, 3)
  await objects.put('file', new Uint8Array([4]), { ifMatch: info.etag })
  assert.deepEqual(await snapshot!.bytes(), new Uint8Array([1, 2, 3]))
  await assert.rejects(snapshot!.bytes(), { code: 'INVALID_ARGUMENT' })

  /** Organization tuples and native radix pagination remain identical in all runtimes. */
  const orgId = createOrgId()
  const other = host.org(orgId).backend('object').use(blob)
  await other.put('file', new Uint8Array([9]))
  for (const key of ['files/\uffff', 'files/\ud800', 'files/a'])
    await objects.put(key, new Uint8Array([1]))
  const first = await objects.list({ prefix: 'files/', limit: 2 })
  assert.deepEqual(
    first.items.map((item) => item.key),
    ['files/a', 'files/\ud800']
  )
  assert.deepEqual(
    (await objects.list({ prefix: 'files/', limit: 2, after: first.next })).items.map(
      (item) => item.key
    ),
    ['files/\uffff']
  )
  assert.equal(await objects.removeByPrefix('files/'), 3)
  assert.deepEqual(await (await other.get('file'))!.bytes(), new Uint8Array([9]))
  await host.dropOrg(orgId)
  assert.equal(await other.head('file'), undefined)

  /** Native publication serializes conflicting CAS writers and disposal closes unconsumed content. */
  const current = await objects.head('file')
  const outcomes = await Promise.allSettled([
    objects.put('file', new Uint8Array([5]), { ifMatch: current!.etag }),
    objects.put('file', new Uint8Array([6]), { ifMatch: current!.etag })
  ])
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1)
  const unread = await objects.get('file')
  await host.dispose()
  await assert.rejects(unread!.bytes(), { code: 'INVALID_ARGUMENT' })
  console.log(JSON.stringify({ runtime: detectServerRuntime(), cases: 3, result: 'PASS' }))
} finally {
  await host.dispose()
  await rm(directory, { recursive: true, force: true })
}
