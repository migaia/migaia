import { expectTypeOf } from 'vitest'
import type { IMemoryBackendStore } from '@migaia/storage-host'
import type { ILocalStorageBackendStore } from '../../src/local-storage.js'
import type { ISessionStorageBackendStore } from '../../src/session-storage.js'
import type { ICookieBackendStore } from '../../src/cookies.js'
import type { IIndexedDbBackendStore } from '../../src/indexed-db.js'
import type { ISyncKeyValueStore, ISyncCookieStore } from '../../src/types'

// Public plugin store types retain their native synchronous projection after installation.
expectTypeOf<ILocalStorageBackendStore['sync']>().toEqualTypeOf<ISyncKeyValueStore>()
expectTypeOf<ISessionStorageBackendStore['sync']>().toEqualTypeOf<ISyncKeyValueStore>()
expectTypeOf<IMemoryBackendStore['sync']>().toEqualTypeOf<ISyncKeyValueStore>()
expectTypeOf<ICookieBackendStore['sync']>().toEqualTypeOf<ISyncCookieStore>()

// IndexedDB's existing optional type does not imply a synchronous native implementation.
expectTypeOf<IIndexedDbBackendStore['sync']>().toEqualTypeOf<ISyncKeyValueStore | undefined>()
