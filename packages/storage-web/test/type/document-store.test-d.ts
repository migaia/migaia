import { expectTypeOf } from 'vitest'
import { asRecordStore } from '../../src/types/storage'
import { memoryStorage, localStorage } from '../../src/backends'
import type { IRecordStore, IKeyValueStore } from '../../src/types/storage'

// asRecordStore 正确收窄到 IRecordStore。
declare const anyStore: IKeyValueStore
expectTypeOf(asRecordStore(anyStore)).toEqualTypeOf<IRecordStore<unknown>>()
expectTypeOf(asRecordStore<{ a: number }>(anyStore)).toEqualTypeOf<IRecordStore<{ a: number }>>()

// memoryStorage() 本身已经是 IRecordStore 形状（结构上）。
expectTypeOf(memoryStorage()).toMatchTypeOf<IRecordStore<unknown>>()

// localStorage() 只是 IKeyValueStore，不满足 IRecordStore（缺 getRecord 等方法）。
expectTypeOf(localStorage()).not.toMatchTypeOf<IRecordStore<unknown>>()
