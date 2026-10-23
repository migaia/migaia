import { onTestFinished } from 'vitest'
import {
  createStorageHost,
  memoryBackendPlugin,
  type IMemoryBackendStore,
  type IMemoryOptions
} from '@migaia/storage-host'
import {
  localStorageBackendPlugin,
  type ILocalStorageOptions,
  type ILocalStorageBackendStore
} from '../../src/local-storage.js'
import {
  sessionStorageBackendPlugin,
  type ISessionStorageOptions,
  type ISessionStorageBackendStore
} from '../../src/session-storage.js'
import {
  cookieBackendPlugin,
  type ICookiesOptions,
  type ICookieBackendStore
} from '../../src/cookies.js'
import {
  indexedDbBackendPlugin,
  type IIndexedDbOptions,
  type IIndexedDbBackendStore
} from '../../src/indexed-db.js'

/** Existing backend cases acquire the real public installation and release its original host. */
export async function createLocalTestStore(
  options: ILocalStorageOptions = {}
): Promise<ILocalStorageBackendStore> {
  /** The fixture retains the actual registration rather than manufacturing backend runtime ports. */
  const host = await createStorageHost({ plugins: [localStorageBackendPlugin(options)] })
  onTestFinished(() => host.dispose())
  return host.backend('local')
}

/** Session tests use the same public installation and disposal path as application consumers. */
export async function createSessionTestStore(
  options: ISessionStorageOptions = {}
): Promise<ISessionStorageBackendStore> {
  /** The original host owns its registered store and borrowed Storage lifetime. */
  const host = await createStorageHost({ plugins: [sessionStorageBackendPlugin(options)] })
  onTestFinished(() => host.dispose())
  return host.backend('session')
}

/** Cookie tests retain their injected document while the actual host owns backend cleanup. */
export async function createCookieTestStore(
  options: ICookiesOptions = {}
): Promise<ICookieBackendStore> {
  /** This is the real Feature/provider admission boundary, including construction rollback. */
  const host = await createStorageHost({ plugins: [cookieBackendPlugin(options)] })
  onTestFinished(() => host.dispose())
  return host.backend('cookies')
}

/** Native tests prepare the actual database through its original plugin registration. */
export async function createIndexedDbTestStore(
  options: IIndexedDbOptions = {}
): Promise<IIndexedDbBackendStore> {
  /** The fixture does not substitute a scope, transaction, controller or resource owner. */
  const host = await createStorageHost({ plugins: [indexedDbBackendPlugin(options)] })
  onTestFinished(() => host.dispose())
  return host.backend('indexed-db')
}

/** Cross-backend cases use the neutral host's actual memory provider and original resource owner. */
export async function createMemoryTestStore(
  options: IMemoryOptions = {}
): Promise<IMemoryBackendStore> {
  /** Preserve the real registration instead of creating a backend with fabricated runtime ports. */
  const host = await createStorageHost({ plugins: [memoryBackendPlugin(options)] })
  onTestFinished(() => host.dispose())
  return host.backend('memory')
}
