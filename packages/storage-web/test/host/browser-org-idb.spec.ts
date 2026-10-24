// @vitest-environment node
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { lockKey } from '@migaia/storage-host/authoring/concurrency'
import { ttl, STORAGE_CONTRACT_SOURCE } from '@migaia/storage-contract'
import { walkErrorCauses } from '@migaia/utils/error'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'

describe('physical IndexedDB organizations', () => {
  it('shares the configured default and deletes only the resolved physical targets', async () => {
    for (const defaultOrg of ['00000000-0000-0000-0000-000000000000', createOrgId()]) {
      const factory = new IDBFactory()
      const options = { factory, keyRange: IDBKeyRange }
      await using host = await createStorageHost({
        org: defaultOrg,
        plugins: [
          indexedDbBackendPlugin({ ...options, id: 'prefs', dbName: 'preferences' }),
          indexedDbBackendPlugin({ ...options, id: 'cache', dbName: 'cache' })
        ]
      })
      const first = createOrgId()
      const second = createOrgId()
      const root = host.backend('prefs')
      const same = host.org(defaultOrg).backend('prefs')
      const left = host.org(first).backend('prefs')
      const right = host.org(second).backend('prefs')
      const cache = host.org(first).backend('cache')
      await root.set('key', 'root')
      expect(await same.get('key')).toBe('root')
      await same.set('key', 'default')
      expect(await root.get('key')).toBe('default')
      await left.set('key', 'left')
      await right.set('key', 'right')
      await cache.set('key', 'cache')
      await left.putRecord({ owner: 'left' }, 'record')
      await left.use(ttl).expire({ channel: 'text', key: 'key' }, 60_000)
      expect(await right.getRecord('record')).toBeUndefined()
      expect(await right.use(ttl).remaining({ channel: 'text', key: 'key' })).toBeUndefined()
      expect(await factory.databases()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'preferences' }),
          expect.objectContaining({ name: 'preferences/' + first }),
          expect.objectContaining({ name: 'preferences/' + second }),
          expect.objectContaining({ name: 'cache/' + first })
        ])
      )
      await host.dropOrg(first)
      expect((await factory.databases()).map(({ name }) => name)).not.toContain(
        'preferences/' + first
      )
      expect((await factory.databases()).map(({ name }) => name)).not.toContain('cache/' + first)
      expect(await right.get('key')).toBe('right')
      expect(await root.get('key')).toBe('default')
      await host.dropOrg(first)
      expect(await left.get('key')).toBeNull()
      expect(await left.getRecord('record')).toBeUndefined()
      await left.set('key', 'reused')
      expect(await left.get('key')).toBe('reused')
      expect(host.org(first).backend('prefs')).toBe(left)
      await host.dropOrg(defaultOrg)
      expect((await factory.databases()).map(({ name }) => name)).not.toContain('preferences')
      expect(await same.get('key')).toBeNull()
      expect(await left.get('key')).toBe('reused')
    }
  })

  it('drains an actual native transaction before deleting and queues new opens behind deletion', async () => {
    const factory = new IDBFactory()
    const defaultOrg = createOrgId()
    await using host = await createStorageHost({
      org: defaultOrg,
      plugins: [indexedDbBackendPlugin({ factory, keyRange: IDBKeyRange, dbName: 'drain' })]
    })
    const store = host.backend('indexed-db')
    let entered!: () => void
    const active = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const finish = new Promise<void>((resolve) => {
      release = resolve
    })
    let deleting!: () => void
    const nativeDelete = new Promise<void>((resolve) => {
      deleting = resolve
    })
    const originalDelete = factory.deleteDatabase
    const deletion = vi.spyOn(factory, 'deleteDatabase').mockImplementation((name) => {
      deleting()
      return Reflect.apply(originalDelete, factory, [name])
    })
    try {
      const transaction = store
        .tx()
        .lock(lockKey.text('old'))
        .run(async (scope) => {
          await scope.set('old', 'committed before delete')
          entered()
          await finish
        })
      await active
      let deleted = false
      const drop = host.dropOrg(defaultOrg).then(() => {
        deleted = true
      })
      await nativeDelete
      const after = store.set('new', 'written after delete')
      expect(deleted).toBe(false)
      release()
      await transaction
      await drop
      await after
      expect(await store.get('old')).toBeNull()
      expect(await store.get('new')).toBe('written after delete')
      expect(deletion).toHaveBeenCalledExactlyOnceWith('drain')
    } finally {
      release()
      deletion.mockRestore()
    }
  })

  it('captures configuration once and rejects a reserved suffix before native open', async () => {
    const factory = new IDBFactory()
    const open = vi.spyOn(factory, 'open')
    const org = createOrgId()
    const failure = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({ factory, keyRange: IDBKeyRange, dbName: 'preferences/' + org })
      ]
    }).catch((error: unknown) => error)
    expect(walkErrorCauses(failure)).toContainEqual(
      expect.objectContaining({ source: STORAGE_CONTRACT_SOURCE, code: 'INVALID_ARGUMENT' })
    )
    expect(open).not.toHaveBeenCalled()
    let reads = 0
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({
          factory,
          keyRange: IDBKeyRange,
          get dbName() {
            reads += 1
            return org
          }
        })
      ]
    })
    await host.org(createOrgId()).backend('indexed-db').set('key', 'child')
    expect(reads).toBe(1)
    expect((await factory.databases()).map(({ name }) => name)).toContain(org)
  })
})
