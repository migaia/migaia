// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { asChangeFeedStore, isChangeFeedStore } from '@migaia/storage-contract'
import { createOrgId, createStorageHost } from '@migaia/storage-host'
import { localStorageBackendPlugin } from '../../src/local-storage.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'
import { lengthPrefixedNamespaceCodec } from '../../src/utils/key.js'

describe('native localStorage text watch', () => {
  it('does not admit a Storage-like injection without its matching native event source', async () => {
    await using host = await createStorageHost({
      plugins: [localStorageBackendPlugin({ storage: fakeWebStorage() })]
    })
    const store = host.backend('local')
    expect(store.capabilities.changeFeed).toBe(false)
    expect(isChangeFeedStore(store)).toBe(false)
    expect(() => asChangeFeedStore(store)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    await store.set('key', 'ordinary KV')
    expect(await store.get('key')).toBe('ordinary KV')
  })

  it('uses the original controller for committed local writes and exact native namespace events', async () => {
    const namespace = 'watch-' + createOrgId()
    await using host = await createStorageHost({
      plugins: [localStorageBackendPlugin({ namespace })]
    })
    const store = asChangeFeedStore(host.backend('local'))
    const stream = store.watch('theme')
    try {
      const own = stream.next()
      await store.set('theme', 'dark')
      expect((await own).value).toMatchObject({ channel: 'value', kind: 'put', keys: ['theme'] })
      const remote = stream.next()
      window.dispatchEvent(
        new StorageEvent('storage', {
          storageArea: sessionStorage,
          key: lengthPrefixedNamespaceCodec.encode(namespace, 'theme'),
          newValue: 'wrong storage'
        })
      )
      window.dispatchEvent(
        new StorageEvent('storage', {
          storageArea: localStorage,
          key: lengthPrefixedNamespaceCodec.encode(namespace + '-foreign', 'theme'),
          newValue: 'wrong namespace'
        })
      )
      window.dispatchEvent(
        new StorageEvent('storage', {
          storageArea: localStorage,
          key: lengthPrefixedNamespaceCodec.encode(namespace, 'theme'),
          newValue: null
        })
      )
      expect((await remote).value).toMatchObject({
        channel: 'value',
        kind: 'remove',
        keys: ['theme']
      })
      const clear = stream.next()
      window.dispatchEvent(new StorageEvent('storage', { storageArea: localStorage, key: null }))
      expect((await clear).value).toMatchObject({ channel: 'value', kind: 'clear' })
    } finally {
      await stream.dispose()
      await store.clearAll()
    }
  })

  it('keeps child organization filtering and releases the native listener with the original host', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const namespace = 'watch-org-' + createOrgId()
    const host = await createStorageHost({
      plugins: [localStorageBackendPlugin({ namespace })]
    })
    const org = createOrgId()
    const store = host.org(org).backend('local')
    const stream = store.watch('theme')
    try {
      const pending = stream.next()
      window.dispatchEvent(
        new StorageEvent('storage', {
          storageArea: localStorage,
          key: lengthPrefixedNamespaceCodec.encode(namespace, 'theme'),
          newValue: 'default'
        })
      )
      window.dispatchEvent(
        new StorageEvent('storage', {
          storageArea: localStorage,
          key: lengthPrefixedNamespaceCodec.encode(namespace + '/' + org, 'theme'),
          newValue: 'child'
        })
      )
      expect((await pending).value).toMatchObject({ orgId: org, keys: ['theme'] })
      const closed = expect(stream.next()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
      await host.dispose()
      await closed
      expect(remove).toHaveBeenCalledWith('storage', expect.any(Function))
    } finally {
      await stream.dispose()
      await host.dispose()
      remove.mockRestore()
    }
  })
})
