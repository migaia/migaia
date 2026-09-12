import { describe, expect, it } from 'vitest'
import { memoryStorageHost } from '@migaia/storage-web/memory'
import {
  observableMap,
  observableSet,
  observableObject,
  observableArray
} from '@migaia/store-indexed'
import { persistCollection } from '../src/indexed-index'

describe('persistCollection（store-indexed）', () => {
  it('snapshots accessor-backed options exactly once', () => {
    const map = observableMap<string, number>()
    const storage = memoryStorageHost()
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
    const handle = persistCollection(map, options)
    expect(reads).toBe(1)
    handle.dispose()
  })

  it('rejects null options with a tagged configuration error', () => {
    const map = observableMap<string, number>()
    expect(() => persistCollection(map, null as never)).toThrow(
      '[store] persist options must be an object'
    )
  })
  it('ObservableMap：写入后 flush 落盘，hydrate 命中时整体 replace 回内存', async () => {
    const storage = memoryStorageHost()
    const map = observableMap<string, number>()
    const handle = persistCollection(map, { storage, key: 'scores' })
    map.set('u1', 10)
    await handle.flush()
    handle.dispose()

    const map2 = observableMap<string, number>()
    const handle2 = persistCollection(map2, { storage, key: 'scores' })
    await handle2.ready
    expect(map2.get('u1')).toBe(10)
    handle2.dispose()
  })

  it('ObservableSet：变化触发一次防抖写回，读回后内容一致', async () => {
    const storage = memoryStorageHost()
    const set = observableSet<string>()
    const handle = persistCollection(set, { storage, key: 'tags', debounceMs: 20 })
    await handle.ready
    set.add('a')
    set.add('b')
    await handle.flush()
    handle.dispose()

    const set2 = observableSet<string>()
    const handle2 = persistCollection(set2, { storage, key: 'tags' })
    await handle2.ready
    expect([...set2.valuesArray()].sort()).toEqual(['a', 'b'])
    handle2.dispose()
  })

  it('ObservableObject：hydrate 未命中时不改动初始值', async () => {
    const storage = memoryStorageHost()
    const obj = observableObject({ theme: 'light' })
    const handle = persistCollection(obj, { storage, key: 'obj-missing' })
    await handle.ready
    expect(obj.snapshot()).toEqual({ theme: 'light' })
    handle.dispose()
  })

  it('ObservableArray：写入并读回', async () => {
    const storage = memoryStorageHost()
    const arr = observableArray<number>([1, 2, 3])
    const handle = persistCollection(arr, { storage, key: 'arr' })
    arr.push(4)
    await handle.flush()
    handle.dispose()

    const arr2 = observableArray<number>()
    const handle2 = persistCollection(arr2, { storage, key: 'arr' })
    await handle2.ready
    expect(arr2.snapshot()).toEqual([1, 2, 3, 4])
    handle2.dispose()
  })

  it('dispose 后不再响应集合变化', async () => {
    const storage = memoryStorageHost()
    const set = observableSet<string>()
    const handle = persistCollection(set, { storage, key: 'after-dispose' })
    await handle.ready
    handle.dispose()
    set.add('x')
    // 没有防抖等待也没有报错——subscribe 已经被 dispose() 断开，不会尝试写入已终止的 handle。
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(await storage.get('after-dispose')).toBeNull()
  })
})
