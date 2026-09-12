import { defineBuiltInBackendKind } from './contracts.js'
import type { cookiesHost } from '../backends/cookie.js'
import type { localStorageHost } from '../backends/local-storage.js'
import type { memoryStorageHost } from '../backends/memory.js'
import type { sessionStorageHost } from '../backends/session-storage.js'
import type { indexedDbHost } from '../backends/indexed-db.js'

/** Built-in plugin IDs stay caller-selectable while their kind tokens remain package-private. */
export type IBuiltInPluginId<TId extends string> = { readonly id?: TId }

/** Canonical store types retained by built-in kind tokens and plugin declarations. */
export type IMemoryBackendStore = ReturnType<typeof memoryStorageHost>
export type ILocalStorageBackendStore = ReturnType<typeof localStorageHost>
export type ISessionStorageBackendStore = ReturnType<typeof sessionStorageHost>
export type ICookieBackendStore = ReturnType<typeof cookiesHost>
export type IIndexedDbBackendStore = ReturnType<typeof indexedDbHost>

/** Sole owner of the four R03 built-in kind identities; this module imports no backend code. */
export const memoryBackendKind = defineBuiltInBackendKind<IMemoryBackendStore>()('memory')
export const localStorageBackendKind =
  defineBuiltInBackendKind<ILocalStorageBackendStore>()('local-storage')
export const sessionStorageBackendKind =
  defineBuiltInBackendKind<ISessionStorageBackendStore>()('session-storage')
export const cookieBackendKind = defineBuiltInBackendKind<ICookieBackendStore>()('cookies')
export const indexedDbBackendKind = defineBuiltInBackendKind<IIndexedDbBackendStore>()('indexed-db')
