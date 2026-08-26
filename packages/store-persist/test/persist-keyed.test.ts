import { describe, expect, it } from 'vitest'
import { memoryStorage } from '@migaia/storage-web'
import { createAtomStore, familyDef } from '@migaia/store-keyed'
import { createRuntime } from '@migaia/reactive'
import { persistKeyed, clearFamily } from '../src/keyed-index'

describe('persistKeyed（store-keyed）', () => {
  it('snapshots accessor-backed options exactly once', () => {
    const runtime = createRuntime()
    const atomStore = createAtomStore(runtime)
    const definition = familyDef(() => ({ name: '' }))
    const storage = memoryStorage()
    let reads = 0
    const options = { storage } as { namespace: string; storage: typeof storage }
    Object.defineProperty(options, 'namespace', {
      enumerable: false,
      get: () => {
        reads++
        if (reads > 1) throw new Error('namespace reread')
        return 'snapshot'
      }
    })
    const handle = persistKeyed(atomStore, definition('u1'), 'u1', options)
    expect(reads).toBe(1)
    handle.dispose()
  })

  it('rejects null options with a tagged configuration error', () => {
    const runtime = createRuntime()
    const atomStore = createAtomStore(runtime)
    const userProfile = familyDef(() => ({ name: '' }))
    expect(() => persistKeyed(atomStore, userProfile('u1'), 'u1', null as never)).toThrow(
      '[store] persist options must be an object'
    )
  })
  it('rejects non-string namespace and id before deriving a storage key', () => {
    const runtime = createRuntime()
    const atomStore = createAtomStore(runtime)
    const userProfile = familyDef(() => ({ name: '' }))
    const storage = memoryStorage()
    expect(() =>
      persistKeyed(atomStore, userProfile('u1'), undefined as never, {
        namespace: 'users',
        storage
      })
    ).toThrow('[store] persist id must be a string')
    expect(() =>
      persistKeyed(atomStore, userProfile('u1'), 'u1', {
        namespace: undefined as never,
        storage
      })
    ).toThrow('[store] persist namespace must be a string')
  })
  it('立即同步返回默认值，hydrate 命中后异步覆盖', async () => {
    const storage = memoryStorage()
    await storage.set('users:u1', JSON.stringify({ version: 0, state: { name: 'Ada' } }))
    const runtime = createRuntime()
    const atomStore = createAtomStore(runtime)
    const userProfile = familyDef(() => ({ name: '' }))

    const { value, dispose } = persistKeyed(atomStore, userProfile('u1'), 'u1', {
      namespace: 'users',
      storage
    })
    expect(value).toEqual({ name: '' }) // 同步返回，还没 hydrate

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(atomStore.peek(userProfile('u1'))).toEqual({ name: 'Ada' })
    dispose()
  })

  it('partialize/merge：只持久化 refreshToken，其余字段保持内存值', async () => {
    type ISession = { accessToken: string; refreshToken: string }
    const storage = memoryStorage()
    const runtime = createRuntime()
    const atomStore = createAtomStore(runtime)
    const session = familyDef((): ISession => ({ accessToken: '', refreshToken: '' }))

    const def = session('s1')
    const { dispose } = persistKeyed(atomStore, def, 's1', {
      namespace: 'sessions',
      storage,
      partialize: (v) => ({ refreshToken: v.refreshToken }),
      merge: (persisted, current) => ({ ...current, ...persisted })
    })
    await new Promise((resolve) => setTimeout(resolve, 5))

    atomStore.set(def, { accessToken: 'a1', refreshToken: 'r1' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const raw = await storage.get('sessions:s1')
    const parsed = JSON.parse(raw as string) as { state: Partial<ISession> }
    expect(parsed.state).toEqual({ refreshToken: 'r1' })
    expect(parsed.state.accessToken).toBeUndefined()
    dispose()
  })

  it('dispose 后不再写回', async () => {
    const storage = memoryStorage()
    const runtime = createRuntime()
    const atomStore = createAtomStore(runtime)
    const cart = familyDef((): number => 0)
    const def = cart('c1')
    const { dispose } = persistKeyed(atomStore, def, 'c1', { namespace: 'cart', storage })
    await new Promise((resolve) => setTimeout(resolve, 5))
    dispose()
    atomStore.set(def, 5)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(await storage.get('cart:c1')).toBeNull()
  })
})

describe('clearFamily', () => {
  it('contains revoked storage proxies before reading keys', async () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    await expect(clearFamily(proxy as never, 'users')).rejects.toMatchObject({
      source: '@migaia/store-persist',
      code: 'INVALID_OPTION',
      cause: expect.any(Error)
    })
  })
  it('只删除匹配 namespace 前缀的 key，不影响其他 namespace', async () => {
    const storage = memoryStorage()
    await storage.set('users:u1', 'a')
    await storage.set('users:u2', 'b')
    await storage.set('sessions:s1', 'c')
    const removed = await clearFamily(storage, 'users')
    expect(removed).toBe(2)
    expect(await storage.get('users:u1')).toBeNull()
    expect(await storage.get('users:u2')).toBeNull()
    expect(await storage.get('sessions:s1')).toBe('c')
  })

  it('无匹配 key 时返回 0，不报错', async () => {
    const storage = memoryStorage()
    const removed = await clearFamily(storage, 'nothing-here')
    expect(removed).toBe(0)
  })

  it('不触碰内存中已实例化的 AtomStore 状态', async () => {
    const storage = memoryStorage()
    const runtime = createRuntime()
    const atomStore = createAtomStore(runtime)
    const cart = familyDef((): number => 0)
    const def = cart('c1')
    const { value, dispose } = persistKeyed(atomStore, def, 'c1', { namespace: 'cart', storage })
    atomStore.set(def, 7)
    await new Promise((resolve) => setTimeout(resolve, 10))
    await clearFamily(storage, 'cart')
    // storage 已清空，但内存里这个 handle 仍然是活的、值不受影响
    expect(atomStore.peek(def)).toBe(7)
    void value
    dispose()
  })
})
