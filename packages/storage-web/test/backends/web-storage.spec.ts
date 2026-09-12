import { describe, expect, it } from 'vitest'
import { createWebStorageBackend } from '../../src/backends/web-storage'
import { localStorageHost } from '../../src/backends/local-storage'
import { sessionStorageHost } from '../../src/backends/session-storage'
import { fakeWebStorage } from '../../src/testing/fake-web-storage'

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
  it('构造期拒绝 null、数组和 primitive options', () => {
    for (const options of [null, [], 'options', 1])
      expect(() =>
        createWebStorageBackend('local', fakeWebStorage(), options as never)
      ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })

  it('local/session wrapper 在解构前拒绝非法 options', () => {
    for (const factory of [localStorageHost, sessionStorageHost])
      for (const options of [null, [], 'options', 1])
        expect(() => factory(options as never)).toThrowError(
          expect.objectContaining({ code: 'INVALID_CONFIG' })
        )
  })

  it('local/session wrapper 归一化 storage getter 异常', () => {
    for (const factory of [localStorageHost, sessionStorageHost])
      expect(() =>
        factory({
          get storage(): ReturnType<typeof fakeWebStorage> {
            throw new Error('hostile storage getter')
          }
        })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })

  it('local/session wrapper 对三个构造字段各读取一次', () => {
    for (const factory of [localStorageHost, sessionStorageHost]) {
      let reads = 0
      const store = factory({
        get namespace() {
          reads += 1
          return 'getter-options'
        },
        get namespaceCodec() {
          reads += 1
          return undefined
        },
        get storage() {
          reads += 1
          return fakeWebStorage()
        }
      })
      expect(store.sync.get('missing')).toBeNull()
      expect(reads).toBe(3)
    }
  })

  it('namespace getter 异常统一返回 INVALID_CONFIG', () => {
    expect(() =>
      localStorageHost({
        get namespace(): string {
          throw new Error('hostile namespace')
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })

  it('namespace codec 描述符只读取一次并固定后续行为', async () => {
    let reads = 0
    const codec = {
      get encode() {
        reads += 1
        return (namespace: string, key: string) => `${namespace}:${key}`
      },
      get decode() {
        reads += 1
        return (namespace: string, physicalKey: string) =>
          physicalKey.startsWith(`${namespace}:`)
            ? physicalKey.slice(namespace.length + 1)
            : undefined
      }
    }
    const store = createWebStorageBackend('local', fakeWebStorage(), {
      namespace: 'codec-snapshot',
      namespaceCodec: codec
    })
    await store.set('key', 'value')
    await expect(store.get('key')).resolves.toBe('value')
    expect(reads).toBe(2)
  })

  it('namespace codec getter 异常统一返回 INVALID_CONFIG', () => {
    expect(() =>
      createWebStorageBackend('local', fakeWebStorage(), {
        namespaceCodec: {
          get encode(): never {
            throw new Error('hostile codec getter')
          },
          decode: () => undefined
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG', backend: 'local' }))
  })

  it('构造期拒绝非法 namespace 与 namespace codec 形状', () => {
    expect(() =>
      createWebStorageBackend('local', fakeWebStorage(), { namespace: '' })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
    expect(() =>
      createWebStorageBackend('local', fakeWebStorage(), {
        namespace: null as unknown as string
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
    expect(() =>
      createWebStorageBackend('local', fakeWebStorage(), {
        namespaceCodec: [] as never
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
  })

  it('backend 与 capabilities 正确声明', () => {
    const store = createWebStorageBackend('local', fakeWebStorage(), { namespace: 'ns' })
    expect(store.backend).toBe('local')
    expect(store.capabilities.binary).toBe(false)
    expect(store.capabilities.records).toBe(false)
    expect(store.capabilities.maxValueBytes).toBe(5 * 1024 * 1024)
  })
  it('拒绝 malformed storage 注入而不误报为 unavailable', () => {
    expect(() => createWebStorageBackend('local', {} as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
  })
  it('拒绝非法 storage length', () => {
    for (const length of [NaN, Infinity, -1, 1.5]) {
      const storage = {
        ...fakeWebStorage(),
        length
      }
      expect(() => createWebStorageBackend('local', storage as never)).toThrowError(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
    }
  })
  it('构造校验只读取 storage length 一次', () => {
    const storage = fakeWebStorage()
    let reads = 0
    Object.defineProperty(storage, 'length', {
      get: () => {
        reads += 1
        if (reads > 1) throw new Error('length read twice during construction')
        return 0
      }
    })
    const store = createWebStorageBackend('local', storage)
    expect(store.sync!.get('missing')).toBeNull()
    expect(reads).toBe(1)
  })
  it('storage surface getter 异常统一返回 INVALID_CONFIG', () => {
    const storage = fakeWebStorage()
    Object.defineProperty(storage, 'getItem', {
      get: () => {
        throw new Error('hostile storage method getter')
      }
    })
    expect(() => createWebStorageBackend('local', storage)).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
  })
  it('不可用时始终抛 BACKEND_UNAVAILABLE', () => {
    expect(() => createWebStorageBackend('local', unavailableStorage)).toThrow(
      expect.objectContaining({ code: 'BACKEND_UNAVAILABLE' })
    )
  })
  it('探测原始异常保留在 StorageError.cause', () => {
    const cause = new Error('security')
    const storage = fakeWebStorage()
    storage.getItem = () => {
      throw cause
    }
    expect(() => createWebStorageBackend('local', storage)).toThrow(
      expect.objectContaining({ code: 'BACKEND_UNAVAILABLE', cause })
    )
  })
  it('运行时 get/remove/keys 异常统一归一化', async () => {
    const storage = fakeWebStorage()
    const store = createWebStorageBackend('local', storage)
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
  it('keys 对运行期 length 只读取一次，扫描边界不会漂移', async () => {
    const storage = fakeWebStorage()
    const store = createWebStorageBackend('local', storage, { namespace: 'bounded-keys' })
    await store.set('key', 'value')
    let reads = 0
    Object.defineProperty(storage, 'length', {
      get: () => {
        reads += 1
        if (reads > 1) throw new Error('runtime length read twice')
        return 1
      }
    })
    await expect(store.keys()).resolves.toEqual(['key'])
    expect(reads).toBe(1)
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
    const store = createWebStorageBackend('local', storage, {
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
    const store = createWebStorageBackend('local', storage, { namespace: 'partial-clear' })
    await store.set('first', 'one')
    await store.set('second', 'two')
    const removeItem = storage.removeItem
    storage.removeItem = (key: string): void => {
      if (key.endsWith('second')) throw new Error('hostile second removal')
      removeItem(key)
    }
    await expect(store.clearAll()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      backend: 'local',
      operation: 'local.clearAll',
      key: 'second'
    })
    await expect(store.get('first')).resolves.toBeNull()
    await expect(store.get('second')).resolves.toBe('two')
  })
  it('clearAll 快照失败归属公开 operation，不泄漏裸宿主异常', async () => {
    const storage = fakeWebStorage()
    const store = createWebStorageBackend('local', storage, { namespace: 'snapshot-failure' })
    Object.defineProperty(storage, 'length', {
      get: () => {
        throw new Error('hostile clear snapshot')
      }
    })
    await expect(store.clearAll()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      backend: 'local',
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
    const store = createWebStorageBackend('local', storage, { namespace: 'reentrant-abort' })
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
    const store = createWebStorageBackend('local', storage, { namespace: 'incoherent-scan' })
    await store.set('first', 'one')
    await store.set('second', 'two')
    const firstKey = storage.key(0) as string
    storage.key = (index: number) => keyAt(index, firstKey) as string | null
    await expect(store.clearAll()).rejects.toMatchObject({
      code: 'BACKEND_UNAVAILABLE',
      backend: 'local',
      operation: 'local.clearAll',
      cause: expect.any(TypeError)
    })
    expect(storage.length).toBe(2)
  })
  it('keys 拒绝运行期非法 length 并归一为 BACKEND_UNAVAILABLE', async () => {
    const storage = fakeWebStorage()
    const store = createWebStorageBackend('local', storage)
    Object.defineProperty(storage, 'length', { get: () => Infinity })
    await expect(store.keys()).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
  })
  it('拒绝运行时非字符串 key，不把它隐式编码为物理键', async () => {
    const store = createWebStorageBackend('local', fakeWebStorage())
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
    expect(() =>
      createWebStorageBackend('local', fakeWebStorage(), { namespaceCodec: encodeCodec })
    ).toThrow(expect.objectContaining({ code: 'EXTENSION_FAILED', cause: expect.any(Error) }))
    const storage = fakeWebStorage()
    const decodeCodec = {
      encode: (namespace: string, key: string) => `physical:${namespace}:${key}`,
      decode: () => {
        throw new Error('decode failure')
      }
    }
    const store = createWebStorageBackend('local', storage, { namespaceCodec: decodeCodec })
    storage.setItem('physical:ns:key', 'value')
    await expect(store.keys()).rejects.toMatchObject({ code: 'EXTENSION_FAILED' })
  })
  it('拒绝 namespace codec 的非法输出类型', async () => {
    expect(() =>
      createWebStorageBackend('local', fakeWebStorage(), {
        namespaceCodec: { encode: () => 42, decode: () => undefined } as never
      })
    ).toThrowError(expect.objectContaining({ code: 'EXTENSION_FAILED' }))
    const storage = fakeWebStorage()
    const store = createWebStorageBackend('local', storage, {
      namespaceCodec: {
        encode: (namespace: string, key: string) => `${namespace}:${key}`,
        decode: () => 42
      } as never
    })
    storage.setItem('default:key', 'value')
    await expect(store.keys()).rejects.toMatchObject({ code: 'EXTENSION_FAILED' })
  })
  it('storage 为 undefined 时抛 BACKEND_UNAVAILABLE', () => {
    expect(() => createWebStorageBackend('local', undefined)).toThrow(
      expect.objectContaining({ code: 'BACKEND_UNAVAILABLE' })
    )
  })
  it('多命名空间互相隔离', async () => {
    const shared = fakeWebStorage()
    const storeA = createWebStorageBackend('local', shared, { namespace: 'a' })
    const storeB = createWebStorageBackend('local', shared, { namespace: 'b' })
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
    const store = createWebStorageBackend('local', throwsOnSecondWrite, { namespace: 'q' })
    await expect(store.set('k', 'v')).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' })
  })
})
