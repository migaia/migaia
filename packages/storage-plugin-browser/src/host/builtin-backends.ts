import {
  type IStorageBackendType,
  type IStorageFeatureDefiner,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStorageReactiveProfileExpose
} from '@migaia/storage-host'
import { defineStorageFeature } from '@migaia/storage-host/sdk'
import type { cookiesHost } from '../backends/cookie.ts'
import type { localStorageHost } from '../backends/local-storage.ts'
import type { sessionStorageHost } from '../backends/session-storage.ts'
import type { indexedDbHost, IIndexedDbFeatureExpose } from '../backends/indexed-db.ts'

/** Options every built-in browser backend factory accepts beside its own backend options. */
export type IBuiltInPluginOptions<
  B extends IStorageBackendType,
  TId extends string,
  F extends IStorageFeatureRecord
> = {
  /** Plugin name and backend lookup key; each built-in factory supplies its documented default. */
  readonly name?: TId
  /** Features installed on this backend. */
  readonly features?: F & IStorageFeatureStoreCompatibility<B, NoInfer<F>>
}

/** Canonical store types handed over by the four built-in backend plugins. */
export type ILocalStorageBackendStore = ReturnType<typeof localStorageHost>['store']
export type ISessionStorageBackendStore = ReturnType<typeof sessionStorageHost>['store']
export type ICookieBackendStore = ReturnType<typeof cookiesHost>['store']
export type IIndexedDbBackendStore = ReturnType<typeof indexedDbHost>['store']

/** The four browser engines as types; each states its own live-query profile to Features. */
export type ILocalStorageBackend = IStorageBackendType<
  ILocalStorageBackendStore,
  ReturnType<ReturnType<typeof localStorageHost>['getClient']>,
  IStorageReactiveProfileExpose
>
export type ISessionStorageBackend = IStorageBackendType<
  ISessionStorageBackendStore,
  ReturnType<ReturnType<typeof sessionStorageHost>['getClient']>,
  IStorageReactiveProfileExpose
>
export type ICookieBackend = IStorageBackendType<
  ICookieBackendStore,
  ReturnType<ReturnType<typeof cookiesHost>['getClient']>,
  IStorageReactiveProfileExpose
>
export type IIndexedDbBackend = IStorageBackendType<
  IIndexedDbBackendStore,
  IDBDatabase,
  IIndexedDbFeatureExpose
>

/** Defines this package's IndexedDB Features; the annotation carries the IndexedDB backend type. */
export const defineIndexedDbFeature: IStorageFeatureDefiner<IIndexedDbBackend> =
  defineStorageFeature
