import { expectTypeOf } from 'vitest'
import type { IMemoryBackendStore } from '@migaia/storage-host'
import type { ILocalStorageBackendStore } from '../../src/local-storage.js'
import type { ISessionStorageBackendStore } from '../../src/session-storage.js'
import type { ICookieBackendStore } from '../../src/cookies.js'
import type { IIndexedDbBackendStore } from '../../src/indexed-db.js'
import type { ISyncKeyValueStore, ISyncCookieStore } from '../../src/types'
import { kv, records } from '@migaia/storage-contract'

// Public plugin store types retain their native synchronous projection after installation.
expectTypeOf<ILocalStorageBackendStore['sync']>().toEqualTypeOf<ISyncKeyValueStore>()
expectTypeOf<ISessionStorageBackendStore['sync']>().toEqualTypeOf<ISyncKeyValueStore>()
expectTypeOf<IMemoryBackendStore['sync']>().toEqualTypeOf<ISyncKeyValueStore>()
expectTypeOf<ICookieBackendStore['sync']>().toEqualTypeOf<ISyncCookieStore>()

// IndexedDB's existing optional type does not imply a synchronous native implementation.
expectTypeOf<IIndexedDbBackendStore['sync']>().toEqualTypeOf<ISyncKeyValueStore | undefined>()

/** Actual text scopes retain their finite family instead of inventing bytes or record methods. */
async function textRedoScope(store: ILocalStorageBackendStore) {
  await store.transaction(async (scope) => {
    await scope.use(kv).set('key', 'value')
    // @ts-expect-error A text-only scope has no records capability.
    scope.use(records)
    // @ts-expect-error A text-only scope does not fabricate bytes.
    scope.setBytes('key', new Uint8Array())
  })
}
void textRedoScope

/** The cookie native option does not widen its authenticated text-only transaction scope. */
async function cookieRedoScope(store: ICookieBackendStore) {
  await store.transaction(async (scope) => {
    await scope.use(kv).set('key', 'visible')
    // @ts-expect-error Cookie transactions have no records family.
    scope.use(records)
  })
}
void cookieRedoScope
