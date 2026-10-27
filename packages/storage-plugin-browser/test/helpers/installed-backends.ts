import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'
import { memoryChangeFeedFeature } from '@migaia/storage-host/features/memory-change-feed'
import { indexedDbTestFeatures } from './indexed-db-features.js'
import { onTestFinished, vi } from 'vitest'
import * as entityOwner from '@migaia/storage-host/entity'
import type { IRecordIndexBackfillStore } from '@migaia/storage-host/entity'
import { createStorageHost } from '@migaia/storage-host'
import {
  memoryBackendPlugin,
  type IMemoryBackendStore,
  type IMemoryOptions
} from '@migaia/storage-host/plugins/memory'
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
  const host = await createStorageHost({
    plugins: [indexedDbBackendPlugin(options, indexedDbTestFeatures)]
  })
  onTestFinished(() => host.dispose())
  return host.backend('indexed-db')
}

/** Cross-backend cases use the neutral host's actual memory provider and original resource owner. */
export async function createMemoryTestStore(
  options: IMemoryOptions = {}
): Promise<IMemoryBackendStore> {
  /** Preserve the real registration instead of creating a backend with fabricated runtime ports. */
  const host = await createStorageHost({
    plugins: [
      memoryBackendPlugin(options, {
        notifications: memoryNotificationsFeature(),
        changeFeed: memoryChangeFeedFeature()
      })
    ]
  })
  onTestFinished(() => host.dispose())
  return host.backend('memory')
}

/** Capture the actual private provider during the original public plugin installation. */
export async function createIndexedDbBackfillTestStore(options: IIndexedDbOptions): Promise<{
  readonly store: IIndexedDbBackendStore
  readonly capability: IRecordIndexBackfillStore<unknown>
}> {
  const register = entityOwner.registerRecordIndexBackfillStore
  let capability: IRecordIndexBackfillStore<unknown> | undefined
  const capture = vi
    .spyOn(entityOwner, 'registerRecordIndexBackfillStore')
    .mockImplementation((store, provider) => {
      register(store, provider)
      capability = provider
    })
  try {
    const store = await createIndexedDbTestStore(options)
    if (capability === undefined) throw new Error('native backfill provider was not registered')
    return { store, capability }
  } finally {
    capture.mockRestore()
  }
}
