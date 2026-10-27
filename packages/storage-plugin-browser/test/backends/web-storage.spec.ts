import { createLocalTestStore, createSessionTestStore } from '../helpers/installed-backends.js'
import { STORAGE_HOST_SOURCE } from '@migaia/storage-host'
import { walkErrorCauses } from '@migaia/utils/error'
import { describe, expect, it, vi } from 'vitest'
import { STORAGE_BROWSER_SOURCE } from '../../src/index.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'

/** Installation wrappers retain the browser failure and its original native cause. */
const expectNativeInstallationFailure = async (
  pending: Promise<unknown>,
  expected: Record<string, unknown>
): Promise<unknown> => {
  /** Capture the original rejection once so native error identity can also be asserted. */
  const failure: unknown = await pending.then(
    () => undefined,
    (cause: unknown) => cause
  )
  if ((failure as { readonly source?: unknown })?.source !== STORAGE_BROWSER_SOURCE)
    expect(failure).toMatchObject({ source: STORAGE_HOST_SOURCE, code: 'BACKEND_INSTALL_FAILED' })
  expect(walkErrorCauses(failure)).toContainEqual(
    expect.objectContaining({ source: STORAGE_BROWSER_SOURCE, ...expected })
  )
  return failure
}

const unavailableStorage: Storage = {
  get length() {
    return 0
  },
  clear: () => {},
  getItem: () => null,
  key: () => null,
  removeItem: () => {},
  setItem: () => {
    throw new DOMException('quota', 'QuotaExceededError')
  }
}

