/**
 * Round-1 hardening regressions (H1–H10 in docs/storage-web/hardening.sdd.md). Most of these
 * invariants now also have dedicated coverage under test/conformance/; this file stays as the
 * permanent record of the original adversarial findings and is kept in the default test run.
 */
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { indexedDbHost, localStorageHost, memoryStorageHost } from '../src/backends'
import { defineEntity } from '../src/entity'
import { fakeWebStorage } from '../src/testing/fake-web-storage'
import type { IRecordStore } from '../src/types'

const freshIdb = (): IRecordStore =>
  indexedDbHost({
    factory: new IDBFactory(),
    keyRange: IDBKeyRange,
    dbName: `adv-${Math.random().toString(36).slice(2)}`
  })

describe('#1 clearAll() 清理全部 record 通道', () => {
  it('memory: clearAll() 连 records 一起清', async () => {
    const store = memoryStorageHost()
    await store.putRecord({ v: 1 }, 'doc')
    await store.clearAll()
    expect(await store.getRecord('doc')).toBeUndefined()
  })

  it('indexedDbHost: clearAll() 连 records 一起清', async () => {
    const store = freshIdb()
    await store.putRecord({ v: 1 }, 'doc')
    await store.clearAll()
    expect(await store.getRecord('doc')).toBeUndefined()
  })
})

describe('#2 getBytes/setBytes 与 get/set 通道隔离且跨通道不可静默覆盖', () => {
  it('memory: bytes 与 kv 互不可见', async () => {
    const store = memoryStorageHost()
    await store.setBytes('k', new Uint8Array([1, 2]))
    expect(await store.has('k')).toBe(false)
    expect(await store.keys()).toEqual([])
  })

  it('indexedDbHost: bytes 键不泄漏进 keys()/has()', async () => {
    const store = freshIdb()
    await store.setBytes('k', new Uint8Array([1, 2]))
    expect(await store.has('k')).toBe(false)
    expect(await store.keys()).toEqual([])

    await expect(store.set('k', 'text')).rejects.toMatchObject({ code: 'DUPLICATE_KEY' })
    await expect(store.getBytes('k')).resolves.toEqual(new Uint8Array([1, 2]))
  })
})

describe('#3 dispose 后 L1 方法统一抛 STORE_DISPOSED', () => {
  it('memory: getRecord/getBytes 抛 STORE_DISPOSED', async () => {
    const store = memoryStorageHost()
    await store.putRecord({ v: 1 }, 'doc')
    await store.dispose()
    await expect(store.getRecord('doc')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(store.getBytes('doc')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
  })

  it('indexedDbHost: getRecord 抛 STORE_DISPOSED', async () => {
    const store = freshIdb()
    await store.dispose()
    await expect(store.getRecord('doc')).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
  })
})

describe('#4 memory 存活引用，indexedDbHost 结构化克隆', () => {
  it('memory: 写入后修改原对象不污染已存数据', async () => {
    const store = memoryStorageHost()
    const value = { n: 1 }
    await store.putRecord(value, 'k')
    value.n = 999
    expect(await store.getRecord('k')).toEqual({ n: 1 })
  })

  it('indexedDbHost: 同样操作不受影响', async () => {
    const store = freshIdb()
    const value = { n: 1 }
    await store.putRecord(value, 'k')
    value.n = 999
    expect(await store.getRecord('k')).toEqual({ n: 1 })
  })
})

describe('#5 iterate 顺序：memory 与 indexedDbHost 都是键序', () => {
  const insert = async (store: IRecordStore): Promise<string[]> => {
    await store.putRecord({}, 'c')
    await store.putRecord({}, 'a')
    await store.putRecord({}, 'b')
    const keys: string[] = []
    for await (const [key] of store.iterateRecords()) keys.push(key as string)
    return keys
  }

  it('memory', async () => {
    expect(await insert(memoryStorageHost())).toEqual(['a', 'b', 'c'])
  })

  it('indexedDbHost', async () => {
    expect(await insert(freshIdb())).toEqual(['a', 'b', 'c'])
  })
})

describe('#6 命名空间前缀是可穿透的', () => {
  it("namespace 'app' 能看见并清掉 namespace 'app:cache' 的数据", async () => {
    const shared = fakeWebStorage()
    const app = localStorageHost({ namespace: 'app', storage: shared })
    const cache = localStorageHost({ namespace: 'app:cache', storage: shared })

    await cache.set('token', 'secret')
    expect(await app.keys()).toEqual([])

    await app.clearAll()
    expect(await cache.get('token')).toBe('secret')
  })
})

describe('#7 数组主键：get/list 可见性一致', () => {
  it('list() 包含数组 id 的记录', async () => {
    const store = freshIdb()
    type IRow = { readonly id: readonly string[]; readonly n: number }
    const repo = defineEntity<IRow>({ name: 'rows', key: 'id' }).connect(store)

    await repo.put({ id: ['tenant-1', 'u1'], n: 1 })
    expect(await repo.get(['tenant-1', 'u1'])).toEqual({ id: ['tenant-1', 'u1'], n: 1 })
    expect(await repo.list()).toEqual([{ id: ['tenant-1', 'u1'], n: 1 }])
  })
})

describe('#8 单条脏数据不阻断 list()', () => {
  it('一条校验失败的记录被跳过并保留好记录', async () => {
    const store = memoryStorageHost()
    type IRow = { readonly id: string; readonly n: number }
    const schema = {
      name: 'strict',
      validate: async (value: unknown): Promise<IRow> => {
        const row = value as IRow
        if (typeof row.n !== 'number') throw new Error('n must be number')
        return row
      }
    }
    const repo = defineEntity<IRow>({ name: 'rows', key: 'id', schema }).connect(store)

    await store.putRecord({ __v: 1, data: { id: 'good', n: 1 } }, ['rows', 'good'])
    await store.putRecord({ __v: 1, data: { id: 'bad', n: 'oops' } }, ['rows', 'bad'])

    await expect(repo.list()).resolves.toEqual([{ id: 'good', n: 1 }])
  })
})

describe('#9 memory.iterate 尊重 timeoutMs', () => {
  it('零超时不会产出记录', async () => {
    const store = memoryStorageHost()
    await store.putRecord({ v: 1 }, 'k')
    await expect(store.iterateRecords(undefined, { timeoutMs: 0 }).next()).rejects.toMatchObject({
      code: 'ABORTED'
    })
  })
})

describe('#10 飞行中 abort 的错误类型不是 StorageError', () => {
  it('indexedDbHost.get 在请求发出后 abort，拒绝值没有 code', async () => {
    const store = freshIdb()
    await store.set('k', 'v')
    const controller = new AbortController()
    const pending = store.get('k', { signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })
})
