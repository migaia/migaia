import { afterEach, describe, expect, it, vi, onTestFinished } from 'vitest'
import { createSessionTestStore } from '../helpers/installed-backends.ts'

describe('sessionStorageHost 默认注入', () => {
  afterEach(() => {
    globalThis.sessionStorage.clear()
  })
  it('未传 storage 时使用 globalThis.sessionStorage', async () => {
    const store = await createSessionTestStore({ namespace: 'default-inject' })
    /** Each observation wraps the original Storage method and excludes fixture setup. */
    const nativeWrite = vi.spyOn(Storage.prototype, 'setItem')
    /** Async and sync reads must both reach this backend's actual Storage instance. */
    const nativeRead = vi.spyOn(Storage.prototype, 'getItem')
    /** Deletion must reach the borrowed Storage rather than a backend-local mirror. */
    const nativeRemove = vi.spyOn(Storage.prototype, 'removeItem')
    onTestFinished(() => {
      nativeWrite.mockRestore()
      nativeRead.mockRestore()
      nativeRemove.mockRestore()
    })
    await store.set('k', 'v')
    expect(nativeWrite).toHaveBeenCalledWith('sw1:14:default-inject:k', 'v')
    expect(nativeWrite.mock.contexts).toContain(globalThis.sessionStorage)
    expect(globalThis.sessionStorage.getItem('sw1:14:default-inject:k')).toBe('v')
    nativeRead.mockClear()
    expect(await store.get('k')).toBe('v')
    expect(nativeRead).toHaveBeenCalledWith('sw1:14:default-inject:k')
    expect(nativeRead.mock.contexts).toContain(globalThis.sessionStorage)
    nativeWrite.mockClear()
    store.sync.set('k', 'sync')
    expect(nativeWrite).toHaveBeenCalledWith('sw1:14:default-inject:k', 'sync')
    expect(nativeWrite.mock.contexts).toContain(globalThis.sessionStorage)
    nativeRead.mockClear()
    expect(store.sync.get('k')).toBe('sync')
    expect(nativeRead).toHaveBeenCalledWith('sw1:14:default-inject:k')
    expect(nativeRead.mock.contexts).toContain(globalThis.sessionStorage)
    nativeRemove.mockClear()
    await store.remove('k')
    expect(nativeRemove).toHaveBeenCalledWith('sw1:14:default-inject:k')
    expect(nativeRemove.mock.contexts).toContain(globalThis.sessionStorage)
  })
})
