import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'
import { memoryChangeFeedFeature } from '@migaia/storage-host/features/memory-change-feed'
import { indexedDbTestFeatures } from './indexed-db-features.ts'
import { onTestFinished, vi } from 'vitest'
import * as entityOwner from '@migaia/storage-host/entity'
import type { IRecordIndexBackfillStore } from '@migaia/storage-host/entity'
import { createStorageHost, type IStorageHost } from '@migaia/storage-host'
import {
  memoryBackendPlugin,
  type IMemoryBackendStore,
  type IMemoryOptions
} from '@migaia/storage-host/plugins/memory'
import {
  localStorageBackendPlugin,
  type ILocalStorageOptions,
  type ILocalStorageBackendStore
} from '../../src/local-storage.ts'
import {
  sessionStorageBackendPlugin,
  type ISessionStorageOptions,
  type ISessionStorageBackendStore
} from '../../src/session-storage.ts'
import {
  cookieBackendPlugin,
  type ICookiesOptions,
  type ICookieBackendStore
} from '../../src/cookies.ts'
import {
  indexedDbBackendPlugin,
  type IIndexedDbOptions,
  type IIndexedDbBackendStore
} from '../../src/indexed-db.ts'

/** Existing backend cases acquire the real public installation and release its original host. */
export function createLocalTestStore(
  options: ILocalStorageOptions,
  withHost: true
): Promise<{
  readonly host: IStorageHost<readonly [ReturnType<typeof localStorageBackendPlugin<'local', {}>>]>
  readonly store: ILocalStorageBackendStore
}>
export function createLocalTestStore(
  options?: ILocalStorageOptions
): Promise<ILocalStorageBackendStore>
export async function createLocalTestStore(options: ILocalStorageOptions = {}, withHost = false) {
  /** The fixture retains the actual registration rather than manufacturing backend runtime ports. */
  const host = await createStorageHost({ plugins: [localStorageBackendPlugin(options)] })
  onTestFinished(() => host.dispose())
  /** Entity consumers may retain this actual host for explicit plugin installation. */
  const store = host.backend('local')
  return withHost ? { host, store } : store
}

/** Session tests use the same public installation and disposal path as application consumers. */
export function createSessionTestStore(
  options: ISessionStorageOptions,
  withHost: true
): Promise<{
  readonly host: IStorageHost<
    readonly [ReturnType<typeof sessionStorageBackendPlugin<'session', {}>>]
  >
  readonly store: ISessionStorageBackendStore
}>
export function createSessionTestStore(
  options?: ISessionStorageOptions
): Promise<ISessionStorageBackendStore>
export async function createSessionTestStore(
  options: ISessionStorageOptions = {},
  withHost = false
) {
  /** The original host owns its registered store and borrowed Storage lifetime. */
  const host = await createStorageHost({ plugins: [sessionStorageBackendPlugin(options)] })
  onTestFinished(() => host.dispose())
  /** Entity consumers may retain this actual host for explicit plugin installation. */
  const store = host.backend('session')
  return withHost ? { host, store } : store
}

/** Cookie tests retain their injected document while the actual host owns backend cleanup. */
export function createCookieTestStore(
  options: ICookiesOptions,
  withHost: true
): Promise<{
  readonly host: IStorageHost<readonly [ReturnType<typeof cookieBackendPlugin<'cookies', {}>>]>
  readonly store: ICookieBackendStore
}>
export function createCookieTestStore(options?: ICookiesOptions): Promise<ICookieBackendStore>
export async function createCookieTestStore(options: ICookiesOptions = {}, withHost = false) {
  /** This is the real Feature/provider admission boundary, including construction rollback. */
  const host = await createStorageHost({ plugins: [cookieBackendPlugin(options)] })
  onTestFinished(() => host.dispose())
  /** Entity consumers may retain this actual host for explicit plugin installation. */
  const store = host.backend('cookies')
  return withHost ? { host, store } : store
}

/** The public host tuple retains the exact roots selected by the real IndexedDB installation. */
type IIndexedDbFixtureHost = IStorageHost<
  readonly [ReturnType<typeof indexedDbBackendPlugin<'indexed-db', typeof indexedDbTestFeatures>>]
>
/** Name the selected backend through its actual host so private capability brands remain opaque. */
type IIndexedDbFixture = Readonly<{
  host: IIndexedDbFixtureHost
  store: ReturnType<IIndexedDbFixtureHost['backend']>
}>

/** Own actual native installation and cleanup; the tuple retains every selected Feature. */
async function createIndexedDbFixture(options: IIndexedDbOptions): Promise<IIndexedDbFixture> {
  /** The fixture does not substitute a scope, transaction, controller or resource owner. */
  const host = await createStorageHost({
    plugins: [indexedDbBackendPlugin(options, indexedDbTestFeatures)]
  })
  onTestFinished(() => host.dispose())
  /** Preserve the exact installed backend while exposing its actual host to entity consumers. */
  const store = host.backend('indexed-db')
  return { host, store }
}

/** Native tests may keep this actual host or retain their original store-only fixture contract. */
export function createIndexedDbTestStore(
  options: IIndexedDbOptions,
  withHost: true
): ReturnType<typeof createIndexedDbFixture>
export function createIndexedDbTestStore(
  options?: IIndexedDbOptions
): Promise<IIndexedDbBackendStore>
export async function createIndexedDbTestStore(
  options: IIndexedDbOptions = {},
  withHost = false
): Promise<IIndexedDbBackendStore | Awaited<ReturnType<typeof createIndexedDbFixture>>> {
  /** The same fixture owns installation once; this boundary selects the requested public view. */
  const fixture = await createIndexedDbFixture(options)
  return withHost ? fixture : fixture.store
}

/** Own the native memory registration with its genuine notification Feature tuple and cleanup. */
async function createMemoryFixture(options: IMemoryOptions) {
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
  /** Entity consumers borrow this exact backend without losing selected capability types. */
  const store = host.backend('memory')
  return { host, store }
}

/** Memory callers may retain the installation host without changing existing store-only callers. */
export function createMemoryTestStore(
  options: IMemoryOptions,
  withHost: true
): ReturnType<typeof createMemoryFixture>
export function createMemoryTestStore(options?: IMemoryOptions): Promise<IMemoryBackendStore>
export async function createMemoryTestStore(
  options: IMemoryOptions = {},
  withHost = false
): Promise<IMemoryBackendStore | Awaited<ReturnType<typeof createMemoryFixture>>> {
  /** The fixture tuple remains inferred from its actual installation and backend selection. */
  const fixture = await createMemoryFixture(options)
  return withHost ? fixture : fixture.store
}

/** Capture the actual private provider during the original public plugin installation. */
export async function createIndexedDbBackfillTestStore(options: IIndexedDbOptions): Promise<
  Awaited<ReturnType<typeof createIndexedDbFixture>> & {
    readonly capability: IRecordIndexBackfillStore<unknown>
  }
> {
  const register = entityOwner.registerRecordIndexBackfillStore
  let capability: IRecordIndexBackfillStore<unknown> | undefined
  const capture = vi
    .spyOn(entityOwner, 'registerRecordIndexBackfillStore')
    .mockImplementation((store, provider) => {
      register(store, provider)
      capability = provider
    })
  try {
    const { host, store } = await createIndexedDbTestStore(options, true)
    if (capability === undefined) throw new Error('native backfill provider was not registered')
    return { host, store, capability }
  } finally {
    capture.mockRestore()
  }
}
