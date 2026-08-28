import { describe, expect, it } from 'vitest'
import { memoryStorage } from '@migaia/storage-web/memory'
import { createStore } from '@migaia/store-light'
import { persist } from '../src/light-index'

describe('persist（store-light）', () => {
  it('snapshots accessor-backed options exactly once', () => {
    const store = createStore({ count: 1 })
    const storage = memoryStorage()
    let reads = 0
    const options = { storage } as { key: string; storage: typeof storage }
    Object.defineProperty(options, 'key', {
      enumerable: false,
      get: () => {
        reads++
        if (reads > 1) throw new Error('key reread')
        return 'snapshot-key'
      }
    })
    const handle = persist(store, options)
    expect(reads).toBe(1)
    handle.dispose()
    store.$dispose()
  })

  it('rejects invalid version and debounce values before creating a persistence unit', () => {
    const store = createStore({ count: 1 })
    const storage = memoryStorage()
    for (const version of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => persist(store, { key: `version-${String(version)}`, storage, version })).toThrow(
        'version must be a safe, non-negative integer'
      )
    }
    for (const debounceMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
      expect(() =>
        persist(store, { key: `debounce-${String(debounceMs)}`, storage, debounceMs })
      ).toThrow('debounceMs must be a finite, non-negative number')
    }
    store.$dispose()
  })
  it('rejects null options with a tagged configuration error', () => {
    const store = createStore({ count: 1 })
    expect(() => persist(store, null as never)).toThrow('[store] persist options must be an object')
    store.$dispose()
  })
  it('rejects non-string storage keys before creating a persistence unit', () => {
    const store = createStore({ count: 1 })
    const storage = memoryStorage()
    expect(() => persist(store, { key: undefined as never, storage })).toThrow(
      '[store] persist key must be a string'
    )
    store.$dispose()
  })
  it('rejects invalid persistence callbacks and codecs before subscription', () => {
    const store = createStore({ count: 1 })
    const storage = memoryStorage()
    for (const [name, value] of [
      ['migrate', 1],
      ['partialize', null]
    ] as const) {
      expect(() => persist(store, { key: name, storage, [name]: value } as never)).toThrow(
        `[store] persist "${name}" ${name} must be a function`
      )
    }
    expect(() => persist(store, { key: 'codec', storage, codec: { encode: 1 } as never })).toThrow(
      '[store] persist "codec" codec is invalid'
    )
    const hostileCodec = new Proxy(
      {},
      {
        get: () => {
          throw new Error('codec getter failure')
        }
      }
    )
    try {
      persist(store, { key: 'hostile-codec', storage, codec: hostileCodec as never })
      throw new Error('expected hostile codec to fail')
    } catch (error) {
      expect(error).toMatchObject({
        source: '@migaia/store-persist',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    }
    const hostileStorage = new Proxy(storage, {
      get: () => {
        throw new Error('storage getter failure')
      }
    })
    expect(() =>
      persist(store, { key: 'hostile-storage', storage: hostileStorage as never })
    ).toThrow('[store] persist "hostile-storage" storage adapter is invalid')
    const { proxy: hostileOptions, revoke } = Proxy.revocable(
      { key: 'hostile-options', storage },
      {}
    )
    revoke()
    try {
      persist(store, hostileOptions as never)
      throw new Error('expected hostile options to fail')
    } catch (error) {
      expect(error).toMatchObject({
        source: '@migaia/store-persist',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    }
    store.$dispose()
  })
  it('hydrate 未命中时立即可用，写入后 flush 落盘', async () => {
    const store = createStore({ count: 1 })
    const storage = memoryStorage()
    const handle = persist(store, { key: 'count', storage })
    store.count = 2
    await handle.flush()
    const raw = await storage.get('count')
    expect(raw).toContain('2')
    handle.dispose()
    store.$dispose()
  })

  it('hydrate 命中时把持久化值写回 store', async () => {
    const storage = memoryStorage()
    await storage.set('settings', JSON.stringify({ version: 0, state: { theme: 'dark' } }))
    const store = createStore({ theme: 'light' })
    const handle = persist(store, { key: 'settings', storage })
    await handle.ready
    expect(store.theme).toBe('dark')
    handle.dispose()
    store.$dispose()
  })

  it('hydrate 与启动期 mutation 竞争时保留双方对象字段', async () => {
    const storage = memoryStorage()
    await storage.set('race', JSON.stringify({ version: 0, state: { persisted: true } }))
    const originalGet = storage.get
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    storage.get = async (key, ctx) => {
      await gate
      return originalGet(key, ctx)
    }
    const store = createStore({ persisted: false, local: 0 })
    const handle = persist(store, { key: 'race', storage })
    store.local = 1
    release()
    await handle.ready
    expect(store.persisted).toBe(true)
    expect(store.local).toBe(1)
    handle.dispose()
    store.$dispose()
  })

  it('hydrate 与启动期同字段 mutation 竞争时保留本地新值并写回', async () => {
    const storage = memoryStorage()
    await storage.set('same-field-race', JSON.stringify({ version: 0, state: { count: 10 } }))
    const originalGet = storage.get
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    storage.get = async (key, ctx) => {
      await gate
      return originalGet(key, ctx)
    }
    const store = createStore({ count: 0 })
    const handle = persist(store, { key: 'same-field-race', storage })
    store.count = 20
    release()
    await handle.ready
    expect(store.count).toBe(20)
    await handle.flush()
    expect(await storage.get('same-field-race')).toContain('20')
    handle.dispose()
    store.$dispose()
  })

  it('flush observes a failing write already in flight', async () => {
    const storage = memoryStorage()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    storage.set = async () => {
      await gate
      throw new Error('disk full')
    }
    const store = createStore({ count: 0 })
    const handle = persist(store, { key: 'flush-failure', storage })
    await handle.ready
    store.count = 1
    await Promise.resolve()
    const flush = handle.flush()
    release()
    await expect(flush).rejects.toThrow('disk full')
    handle.dispose()
    store.$dispose()
  })

  it('preserves a storage failure when it settles before dispose', async () => {
    const storage = memoryStorage()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const failure = new Error('storage failed before dispose')
    storage.set = async () => {
      await gate
      throw failure
    }
    const store = createStore({ count: 0 })
    const handle = persist(store, { key: 'failure-before-dispose', storage })
    await handle.ready
    store.count = 1
    await Promise.resolve()
    const flush = handle.flush()
    release()
    await expect(flush).rejects.toBe(failure)
    handle.dispose()
    store.$dispose()
  })

  it('retains a late storage failure as AbortError cause when dispose wins the race', async () => {
    const storage = memoryStorage()
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    let started!: () => void
    const startedPromise = new Promise<void>((resolve) => (started = resolve))
    const failure = new Error('storage failed after dispose')
    storage.set = async () => {
      started()
      await gate
      throw failure
    }
    const store = createStore({ count: 0 })
    const handle = persist(store, { key: 'failure-after-dispose', storage })
    await handle.ready
    store.count = 1
    await startedPromise
    const flush = handle.flush()
    handle.dispose()
    release()
    const thrown = await flush.catch((error: unknown) => error)
    expect(thrown).toBeInstanceOf(DOMException)
    expect(thrown).toMatchObject({
      name: 'AbortError',
      source: '@migaia/store-persist',
      code: 'ABORTED_BY_DISPOSE',
      cause: failure
    })
    store.$dispose()
  })

  it('partialize 只持久化裁剪后的字段', async () => {
    const store = createStore({ theme: 'light', session: 'secret' })
    const storage = memoryStorage()
    const handle = persist(store, {
      key: 'partial',
      storage,
      partialize: (state) => ({ theme: state.theme })
    })
    store.theme = 'dark'
    store.session = 'other'
    await handle.flush()
    const raw = await storage.get('partial')
    expect(raw).not.toBeNull()
    const parsed = JSON.parse(raw as string) as { state: Record<string, unknown> }
    expect(parsed.state).toEqual({ theme: 'dark' })
    handle.dispose()
    store.$dispose()
  })

  it('version 不一致且未提供 migrate 时 hydrate 失败，status 变 error', async () => {
    const storage = memoryStorage()
    await storage.set('versioned', JSON.stringify({ version: 5, state: { count: 1 } }))
    const store = createStore({ count: 0 })
    const handle = persist(store, { key: 'versioned', storage, version: 1 })
    await expect(handle.ready).rejects.toThrow(/provide migrate/)
    expect(handle.status.value).toBe('error')
    handle.dispose()
    store.$dispose()
  })

  it('migrate 转换旧版本存档', async () => {
    const storage = memoryStorage()
    await storage.set('migratable', JSON.stringify({ version: 1, state: { legacyCount: 3 } }))
    const store = createStore({ count: 0 })
    const handle = persist(store, {
      key: 'migratable',
      storage,
      version: 2,
      migrate: (persisted) => ({ count: persisted.legacyCount as number })
    })
    await handle.ready
    expect(store.count).toBe(3)
    handle.dispose()
    store.$dispose()
  })

  it('合法的 falsy 持久化值（0/false/空字符串）不会被误判成"未命中"', async () => {
    const storage = memoryStorage()
    await storage.set('falsy', JSON.stringify({ version: 0, state: { count: 0, active: false } }))
    const store = createStore({ count: 99, active: true })
    const handle = persist(store, { key: 'falsy', storage })
    await handle.ready
    expect(store.count).toBe(0)
    expect(store.active).toBe(false)
    handle.dispose()
    store.$dispose()
  })

  it('dispose 在 hydrate 还没落地时调用，settled/ready 都能收敛，不遗留挂起状态', async () => {
    const store = createStore({ count: 1 })
    const storage = memoryStorage()
    const handle = persist(store, { key: 'dispose-during-hydrate', storage })
    handle.dispose() // 没有 await handle.ready，立刻 dispose
    await handle.settled
    expect(handle.status.value).toBe('disposed')
    store.$dispose()
  })

  it('dispose 后 flush/clear 立即以 AbortError 结束', async () => {
    const store = createStore({ count: 0 })
    const storage = memoryStorage()
    const handle = persist(store, { key: 'disposed', storage })
    await handle.ready
    handle.dispose()
    await expect(handle.flush()).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof DOMException &&
        error.name === 'AbortError' &&
        (error as { source?: string }).source === '@migaia/store-persist' &&
        (error as unknown as { code?: string }).code === 'ABORTED_BY_DISPOSE'
    )
    await expect(handle.clear()).rejects.toSatisfy(
      (error: unknown) => error instanceof DOMException && error.name === 'AbortError'
    )
    store.$dispose()
  })

  it('clear() 删除存档但不重置 store 字段', async () => {
    const store = createStore({ count: 1 })
    const storage = memoryStorage()
    const handle = persist(store, { key: 'clearable', storage })
    store.count = 9
    await handle.flush()
    await handle.clear()
    expect(await storage.get('clearable')).toBeNull()
    expect(store.count).toBe(9)
    handle.dispose()
    store.$dispose()
  })
})
