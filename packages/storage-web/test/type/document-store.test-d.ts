import { expectTypeOf } from 'vitest'
import { asRecordStore } from '../../src/types/storage'
import type { IMemoryBackendStore } from '@migaia/storage-host'
import type { ILocalStorageBackendStore } from '../../src/local-storage.js'
import type { IRecordStore, IKeyValueStore } from '../../src/types/storage'

// asRecordStore 正确收窄到 IRecordStore。
declare const anyStore: IKeyValueStore
expectTypeOf(asRecordStore(anyStore)).toEqualTypeOf<IRecordStore<unknown>>()
expectTypeOf(asRecordStore<{ a: number }>(anyStore)).toEqualTypeOf<IRecordStore<{ a: number }>>()

// The real installed host memory store retains native record methods.
expectTypeOf<IMemoryBackendStore>().toMatchTypeOf<IRecordStore<unknown>>()

// The installed local storage plugin does not manufacture native record methods.
expectTypeOf<ILocalStorageBackendStore>().not.toMatchTypeOf<IRecordStore<unknown>>()
