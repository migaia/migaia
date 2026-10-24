import { indexedDbTestFeatures } from '../helpers/indexed-db-features.js'
import { describe, expect, it, vi } from 'vitest'
import { IDBDatabase, IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { kv } from '@migaia/storage-contract'
import { walkErrorCauses } from '@migaia/utils/error'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'
import { serializeCookieAssignment } from '../../src/utils/cookie-string.js'
import { lengthPrefixedNamespaceCodec, namespacedStorageKey } from '../../src/utils/key.js'
import {
  createCookieTestStore,
  createLocalTestStore,
  createSessionTestStore
} from '../helpers/installed-backends.js'

describe('standard native KV batches', () => {
  it('keeps a scoped invalid batch on the original first-failure path', async () => {
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(
          { factory: new IDBFactory(), keyRange: IDBKeyRange },
          indexedDbTestFeatures
        )
      ]
    })
    const store = host.backend('indexed-db')
    let operationFailure: unknown
    const failure = await store
      .transaction(async (scope) => {
        await scope.getMany({} as never).catch((cause: unknown) => {
          operationFailure = cause
        })
      })
      .catch((cause: unknown) => cause)
    expect(failure).toBe(operationFailure)
    expect(failure).toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(store.use(kv).getMany(['unused'])).resolves.toEqual([undefined])
  })

  it('preserves scoped entry getter order before unsupported TTL and duplicate failures', async () => {
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(
          { factory: new IDBFactory(), keyRange: IDBKeyRange },
          indexedDbTestFeatures
        )
      ]
    })
    const store = host.backend('indexed-db')
    /** Invalid keys fail before any value getter; a later duplicate still reads value then TTL. */
    const reads: string[] = []
    const original = new Error('ttl-getter')
    const invalid = await store
      .transaction((scope) =>
        scope.setMany([
          {
            get key() {
              reads.push('key')
              return []
            },
            get value(): string {
              reads.push('value')
              throw original
            }
          }
        ])
      )
      .catch((cause: unknown) => cause)
    expect(invalid).toMatchObject({ code: 'INVALID_KEY' })
    expect(reads).toEqual(['key'])
    reads.length = 0
    const failure = await store
      .transaction((scope) =>
        scope.setMany([
          { key: ['duplicate'], value: 'first' },
          {
            get key() {
              reads.push('key')
              return ['duplicate']
            },
            get value() {
              reads.push('value')
              return 'second'
            },
            get ttlMs(): number {
              reads.push('ttl')
              throw original
            }
          }
        ])
      )
      .catch((cause: unknown) => cause)
    expect(reads).toEqual(['key', 'value', 'ttl'])
    expect(walkErrorCauses(failure)).toContain(original)
    await expect(store.use(kv).getMany([['duplicate']])).resolves.toEqual([undefined])
  })

  it('uses one native transaction and one pipeline per nonempty root batch with atomic rollback', async () => {
    /** The ordinary plugin sees only the actual public execution endpoints. */
    const operations: string[] = []
    const observer = definePlugin('batch-pipeline', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          operations.push(input.operation)
          return next(input)
        })
        return {}
      }
    }))
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(
          { factory: new IDBFactory(), keyRange: IDBKeyRange },
          indexedDbTestFeatures
        ),
        observer
      ]
    })
    const store = host.backend('indexed-db')
    const api = store.use(kv)
    /** The original host observes one aggregate payload, with no keys or values. */
    const before = vi.fn()
    const after = vi.fn()
    const failed = vi.fn()
    host.hooks.on('beforeStorageOperation', before)
    host.hooks.on('afterStorageOperation', after)
    host.hooks.on('onStorageOperationError', failed)
    /** Database preparation is complete before counting native batch admission. */
    const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction')
    try {
      operations.length = 0
      await expect(api.getMany([])).resolves.toEqual([])
      await expect(api.setMany([])).resolves.toBeUndefined()
      await expect(api.removeMany([])).resolves.toBe(0)
      expect(transaction).not.toHaveBeenCalled()
      expect(operations).toEqual([])

      await expect(
        api.setMany([{ key: 'invalid', value: 1 as unknown as string }])
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      await expect(api.setMany([{ key: 'ttl', value: 'value', ttlMs: -1 }])).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
      expect(transaction).not.toHaveBeenCalled()
      expect(operations).toEqual([])
      expect(before).not.toHaveBeenCalled()
      expect(after).not.toHaveBeenCalled()
      await expect(
        api.setMany([
          { key: new Date(1), value: 'a' },
          { key: new Date(1), value: 'b' }
        ])
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      expect(transaction).not.toHaveBeenCalled()
      expect(operations).toEqual([])

      await api.setMany([
        { key: 1, value: 'number' },
        { key: '1', value: 'string' },
        { key: ['row', 1], value: 'tuple' }
      ])
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(operations).toEqual(['indexed-db.setMany'])
      expect(before).toHaveBeenCalledTimes(1)
      expect(before).toHaveBeenCalledWith({
        backendId: 'indexed-db',
        backend: 'indexed-db',
        orgId: '00000000-0000-0000-0000-000000000000',
        operation: 'indexed-db.setMany',
        count: 3
      })
      expect(after).toHaveBeenCalledTimes(1)
      transaction.mockClear()
      operations.length = 0
      await expect(api.getMany([['row', 1], 1, 'missing', 1, '1'])).resolves.toEqual([
        'tuple',
        'number',
        undefined,
        'number',
        'string'
      ])
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(operations).toEqual(['indexed-db.getMany'])
      transaction.mockClear()
      operations.length = 0
      await expect(api.removeMany([1, 1, ['row', 1], 'missing'])).resolves.toBe(2)
      expect(transaction).toHaveBeenCalledTimes(1)
      expect(operations).toEqual(['indexed-db.removeMany'])
      await api.setMany([
        { key: ['prefix', 1], value: 'a' },
        { key: ['prefix', 2], value: 'b' },
        { key: ['prefix-other', 1], value: 'c' }
      ])
      await expect(api.removeByPrefix(['prefix'])).resolves.toBe(2)
      await expect(
        api.getMany([
          ['prefix', 1],
          ['prefix-other', 1]
        ])
      ).resolves.toEqual([undefined, 'c'])

      await store.putRecord({ occupied: true }, ['occupied'])
      await expect(
        api.setMany([
          { key: 'fresh', value: 'first' },
          { key: ['occupied'], value: 'conflict' }
        ])
      ).rejects.toMatchObject({ code: 'DUPLICATE_KEY' })
      expect(failed).toHaveBeenCalledTimes(1)
      expect(failed).toHaveBeenCalledWith({
        backendId: 'indexed-db',
        backend: 'indexed-db',
        orgId: '00000000-0000-0000-0000-000000000000',
        operation: 'indexed-db.setMany',
        code: 'DUPLICATE_KEY',
        count: 2
      })
      await expect(api.getMany(['fresh'])).resolves.toEqual([undefined])
      await expect(store.getRecord(['occupied'])).resolves.toEqual({ occupied: true })
    } finally {
      transaction.mockRestore()
    }
  })

  it('observes scoped batches once through their original transaction identity', async () => {
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(
          { factory: new IDBFactory(), keyRange: IDBKeyRange },
          indexedDbTestFeatures
        )
      ]
    })
    const store = host.backend('indexed-db')
    const before = vi.fn()
    const after = vi.fn()
    host.hooks.on('beforeStorageOperation', before)
    host.hooks.on('afterStorageOperation', after)
    await store.transaction(async (scope) => {
      const api = scope.use(kv)
      await api.getMany([])
      await api.setMany([])
      await api.removeMany([])
      expect(before).not.toHaveBeenCalled()
      await api.setMany([{ key: 'scoped', value: 'value' }])
      await expect(api.getMany(['scoped', 'scoped'])).resolves.toEqual(['value', 'value'])
      await expect(api.removeMany(['scoped', 'scoped'])).resolves.toBe(1)
      await expect(api.removeByPrefix('scoped')).resolves.toBe(0)
    })
    expect(before).toHaveBeenCalledTimes(4)
    expect(after).toHaveBeenCalledTimes(4)
    expect(before.mock.calls.map(([payload]) => [payload.operation, payload.count])).toEqual([
      ['transaction.setMany', 1],
      ['transaction.getMany', 2],
      ['transaction.removeMany', 2],
      ['transaction.removeByPrefix', undefined]
    ])
    expect(new Set(before.mock.calls.map(([payload]) => payload.transactionId)).size).toBe(1)
    expect(before.mock.calls[0]![0].transactionId).toEqual(expect.any(String))
  })

  it('preserves native batch read failures and rejects unsupported typed codecs before I/O', async () => {
    /** A real injected Storage retains its original string data and observable native reads. */
    const storage = fakeWebStorage()
    /** Public installation captures the legacy codec without manufacturing a typed adapter. */
    const store = await createLocalTestStore({
      storage,
      namespaceCodec: {
        encode: lengthPrefixedNamespaceCodec.encode,
        decode: lengthPrefixedNamespaceCodec.decode
      }
    })
    await store.set('key', 'value')
    /** Native read observation distinguishes unsupported admission from a missing stored value. */
    const read = vi.spyOn(storage, 'getItem')
    try {
      await expect(store.use(kv).getMany([1])).rejects.toMatchObject({
        code: 'UNSUPPORTED_CAPABILITY'
      })
      expect(read).not.toHaveBeenCalled()
      await expect(store.use(kv).getMany(['key'])).resolves.toEqual(['value'])
      /** Native failure stays reachable; a batch never converts it into a missing value. */
      const original = new Error('native-batch-read')
      read.mockImplementation(() => {
        throw original
      })
      /** The package error must keep the same injected host failure reachable through its cause. */
      const failure = await store
        .use(kv)
        .getMany(['key'])
        .catch((cause: unknown) => cause)
      expect(failure).toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
      expect(walkErrorCauses(failure)).toContain(original)
    } finally {
      read.mockRestore()
    }
    /** The ordinary cookie port remains owned by the same installed browser backend. */
    const document = fakeCookieDocument()
    /** Public installation supplies the actual scope and batch API for the visible header. */
    const cookies = await createCookieTestStore({ document, namespace: 'ambiguous' })
    /** Same-name cookies from distinct browser scopes cannot be picked arbitrarily by getMany. */
    const physical = namespacedStorageKey(
      'ambiguous',
      'key',
      lengthPrefixedNamespaceCodec,
      'cookies'
    )
    /** A duplicate visible name models the browser's existing cross-scope ambiguity. */
    const header = vi.spyOn(document, 'cookie', 'get')
    try {
      header.mockReturnValue(
        `${encodeURIComponent(physical)}=one; ${encodeURIComponent(physical)}=two`
      )
      await expect(cookies.use(kv).getMany(['key'])).rejects.toMatchObject({
        code: 'COOKIE_SCOPE_AMBIGUOUS'
      })
    } finally {
      header.mockRestore()
    }
  })

  for (const backend of ['local', 'session', 'cookies'] as const)
    it(`${backend} reads mixed keys without collisions and rejects writes before native effects without WAL`, async () => {
      const storage = fakeWebStorage()
      const document = fakeCookieDocument()
      const store =
        backend === 'local'
          ? await createLocalTestStore({ storage, namespace: 'batch' })
          : backend === 'session'
            ? await createSessionTestStore({ storage, namespace: 'batch' })
            : await createCookieTestStore({ document, namespace: 'batch' })
      const api = store.use(kv)
      await store.set('1', 'string')
      /** Seed a supported physical layout without pretending an unconfigured WAL can write a batch. */
      const physical = namespacedStorageKey('batch', 1, lengthPrefixedNamespaceCodec, store.backend)
      if (backend === 'cookies')
        document.cookie = serializeCookieAssignment(physical, 'number', { path: '/' })
      else storage.setItem(physical, 'number')
      await expect(api.getMany([1, '1', 1, 'missing'])).resolves.toEqual([
        'number',
        'string',
        'number',
        undefined
      ])
      await expect(store.keys()).resolves.toEqual(['1'])
      await expect(
        api.setMany([
          { key: 'first', value: 'a' },
          { key: 'last', value: 'b' }
        ])
      ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
      await expect(api.removeMany([1, '1'])).rejects.toMatchObject({
        code: 'UNSUPPORTED_CAPABILITY'
      })
      await expect(api.removeByPrefix('')).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
      await expect(api.getMany([1, '1', 'first', 'last'])).resolves.toEqual([
        'number',
        'string',
        undefined,
        undefined
      ])
      await expect(api.setMany([])).resolves.toBeUndefined()
      await expect(api.removeMany([])).resolves.toBe(0)
      await store.clearAll()
      await expect(api.getMany([1, '1'])).resolves.toEqual([undefined, undefined])
    })
})
