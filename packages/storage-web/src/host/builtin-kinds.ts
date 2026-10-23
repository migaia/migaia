import { defineStorageBackendKind, type IStorageBackendKind } from '@migaia/storage-host'
import type { cookiesHost } from '../backends/cookie.js'
import type { localStorageHost } from '../backends/local-storage.js'
import type { sessionStorageHost } from '../backends/session-storage.js'
import type { indexedDbHost, IIndexedDbFeatureExpose } from '../backends/indexed-db.js'
import { StorageBackend } from '../constants.js'

/** Built-in plugin IDs stay caller-selectable while their kind tokens remain package-private. */
export type IBuiltInPluginId<TId extends string> = {
  /** Optional bounded backend id; each built-in factory supplies its documented default. */ readonly id?: TId
}

/** Canonical store types retained by built-in kind tokens and plugin declarations. */
export type ILocalStorageBackendStore = ReturnType<typeof localStorageHost>['store']
export type ISessionStorageBackendStore = ReturnType<typeof sessionStorageHost>['store']
export type ICookieBackendStore = ReturnType<typeof cookiesHost>['store']
export type IIndexedDbBackendStore = ReturnType<typeof indexedDbHost>['store']

/** Four browser identities use the same author contract as third-party backends. */
export const localStorageBackendKind = defineStorageBackendKind<
  ILocalStorageBackendStore,
  ReturnType<ReturnType<typeof localStorageHost>['getClient']>
>()(StorageBackend.local)
export const sessionStorageBackendKind = defineStorageBackendKind<
  ISessionStorageBackendStore,
  ReturnType<ReturnType<typeof sessionStorageHost>['getClient']>
>()(StorageBackend.session)
export const cookieBackendKind = defineStorageBackendKind<
  ICookieBackendStore,
  ReturnType<ReturnType<typeof cookiesHost>['getClient']>
>()(StorageBackend.cookie)
export const indexedDbBackendKind: IStorageBackendKind<
  typeof StorageBackend.indexedDb,
  IIndexedDbBackendStore,
  IDBDatabase,
  IIndexedDbFeatureExpose
> = defineStorageBackendKind<IIndexedDbBackendStore, IDBDatabase, IIndexedDbFeatureExpose>()(
  StorageBackend.indexedDb
)
