import { expectTypeOf, it } from 'vitest'
import type { IKeyValueStore, IRecordStore, IStorageCapabilities } from '@migaia/storage-contract'
import type { IPersistStorage, IPersistByteStorage } from '../src/core/types.js'
import { persistUnit } from '../src/index.js'
import { persist, type IPersistableStore } from '../src/light-index.js'
import { persistCollection, type IPersistableCollection } from '../src/indexed-index.js'
import type { IPersistUnit } from '../src/index.js'
import type { IRuntime } from '@migaia/reactive'

it('IPersistStorage 是最小投影：text-only adapter 无需 backend/has/clearValues/clearAll/dispose', () => {
  // 只有 capabilities + get/set/remove/keys 的结构（无 backend/has/clearValues/clearAll/dispose/getBytes/setBytes）
  // 必须能赋给 IPersistStorage。
  type ITextOnlyStore = {
    readonly capabilities: IStorageCapabilities
    get: IKeyValueStore['get']
    set: IKeyValueStore['set']
    remove: IKeyValueStore['remove']
    keys: IKeyValueStore['keys']
  }
  expectTypeOf<ITextOnlyStore>().toMatchTypeOf<IPersistStorage>()
})

it('binary adapter 带 getBytes/setBytes 时满足 IPersistByteStorage 收窄', () => {
  type IBinaryStore = {
    readonly capabilities: IStorageCapabilities
    get: IKeyValueStore['get']
    set: IKeyValueStore['set']
    remove: IKeyValueStore['remove']
    keys: IKeyValueStore['keys']
    getBytes: IRecordStore['getBytes']
    setBytes: IRecordStore['setBytes']
  }
  expectTypeOf<IBinaryStore>().toMatchTypeOf<IPersistByteStorage>()
})

it('IKeyValueStore 本身不能直接访问 getBytes/setBytes（字节通道在 IRecordStore 上）', () => {
  expectTypeOf<IKeyValueStore>().not.toHaveProperty('getBytes')
  expectTypeOf<IKeyValueStore>().not.toHaveProperty('setBytes')
})

it('infers state and synchronous migration callbacks at all attachment entries', () => {
  /** Compile-only callers must not start real subscriptions or storage work. */
  const check = (
    unit: IPersistUnit<{ count: number }>,
    store: IPersistableStore,
    collection: IPersistableCollection<number[]>,
    storage: IPersistStorage,
    runtime: IRuntime
  ): void => {
    persistUnit(unit, {
      key: 'unit',
      storage,
      runtime,
      version: 1,
      // oxlint-disable-next-line unicorn/no-thenable -- a non-callable field is ordinary synchronous data.
      migrations: { 1: () => ({ then: 1 }) }
    })
    persist(store, {
      key: 'store',
      storage,
      version: 1,
      migrations: { reset: () => ({ count: 1 }) }
    })
    persistCollection(collection, {
      key: 'collection',
      storage,
      version: 1,
      migrations: { 1: () => [1] }
    })
    persistUnit(unit, {
      key: 'unit',
      storage,
      runtime,
      version: 1,
      // @ts-expect-error known asynchronous steps cannot enter synchronous hydration.
      migrations: { 1: async () => ({ count: 1 }) }
    })
    persist(store, {
      key: 'store',
      storage,
      version: 1,
      // @ts-expect-error reset callbacks also preserve the synchronous boundary.
      migrations: { reset: async () => ({ count: 1 }) }
    })
    persistCollection(collection, {
      key: 'collection',
      storage,
      version: 1,
      /* oxlint-disable unicorn/no-thenable -- compile-only rejection of a callable then. */
      // @ts-expect-error a callable then is rejected even without a native Promise.
      migrations: { 1: () => ({ then: () => {} }) }
      /* oxlint-enable unicorn/no-thenable */
    })
  }
  expectTypeOf(check).toBeFunction()
})
