import { storageProbe } from '../../src/plugins/probe/index.js'
import { memoryNotificationsFeature } from '../../src/features/memory-notifications.js'
import { memoryChangeFeedFeature } from '../../src/features/memory-change-feed.js'
import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { blob, type IBlobApi, type IStorageChange } from '@migaia/storage-contract'
import {
  createOrgId,
  createStorageHost,
  definePlugin,
  memoryBackendPlugin
} from '../../src/index.js'
import { MemoryOperation } from '../../src/backends/memory-constants.js'

/** Installed stores exercise the reference object backend through the authentic capability token. */
describe('memory native objects', () => {
  it('detaches body and metadata snapshots, inclusive ranges and the one original content claim', async () => {
    await using host = await createStorageHost({
      plugins: [
        storageProbe(),
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    const store = host.backend('memory')
    const api = store.use(blob)
    const body = new Uint8Array([1, 2, 3, 4])
    const metadata = { owner: 'first' }
    const pending = api.put('same', body, { metadata, contentType: 'application/octet-stream' })
    body.fill(9)
    metadata.owner = 'changed'
    const info = await pending
    expect(info).toMatchObject({ key: 'same', size: 4, metadata: { owner: 'first' } })
    await store.set('same', 'separate KV')
    const snapshot = (await api.get('same'))!
    await api.put('same', new Uint8Array([8]))
    expect(await snapshot.bytes()).toEqual(new Uint8Array([1, 2, 3, 4]))
    await expect(snapshot.bytes()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(await store.get('same')).toBe('separate KV')
    await api.put('range', new Uint8Array([1, 2, 3, 4]))
    await using range = (await api.get('range', { range: { start: 1, end: 2 } }))!
    expect(range.info.size).toBe(4)
    expect(await range.bytes()).toEqual(new Uint8Array([2, 3]))
    await using empty = (await api.get('range', { range: { start: 10 } }))!
    expect(await empty.bytes()).toEqual(new Uint8Array())
    const unclaimed = (await api.get('range'))!
    const cleanup = unclaimed.dispose()
    expect(unclaimed.dispose()).toBe(cleanup)
    const symbolic = unclaimed[Symbol.asyncDispose]()
    expect(unclaimed[Symbol.asyncDispose]()).toBe(symbolic)
    expect(symbolic).not.toBe(cleanup)
    await Promise.all([cleanup, symbolic])
    await expect(unclaimed.bytes()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await store.transaction(async (scope) => {
      // @ts-expect-error Object resources have no transaction projection.
      expect(() => scope.use(blob)).toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
      )
    })
  })

  it('checks native conditions before reader ownership and rechecks the generation after upload', async () => {
    await using host = await createStorageHost({
      plugins: [
        storageProbe(),
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    const api = host.backend('memory').use(blob)
    const initial = await api.put('key', new Uint8Array([1]))
    const rejected = new ReadableStream<Uint8Array>()
    const reader = vi.spyOn(rejected, 'getReader')
    await expect(api.put('key', rejected, { ifNoneMatch: true })).rejects.toMatchObject({
      code: 'WRITE_CONFLICT'
    })
    expect(reader).not.toHaveBeenCalled()
    const read = deferred<void>()
    const release = deferred<void>()
    const upload = new ReadableStream<Uint8Array>(
      {
        async pull(native) {
          read.resolve()
          await release.promise
          native.enqueue(new Uint8Array([2]))
          native.close()
        }
      },
      { highWaterMark: 0 }
    )
    const pending = api.put('key', upload, { ifMatch: initial.etag })
    await read.promise
    const replacement = await api.put('key', new Uint8Array([3]))
    release.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    expect(await api.head('key')).toEqual(replacement)
    await using value = (await api.get('key'))!
    expect(await value.bytes()).toEqual(new Uint8Array([3]))
  })

  it('cancels blocked uploads once, preserves abort causes and retains old data after native failure', async () => {
    await using host = await createStorageHost({
      plugins: [
        storageProbe(),
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    const api = host.backend('memory').use(blob)
    const initial = await api.put('key', new Uint8Array([1]))
    const read = deferred<void>()
    const cancel = vi.fn()
    const upload = new ReadableStream<Uint8Array>(
      {
        pull() {
          read.resolve()
        },
        cancel
      },
      { highWaterMark: 0 }
    )
    const controller = new AbortController()
    const reason = new Error('cancel native memory upload')
    const pending = api.put('key', upload, { ctx: { signal: controller.signal } })
    await read.promise
    controller.abort(reason)
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause: reason })
    expect(cancel).toHaveBeenCalledExactlyOnceWith(reason)
    expect(upload.locked).toBe(false)
    expect(await api.head('key')).toEqual(initial)
    const failure = new Error('native memory body failed')
    const broken = new ReadableStream<Uint8Array>(
      {
        pull(native) {
          native.error(failure)
        }
      },
      { highWaterMark: 0 }
    )
    await expect(api.put('key', broken)).rejects.toMatchObject({
      code: 'SERIALIZE_FAILED',
      cause: failure
    })
    expect(broken.locked).toBe(false)
    expect(await api.head('key')).toEqual(initial)
    const closeRead = deferred<void>()
    const closeCancel = vi.fn()
    const closingHost = await createStorageHost({
      plugins: [
        storageProbe(),
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    const closingUpload = new ReadableStream<Uint8Array>(
      {
        pull() {
          closeRead.resolve()
        },
        cancel: closeCancel
      },
      { highWaterMark: 0 }
    )
    const closingPut = closingHost.backend('memory').use(blob).put('unfinished', closingUpload)
    const settledPut = expect(closingPut).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await closeRead.promise
    await closingHost.dispose()
    await settledPut
    expect(closeCancel).toHaveBeenCalledTimes(1)
    expect(closingUpload.locked).toBe(false)
  })

  it('uses native ordered prefix pages with org-bound cursors and exact organization cleanup', async () => {
    const defaultOrg = createOrgId()
    const orgA = createOrgId()
    const orgB = createOrgId()
    await using host = await createStorageHost({
      org: defaultOrg,
      plugins: [
        storageProbe(),
        memoryBackendPlugin(
          { namespace: 'objects' },
          {
            notifications: memoryNotificationsFeature(),
            changeFeed: memoryChangeFeedFeature()
          }
        )
      ]
    })
    const root = host.backend('memory').use(blob)
    const a = host.org(orgA).backend('memory').use(blob)
    const b = host.org(orgB).backend('memory').use(blob)
    const keys = ['p/\ud800', 'p/😀', 'p/z', 'p/\u0000', 'else']
    for (const key of keys) await root.put(key, new Uint8Array([1]))
    await a.put('p/a', new Uint8Array([2]))
    await b.put('p/b', new Uint8Array([3]))
    const first = await root.list({ prefix: 'p/', limit: 2 })
    const second = await root.list({ prefix: 'p/', limit: 2, after: first.next })
    expect([...first.items, ...second.items].map((item) => item.key)).toEqual(
      keys.filter((key) => key.startsWith('p/')).sort()
    )
    expect(second.next).toBeUndefined()
    await expect(root.list({ prefix: '', after: first.next })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    await expect(a.list({ prefix: 'p/', after: first.next })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect((await host.org(defaultOrg).backend('memory').use(blob).list()).items).toHaveLength(5)
    const extracted = b.list
    await host.dropOrg(orgA)
    expect((await a.list()).items).toEqual([])
    expect((await extracted()).items.map((item) => item.key)).toEqual(['p/b'])
    expect(await root.removeByPrefix('p/')).toBe(4)
    expect(await root.removeByPrefix('p/')).toBe(0)
    expect((await root.list()).items.map((item) => item.key)).toEqual(['else'])
  })

  it('accounts one native body per entry in the original cross-channel capacity and invalidation owner', async () => {
    await using host = await createStorageHost({
      plugins: [
        storageProbe(),
        memoryBackendPlugin(
          { capacity: { maxEntries: 2, maxBytes: 4 } },
          {
            notifications: memoryNotificationsFeature(),
            changeFeed: memoryChangeFeedFeature()
          }
        )
      ]
    })
    const store = host.backend('memory')
    const api = store.use(blob)
    const changes: IStorageChange[] = []
    const evicted = vi.fn()
    store.subscribeChanges((change) => changes.push(change))
    host.extensions.observe('onEvict', evicted)
    await api.put('one', new Uint8Array([1, 2]), { metadata: { ignored: 'metadata is not body' } })
    await store.set('text', 'ab')
    await api.head('one')
    await api.put('two', new Uint8Array([3, 4]))
    expect(await store.get('text')).toBeNull()
    expect(await api.head('one')).toBeDefined()
    await api.put('large', new Uint8Array(5))
    expect((await api.list()).items).toEqual([])
    expect(evicted.mock.calls.some(([event]) => event.channel === 'blob')).toBe(true)
    expect(
      changes
        .filter((change) => change.channel === 'all')
        .every((change) => change.keys === undefined)
    ).toBe(true)
    await api.put('clear', new Uint8Array([1]))
    await store.clearAll()
    expect(await api.head('clear')).toBeUndefined()
  })

  it('honors in-place pipeline intervention once before native body ownership', async () => {
    let entries = 0
    const intervene = definePlugin('blob-intervention', (core) => ({
      install() {
        core.useAsyncPipeline(async (input, next) => {
          if (input.operation === MemoryOperation.blobPut) {
            entries++
            Object.assign(input.input as object, { key: 'changed', body: new Uint8Array([7]) })
          }
          await next(input)
        })
        return {}
      }
    }))
    await using host = await createStorageHost({
      plugins: [
        storageProbe(),
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        }),
        intervene
      ]
    })
    const api: IBlobApi = host.backend('memory').use(blob)
    await api.put('original', new Uint8Array([1]))
    expect(entries).toBe(1)
    expect(await api.head('original')).toBeUndefined()
    await using object = (await api.get('changed'))!
    expect(await object.bytes()).toEqual(new Uint8Array([7]))
  })
})
