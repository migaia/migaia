import { expectTypeOf, it } from 'vitest'
import type { IKeyValueStore, IRecordStore, IStorageCapabilities } from '@migaia/storage-contract'
import type { IPersistStorage, IPersistByteStorage } from '../src/core/types.js'

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
