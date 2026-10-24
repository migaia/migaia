import { describe, expect, it } from 'vitest'
import {
  kv,
  ttl,
  records,
  defineStorageCapability,
  implement,
  type IStorageChange
} from '@migaia/storage-contract'
import { lockKey } from '../src/authoring/concurrency.js'
import {
  createStorageHost,
  createOrgId,
  memoryBackendPlugin,
  memoryBackendKind,
  definePlugin,
  defineFeature,
  defineStorageBackendKind,
  type IStoragePluginCore,
  type IStoragePluginCallContext
} from '../src/index.js'
import { catalog } from './helpers/catalog.js'
import { defineEntity } from '../src/entity.js'

describe('immutable storage organizations', () => {
  it('shares the configured default target and isolates two organizations and plugin namespaces', async () => {
    /** A custom default proves namespace mapping does not depend on the reserved zero UUID. */
    const defaultOrg = createOrgId()
    await using host = await createStorageHost({
      org: defaultOrg,
      plugins: [
        memoryBackendPlugin({ id: 'prefs', namespace: 'preferences' }),
        memoryBackendPlugin({ id: 'cache', namespace: 'cache' })
      ]
    })
    const first = createOrgId()
    const second = createOrgId()
    const root = host.backend('prefs')
    const same = host.org(defaultOrg).backend('prefs')
    const left = host.org(first).backend('prefs')
    const right = host.org(second).backend('prefs')
    await root.set('key', 'root')
    expect(await same.get('key')).toBe('root')
    await same.set('key', 'default')
    expect(await root.get('key')).toBe('default')
    await Promise.all([
      left.set('key', 'left'),
      right.set('key', 'right'),
      host.org(first).backend('cache').set('key', 'cache')
    ])
    expect(
      await Promise.all([
        root.get('key'),
        left.get('key'),
        right.get('key'),
        host.org(first).backend('cache').get('key')
      ])
    ).toEqual(['default', 'left', 'right', 'cache'])
    expect(await same.use(ttl).expire(lockKey.text('key'), 1000)).toBe(true)
    expect(await root.use(ttl).remaining(lockKey.text('key'))).toBeGreaterThan(0)
    expect(await left.use(ttl).remaining(lockKey.text('key'))).toBeUndefined()
    const write = left.set
    await right.set('other', 'right')
    await write('other', 'left')
    expect(await left.get('other')).toBe('left')
    expect(await right.get('other')).toBe('right')
    expect('dispose' in left).toBe(false)
    expect('dispose' in host.org(first)).toBe(false)
    expect('use' in host.org(first)).toBe(false)
    expect('dropOrg' in host.org(first)).toBe(false)
    await host.dropOrg(defaultOrg)
    expect(await root.get('key')).toBeNull()
    expect(await left.get('key')).toBe('left')
    await host.dropOrg(first)
    await host.dropOrg(first)
    expect(await left.get('key')).toBeNull()
    expect(await host.org(first).backend('cache').get('key')).toBeNull()
    expect(await right.get('key')).toBe('right')
    expect(() => host.org('invalid')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('publishes root changes across organizations and filters each captured organization subscription', async () => {
    await using host = await createStorageHost({
      plugins: [memoryBackendPlugin({ namespace: 'notifications' })]
    })
    const first = createOrgId()
    const second = createOrgId()
    const events: IStorageChange[] = []
    const local: IStorageChange[] = []
    const defaultOnly: IStorageChange[] = []
    host.backend('memory').subscribeChanges((change) => events.push(change))
    host
      .org(first)
      .backend('memory')
      .subscribeChanges((change) => local.push(change))
    host
      .org('00000000-0000-0000-0000-000000000000')
      .backend('memory')
      .subscribeChanges((change) => defaultOnly.push(change))
    await host.org(first).backend('memory').set('key', 'first')
    await host.org(second).backend('memory').set('key', 'second')
    await host.backend('memory').set('key', 'default')
    expect(events.map((event) => event.orgId)).toEqual([
      first,
      second,
      '00000000-0000-0000-0000-000000000000'
    ])
    expect(local.map((event) => event.orgId)).toEqual([first])
    expect(defaultOnly.map((event) => event.orgId)).toEqual([
      '00000000-0000-0000-0000-000000000000'
    ])
    /** Real native batch observations use the same immutable organization as change delivery. */
    const observed: string[] = []
    host.org(first).hooks.on('afterStorageOperation', ({ orgId }) => observed.push(orgId))
    await host
      .org(second)
      .backend('memory')
      .use(kv)
      .setMany([{ key: 'batch', value: 'second' }])
    await host
      .org(first)
      .backend('memory')
      .use(kv)
      .setMany([{ key: 'batch', value: 'first' }])
    expect(observed).toEqual([first])
  })

  it('binds extracted Feature, extension, borrowed backend, transaction and query methods to their original organization', async () => {
    /** A captured-root implementation must never be silently reused in another native namespace. */
    const custom = defineStorageCapability<{ identity(): Promise<string> }>()('root-sensitive')
    const feature = defineFeature(memoryBackendKind, () => ({
      capabilities: [implement(custom, { identity: async () => 'root-only' })],
      chain: {},
      api: {
        store: {
          async put(key: string, value: string) {
            await this.store.set(key, value)
            return this.orgId
          },
          async identity() {
            return this.orgId
          }
        },
        transaction: {
          async put(key: string, value: string) {
            await this.store.set(key, value)
            return this.orgId
          }
        }
      }
    }))
    const composition = definePlugin('composition', (core) => {
      const memory = core.getPublishedBackend('memory')
      return {
        install: () => ({
          async putBorrowed(this: IStoragePluginCallContext, key: string, value: string) {
            await this.backend(memory).use(kv).set(key, value)
            return this.orgId
          }
        })
      }
    })
    const base = await createStorageHost({ plugins: [memoryBackendPlugin(undefined, { feature })] })
    const host = await base.use(composition)
    const first = createOrgId()
    const second = createOrgId()
    const left = host.org(first)
    const right = host.org(second)
    const featurePut = left.api.memory.put
    expect(await host.backend('memory').use(custom).identity()).toBe('root-only')
    expect(left.backend('memory').has(custom)).toBe(false)
    expect(() => left.backend('memory').use(custom)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    const extensionPut = left.extensions.putBorrowed
    await right.api.memory.put('key', 'right')
    expect(await featurePut('key', 'left')).toBe(first)
    expect(await extensionPut('borrowed', 'left')).toBe(first)
    expect(await left.backend('memory').get('key')).toBe('left')
    expect(await right.backend('memory').get('key')).toBe('right')
    expect(await left.backend('memory').get('borrowed')).toBe('left')
    expect(await right.backend('memory').get('borrowed')).toBeNull()
    await left.backend('memory').transaction(async (scope) => {
      expect(await scope.api.put('tx', 'left')).toBe(first)
    })
    expect(await left.backend('memory').get('tx')).toBe('left')
    expect(await right.backend('memory').get('tx')).toBeNull()
    await left.backend('memory').putRecord({ value: 'left' }, 'record')
    await right.backend('memory').putRecord({ value: 'right' }, 'record')
    const query = left.backend('memory').use(records).query<{ value: string }>()
    expect(await query.all()).toEqual([{ value: 'left' }])
    await host.dispose()
    await expect(featurePut('key', 'closed')).rejects.toMatchObject({
      code: 'PLUGIN_NOT_INSTALLED'
    })
    expect(() => extensionPut('key', 'closed')).toThrow()
    await expect(query.all()).rejects.toBeDefined()
  })

  it('attempts every target after one deletion fails and retains the original failure', async () => {
    const original = new Error('native deletion failed')
    const attempted: string[] = []
    const first = memoryBackendPlugin({ id: 'first' })
    const third = memoryBackendPlugin({ id: 'third' })
    const kind = defineStorageBackendKind<ReturnType<typeof catalog>['store']>()('catalog')
    const broken = definePlugin('broken', (core: IStoragePluginCore) => ({
      kind,
      featureExpose: () => ({ getClient: () => undefined }),
      install: () => {
        const state = catalog(core)
        core.registerStore(state.store)
        core.registerOrgBinding(state.store, {
          backend: () => state.store,
          drop: async () => {
            attempted.push('broken')
            throw original
          }
        })
        return {}
      }
    }))
    await using host = await createStorageHost({ plugins: [first, broken, third] })
    const org = createOrgId()
    await host.org(org).backend('first').set('key', 'first')
    await host.org(org).backend('third').set('key', 'third')
    await expect(host.dropOrg(org)).rejects.toMatchObject({
      code: 'ORG_DELETE_FAILED',
      errors: [original],
      cause: original
    })
    expect(await host.org(org).backend('first').get('key')).toBeNull()
    expect(await host.org(org).backend('third').get('key')).toBeNull()
    expect(attempted).toEqual(['broken'])
  })

  it('connects entity business access only to exact authenticated organization views', async () => {
    const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    /** Identical entity layouts remain isolated by the original native namespace. */
    const users = defineEntity<{ id: string; email: string }>()({
      name: 'users',
      key: 'id',
      indexes: { email: { path: 'email', unique: true } }
    })
    const first = createOrgId()
    const second = createOrgId()
    const leftStore = host.org(first).backend('memory')
    const rightStore = host.org(second).backend('memory')
    const left = users.connect(leftStore)
    const right = users.connect(rightStore)
    /**
     * A dynamic dependency ID has no statically known channel; this fixture explicitly declares its
     * installed memory dependency and tests the original runtime admission.
     */
    const borrowed = definePlugin('borrowed-entity', (core) => {
      const store = core.getPublishedBackend('memory')
      const repository = users.connect(
        store as typeof store &
          import('../src/types.js').IStorageBorrowedBackend<
            import('@migaia/storage-contract').IKeyValueStore
          >
      )
      return { install: () => ({ readBorrowed: (id: string) => repository.get(id) }) }
    })
    const composed = await host.use(borrowed)
    await users
      .connect(host.backend('memory'))
      .put({ id: 'default', email: 'default@example.test' })
    expect(await composed.extensions.readBorrowed('default')).toEqual({
      id: 'default',
      email: 'default@example.test'
    })
    await left.put({ id: 'same', email: 'same@example.test' })
    await right.put({ id: 'same', email: 'same@example.test' })
    await leftStore.transaction(async (scope) => {
      await left.in(scope).put({ id: 'left', email: 'left@example.test' })
      await scope.set('status', 'left')
    })
    expect(await left.query().all()).toEqual([
      { id: 'left', email: 'left@example.test' },
      { id: 'same', email: 'same@example.test' }
    ])
    expect(await right.query().all()).toEqual([{ id: 'same', email: 'same@example.test' }])
    await rightStore.transaction((scope) => {
      expect(() => left.in(scope)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    })
    /** Shape forwarding alone cannot copy the original host's exact identity admission. */
    expect(() => users.connect({ ...leftStore })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    expect(() => users.connect(new Proxy(leftStore, {}))).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    expect('dispose' in leftStore).toBe(false)
    const captured = left.query()
    await host.dropOrg(first)
    expect(await captured.all()).toEqual([])
    expect(await right.get('same')).toEqual({ id: 'same', email: 'same@example.test' })
    await host.dispose()
    await expect(captured.all()).rejects.toBeDefined()
  })
})