describe('createWebStorageBackend', () => {
  it.each([
    {
      storageName: 'localStorage' as const,
      backend: 'local-storage',
      factory: createLocalTestStore
    },
    {
      storageName: 'sessionStorage' as const,
      backend: 'session-storage',
      factory: createSessionTestStore
    }
  ])(
    '$storageName access denied by the host keeps the original cause',
    async ({ storageName, backend, factory }) => {
      /** Browsers may deny access before a Storage object can be obtained for probing. */
      const original = new DOMException('Storage access is disabled', 'SecurityError')
      /** Exercise the real public factory's default host lookup, rather than its injected option. */
      const getter = vi.spyOn(globalThis, storageName, 'get').mockImplementation(() => {
        throw original
      })
      try {
        /** Capture the public failure once so cause identity is asserted, not just deep equality. */
        const failure = await expectNativeInstallationFailure(factory(), {
          code: 'BACKEND_UNAVAILABLE',
          backend
        })
        expect(walkErrorCauses(failure)).toContain(original)
        /** An explicit usable port must continue to bypass a denied ambient host getter. */
        const store = await factory({ storage: fakeWebStorage() })
        store.sync.set('theme', 'dark')
        expect(store.sync.get('theme')).toBe('dark')
        await store.dispose()
      } finally {
        getter.mockRestore()
      }
    }
  )

  it('构造期拒绝 null、数组和 primitive options', async () => {
    for (const options of [null, [], 'options', 1])
      await expectNativeInstallationFailure(createLocalTestStore(options as never), {
        code: 'INVALID_CONFIG'
      })
  })

  it('local/session wrapper 在解构前拒绝非法 options', async () => {
    for (const factory of [createLocalTestStore, createSessionTestStore])
      for (const options of [null, [], 'options', 1])
        await expectNativeInstallationFailure(factory(options as never), { code: 'INVALID_CONFIG' })
  })

  it('构造期拒绝非法 namespace 与 namespace codec 形状', async () => {
    await expectNativeInstallationFailure(
      createLocalTestStore({ storage: fakeWebStorage(), namespace: '' }),
      { code: 'INVALID_CONFIG' }
    )
    await expectNativeInstallationFailure(
      createLocalTestStore({ storage: fakeWebStorage(), namespace: null as unknown as string }),
      { code: 'INVALID_CONFIG' }
    )
    await expectNativeInstallationFailure(
      createLocalTestStore({ storage: fakeWebStorage(), namespaceCodec: [] as never }),
      { code: 'INVALID_CONFIG' }
    )
  })

  it('backend 与 capabilities 正确声明', async () => {
    const store = await createLocalTestStore({ storage: fakeWebStorage(), namespace: 'ns' })
    expect(store.backend).toBe('local-storage')
    expect(store.capabilities.binary).toBe(false)
    expect(store.capabilities.records).toBe(false)
    expect(store.capabilities.maxValueBytes).toBe(5 * 1024 * 1024)
  })
  it('拒绝 malformed storage 注入而不误报为 unavailable', async () => {
    await expectNativeInstallationFailure(createLocalTestStore({ storage: {} as never }), {
      code: 'INVALID_CONFIG'
    })
  })
  it('拒绝非法 storage length', async () => {
    for (const length of [NaN, Infinity, -1, 1.5]) {
      const storage = {
        ...fakeWebStorage(),
        length
      }
      await expectNativeInstallationFailure(createLocalTestStore({ storage: storage as never }), {
        code: 'INVALID_CONFIG'
      })
    }
  })

  it('不可用时始终抛 BACKEND_UNAVAILABLE', async () => {
    await expectNativeInstallationFailure(createLocalTestStore({ storage: unavailableStorage }), {
      code: 'BACKEND_UNAVAILABLE'
    })
  })
  it('探测原始异常保留在 StorageError.cause', async () => {
    const cause = new Error('security')
    const storage = fakeWebStorage()
    storage.getItem = () => {
      throw cause
    }
    const failure = await expectNativeInstallationFailure(
      createLocalTestStore({ storage: storage }),
      {
        code: 'BACKEND_UNAVAILABLE',
        cause
      }
    )
    expect(walkErrorCauses(failure)).toContain(cause)
  })
  it('运行时 get/remove/keys 异常统一归一化', async () => {
    const storage = fakeWebStorage()
    const store = await createLocalTestStore({ storage: storage })
    storage.getItem = () => {
      throw new Error('runtime get')
    }
    await expect(store.get('k')).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
    storage.getItem = () => null
    storage.removeItem = () => {
      throw new Error('runtime remove')
    }
    await expect(store.remove('k')).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
    storage.removeItem = () => {}
    Object.defineProperty(storage, 'length', {
      get: () => {
        throw new Error('runtime keys')
      }
    })
    await expect(store.keys()).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
  })

  it('clearValues 删除枚举到的物理键，不依赖 codec decode→encode 可逆', async () => {
    const storage = fakeWebStorage()
    const codec = {
      encode: (namespace: string, key: string) => `${namespace}:wire:${key.toLowerCase()}`,
      decode: (namespace: string, physicalKey: string) => {
        const prefix = `${namespace}:wire:`
        return physicalKey.startsWith(prefix)
          ? physicalKey.slice(prefix.length).toUpperCase()
          : undefined
      }
    }
    const store = await createLocalTestStore({
      storage: storage,
      namespace: 'codec-clear',
      namespaceCodec: codec
    })
    await store.set('mixed', 'value')
    await expect(store.keys()).resolves.toEqual(['MIXED'])
    await store.clearValues()
    expect(storage.getItem('codec-clear:wire:mixed')).toBeNull()
  })
  it('clearAll 中途失败报告 operation/key 且不伪报完整回滚', async () => {
    const storage = fakeWebStorage()
    const store = await createLocalTestStore({ storage: storage, namespace: 'partial-clear' })
    await store.set('first', 'one')
    await store.set('second', 'two')
    const removeItem = storage.removeItem
    storage.removeItem = (key: string): void => {
      if (key.endsWith('second')) throw new Error('hostile second removal')
      removeItem(key)
    }
    await expect(store.clearAll()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      backend: 'local-storage',
      operation: 'local.clearAll',
      key: 'second'
    })
    await expect(store.get('first')).resolves.toBeNull()
    await expect(store.get('second')).resolves.toBe('two')
  })
  it('clearAll 快照失败归属公开 operation，不泄漏裸宿主异常', async () => {
    const storage = fakeWebStorage()
    const store = await createLocalTestStore({ storage: storage, namespace: 'snapshot-failure' })
    Object.defineProperty(storage, 'length', {
      get: () => {
        throw new Error('hostile clear snapshot')
      }
    })
    await expect(store.clearAll()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      backend: 'local-storage',
      operation: 'local.clearAll',
      cause: expect.objectContaining({ message: 'hostile clear snapshot' })
    })
  })
  it('clearAll 在删除项之间观察同步重入 abort，不继续扩大 partial progress', async () => {
    const storage = fakeWebStorage()
    const controller = new AbortController()
    const reason = new Error('stop after first removal')
    const removeItem = storage.removeItem
    let armed = false
    storage.removeItem = (key: string): void => {
      removeItem(key)
      if (armed) controller.abort(reason)
    }
    const store = await createLocalTestStore({ storage: storage, namespace: 'reentrant-abort' })
    await store.set('first', 'one')
    await store.set('second', 'two')
    armed = true
    await expect(store.clearAll({ signal: controller.signal })).rejects.toMatchObject({
      code: 'ABORTED'
    })
    await expect(store.get('first')).resolves.toBeNull()
    await expect(store.get('second')).resolves.toBe('two')
  })
  it.each([
    ['重复键', (_index: number, firstKey: string) => firstKey],
    ['提前 null', (index: number, firstKey: string) => (index === 0 ? firstKey : null)],
    ['非法类型', (index: number, firstKey: string) => (index === 0 ? firstKey : 42)]
  ] as const)('clearAll 拒绝%s枚举，不把不完整快照伪报为清理成功', async (_label, keyAt) => {
    const storage = fakeWebStorage()
    const store = await createLocalTestStore({ storage: storage, namespace: 'incoherent-scan' })
    await store.set('first', 'one')
    await store.set('second', 'two')
    const firstKey = storage.key(0) as string
    storage.key = (index: number) => keyAt(index, firstKey) as string | null
    await expect(store.clearAll()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      backend: 'local-storage',
      operation: 'local.clearAll',
      cause: expect.any(TypeError)
    })
    expect(storage.length).toBe(2)
  })
  it('keys 拒绝运行期非法 length 并归一为 BACKEND_UNAVAILABLE', async () => {
    const storage = fakeWebStorage()
    const store = await createLocalTestStore({ storage: storage })
    Object.defineProperty(storage, 'length', { get: () => Infinity })
    await expect(store.keys()).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
  })
  it('拒绝运行时非字符串 key，不把它隐式编码为物理键', async () => {
    const store = await createLocalTestStore({ storage: fakeWebStorage() })
    await expect(store.set(42 as unknown as string, 'value')).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
    expect(() => store.sync!.get(42 as unknown as string)).toThrow(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    await expect(store.set('key', 42 as unknown as string)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
  })
  it('自定义 namespace codec encode/decode 异常统一归一化', async () => {
    const encodeCodec = {
      encode: () => {
        throw new Error('encode failure')
      },
      decode: () => undefined
    }
    await expectNativeInstallationFailure(
      createLocalTestStore({ storage: fakeWebStorage(), namespaceCodec: encodeCodec }),
      { code: 'EXTENSION_FAILED', cause: expect.any(Error) }
    )
    const storage = fakeWebStorage()
    const decodeCodec = {
      encode: (namespace: string, key: string) => `physical:${namespace}:${key}`,
      decode: () => {
        throw new Error('decode failure')
      }
    }
    const store = await createLocalTestStore({ storage: storage, namespaceCodec: decodeCodec })
    storage.setItem('physical:ns:key', 'value')
    await expect(store.keys()).rejects.toMatchObject({ code: 'EXTENSION_FAILED' })
  })
  it('拒绝 namespace codec 的非法输出类型', async () => {
    await expectNativeInstallationFailure(
      createLocalTestStore({
        storage: fakeWebStorage(),
        namespaceCodec: { encode: () => 42, decode: () => undefined } as never
      }),
      { code: 'EXTENSION_FAILED' }
    )
    const storage = fakeWebStorage()
    const store = await createLocalTestStore({
      storage: storage,
      namespaceCodec: {
        encode: (namespace: string, key: string) => `${namespace}:${key}`,
        decode: () => 42
      } as never
    })
    storage.setItem('default:key', 'value')
    await expect(store.keys()).rejects.toMatchObject({ code: 'EXTENSION_FAILED' })
  })
  it('storage 为 undefined 时抛 BACKEND_UNAVAILABLE', async () => {
    vi.stubGlobal('localStorage', undefined)
    try {
      await expectNativeInstallationFailure(createLocalTestStore({ storage: undefined }), {
        code: 'BACKEND_UNAVAILABLE'
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('多命名空间互相隔离', async () => {
    const shared = fakeWebStorage()
    const storeA = await createLocalTestStore({ storage: shared, namespace: 'a' })
    const storeB = await createLocalTestStore({ storage: shared, namespace: 'b' })
    await storeA.set('k', 'from-a')
    await storeB.set('k', 'from-b')
    await expect(storeA.get('k')).resolves.toBe('from-a')
    await expect(storeB.get('k')).resolves.toBe('from-b')
    await expect(storeA.keys()).resolves.toEqual(['k'])
  })
  it('setItem 抛配额异常时归一为 QUOTA_EXCEEDED', async () => {
    const throwsOnSecondWrite = (() => {
      let calls = 0
      const map = new Map<string, string>()
      return {
        get length() {
          return map.size
        },
        clear: () => map.clear(),
        getItem: (key: string) => map.get(key) ?? null,
        key: (index: number) => [...map.keys()][index] ?? null,
        removeItem: (key: string) => void map.delete(key),
        setItem: (key: string, value: string) => {
          calls += 1
          if (calls > 1) throw new DOMException('quota', 'QuotaExceededError')
          map.set(key, value)
        }
      }
    })()
    const store = await createLocalTestStore({ storage: throwsOnSecondWrite, namespace: 'q' })
    await expect(store.set('k', 'v')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
  })
})
