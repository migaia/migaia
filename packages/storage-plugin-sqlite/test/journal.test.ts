import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { storageLogStore } from '@migaia/storage-host/journal'
import { sqliteBackendPlugin } from '../src/index.js'
import { nodeSqliteDriver } from '../src/node.js'

/** Every case owns only its temporary native file; the connection outlives the installed host. */
async function installed(options: { memory?: boolean; wal?: boolean } = { memory: true }) {
  const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-journal-'))
  const connection = nodeSqliteDriver(options.memory ? ':memory:' : join(directory, 'data.sqlite'))
  const orgId = createOrgId()
  const host = await createStorageHost({
    org: orgId,
    plugins: [sqliteBackendPlugin({ driver: connection, wal: options.wal })] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  return { host, connection, orgId, store: host.backend('sqlite') }
}

it('keeps original native log indexes outside business keys and isolates fixed organizations', async () => {
  const { host, store } = await installed()
  const orgId = createOrgId()
  const organization = host.org(orgId)
  const root = await storageLogStore(host, 'sqlite', { prefix: 'private-log' })
  const other = await storageLogStore(organization, 'sqlite', { prefix: 'private-log' })
  try {
    expect(await root.append([{ kind: 'first', payload: { value: '\0\ud800' } }])).toEqual([1])
    expect(await other.append([{ kind: 'organization', payload: null }])).toEqual([1])
    await store.set('business', 'value')
    await store.clearAll()
    expect(await store.keys()).toEqual([])
    expect((await root.read(1, 10)).map((row) => row.kind)).toEqual(['first'])
    expect((await other.read(1, 10)).map((row) => row.kind)).toEqual(['organization'])
    expect((await root.read(1, 1))[0]!.payload).toEqual({ value: '\0\ud800' })
    await expect(storageLogStore(host, 'sqlite', { prefix: 'private-log' })).rejects.toMatchObject({
      code: 'LOCK_REJECTED'
    })
  } finally {
    await other.dispose()
    await root.dispose()
  }
  const reopened = await storageLogStore(host, 'sqlite', { prefix: 'private-log' })
  try {
    expect(await reopened.lastSeq()).toBe(1)
    expect(await reopened.append([{ kind: 'second', payload: null }])).toEqual([2])
  } finally {
    await reopened.dispose()
  }
})

it.each([false, true])(
  'rejects lifetime-cached file indexes without weakening native transactions (wal:%s)',
  async (wal) => {
    const { host, store, connection } = await installed({ wal })
    const rows = connection.prepare('SELECT count(*) AS n FROM migaia_journal').get()!.n
    await expect(storageLogStore(host, 'sqlite', { prefix: 'file-log' })).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY'
    })
    expect(connection.prepare('SELECT count(*) AS n FROM migaia_journal').get()!.n).toBe(rows)
    await store.transaction(async (scope) => {
      await scope.set('business', 'still-supported')
    })
    expect(await store.get('business')).toBe('still-supported')
  }
)

it('invalidates cached private indexes at org drop while keeping original business views usable', async () => {
  const { host, store, orgId } = await installed()
  const defaultOrg = host.org(orgId)
  const otherOrg = host.org(createOrgId())
  const root = await storageLogStore(host, 'sqlite', { prefix: 'root-before-drop' })
  const same = await storageLogStore(defaultOrg, 'sqlite', { prefix: 'default-before-drop' })
  const other = await storageLogStore(otherOrg, 'sqlite', { prefix: 'other-before-drop' })
  try {
    await root.append([{ kind: 'root', payload: null }])
    await same.append([{ kind: 'default', payload: null }])
    await other.append([{ kind: 'other', payload: null }])
    await host.dropOrg(orgId)
    await expect(root.lastSeq()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(same.read(1, 10)).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(root.append([{ kind: 'stale', payload: null }])).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    expect((await other.read(1, 10)).map((entry) => entry.kind)).toEqual(['other'])
    await store.set('reused', 'root')
    expect(await defaultOrg.backend('sqlite').get('reused')).toBe('root')
    await defaultOrg.backend('sqlite').set('reused', 'default')
    expect(await store.get('reused')).toBe('default')
  } finally {
    await Promise.all([root.dispose(), same.dispose(), other.dispose()])
  }
  const reopened = await storageLogStore(defaultOrg, 'sqlite', { prefix: 'root-before-drop' })
  try {
    expect(await reopened.lastSeq()).toBe(0)
    expect(await reopened.append([{ kind: 'fresh', payload: null }])).toEqual([1])
  } finally {
    await reopened.dispose()
  }
})
