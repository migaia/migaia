import { defineStorageBackendKind } from './contracts.js'
import type { cookies } from '../backends/cookie.js'
import type { localStorage } from '../backends/local-storage.js'
import type { memoryStorage } from '../backends/memory.js'
import type { sessionStorage } from '../backends/session-storage.js'
import type { indexedDb } from '../backends/indexed-db.js'

/** Built-in plugin IDs stay caller-selectable while their kind tokens remain package-private. */
export type IBuiltInPluginId<TId extends string> = { readonly id?: TId }

/** Canonical store types retained by built-in kind tokens and plugin declarations. */
export type IMemoryBackendStore = ReturnType<typeof memoryStorage>
export type ILocalStorageBackendStore = ReturnType<typeof localStorage>
export type ISessionStorageBackendStore = ReturnType<typeof sessionStorage>
export type ICookieBackendStore = ReturnType<typeof cookies>
export type IIndexedDbBackendStore = ReturnType<typeof indexedDb>

/** Sole owner of the four R03 built-in kind identities; this module imports no backend code. */
export const memoryBackendKind = defineStorageBackendKind<IMemoryBackendStore>()('memory')
export const localStorageBackendKind =
  defineStorageBackendKind<ILocalStorageBackendStore>()('local-storage')
export const sessionStorageBackendKind =
  defineStorageBackendKind<ISessionStorageBackendStore>()('session-storage')
export const cookieBackendKind = defineStorageBackendKind<ICookieBackendStore>()('cookies')
export const indexedDbBackendKind = defineStorageBackendKind<IIndexedDbBackendStore>()('indexed-db')
