import { walkErrorCauses } from '@migaia/utils/error'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { createStorageHost, defineFeature } from '@migaia/storage-host'
import { kv, type ITransactionScope } from '@migaia/storage-contract'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { localStorageBackendKind, localStorageBackendPlugin } from '../../src/local-storage.js'
import {
  sessionStorageBackendKind,
  sessionStorageBackendPlugin
} from '../../src/session-storage.js'
import { cookieBackendKind, cookieBackendPlugin } from '../../src/cookies.js'
import { indexedDbBackendKind, indexedDbBackendPlugin } from '../../src/indexed-db.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'

describe('browser backend installation through the neutral host', () => {
  it('retains default ids, canonical kinds and the same borrowed native clients with Features', async () => {
    /** Borrowed browser ports remain the exact clients exposed by each installed registration. */
    const local = fakeWebStorage()
    /** Session storage deliberately has an independent native value table. */
    const session = fakeWebStorage()
    /** Cookie assignment semantics belong to the borrowed document. */
    const document = fakeCookieDocument()
    /** The fake native database exercises real opener requests without claiming browser activity. */
    const factory = new IDBFactory()
    /** Each Feature reads its own registration's native client only at a real API terminal. */
    const localClient = defineFeature(localStorageBackendKind, (core) => ({
      capabilities: [],
      chain: {},
      api: { store: { client: async () => core.featureExpose.getClient() }, transaction: {} }
    }))
    /** The same Feature shape retains the session kind and client type. */
    const sessionClient = defineFeature(sessionStorageBackendKind, (core) => ({
      capabilities: [],
      chain: {},
      api: { store: { client: async () => core.featureExpose.getClient() }, transaction: {} }
    }))
    /** Cookie clients remain documents rather than a host-created replacement. */
    const cookieClient = defineFeature(cookieBackendKind, (core) => ({
      capabilities: [],
      chain: {},
      api: { store: { client: async () => core.featureExpose.getClient() }, transaction: {} }
    }))
    /** IndexedDB exposes the prepared connection belonging to this same store. */
    const databaseClient = defineFeature(indexedDbBackendKind, (core) => ({
      capabilities: [],
      chain: {},
      api: { store: { client: async () => core.featureExpose.getClient() }, transaction: {} }
    }))
    /** Inline factories must retain their defaults under the host's contextual type. */
    const host = await createStorageHost({
      plugins: [
        localStorageBackendPlugin({ storage: local }, { native: localClient }),
        sessionStorageBackendPlugin({ storage: session }, { native: sessionClient }),
        cookieBackendPlugin({ document }, { native: cookieClient }),
        indexedDbBackendPlugin(
          { factory, keyRange: IDBKeyRange, dbName: 'browser-installation' },
          { native: databaseClient }
        )
      ]
    })
    try {
      expect([...host.backends().keys()]).toEqual(['local', 'session', 'cookies', 'indexed-db'])
      expect([
        host.backend('local').backend,
        host.backend('session').backend,
        host.backend('cookies').backend,
        host.backend('indexed-db').backend
      ]).toEqual(['local-storage', 'session-storage', 'cookies', 'indexed-db'])
      expect(await host.backend('local').api.client()).toBe(local)
      expect(await host.backend('session').api.client()).toBe(session)
      expect(await host.backend('cookies').api.client()).toBe(document)
      expect((await host.backend('indexed-db').api.client()).name).toBe('browser-installation')
      expect(host.backend('local').has(kv)).toBe(true)
      for (const [api, source, code] of [
        [host.backend('local').use(kv), '@migaia/storage-web', 'INVALID_CONFIG'],
        [host.backend('session').use(kv), '@migaia/storage-web', 'INVALID_CONFIG'],
        [host.backend('cookies').use(kv), '@migaia/storage-web', 'INVALID_CONFIG'],
        [host.backend('indexed-db').use(kv), '@migaia/storage-contract', 'INVALID_ARGUMENT']
      ] as const) {
        expect('dispose' in api).toBe(false)
        expect(asyncDisposeKey in api).toBe(false)
        await expect(api.has(1 as never)).rejects.toMatchObject({
          source,
          code
        })
      }
      await host.backend('local').use(kv).set('theme', 'dark')
      expect(await host.backend('local').get('theme')).toBe('dark')
      await host.backend('indexed-db').set('draft', 'saved')
      expect(await host.backend('indexed-db').get('draft')).toBe('saved')
    } finally {
      await host.dispose()
    }
  })

  it('preserves literal custom ids and separates two stores borrowing one physical port', async () => {
    /** Sharing a native port does not merge controller lifetime or namespace identity. */
    const storage = fakeWebStorage()
    /** Both factories are inline so host context cannot widen either id. */
    const host = await createStorageHost({
      plugins: [
        localStorageBackendPlugin({ id: 'prefs', namespace: 'prefs', storage }),
        localStorageBackendPlugin({ id: 'cache', namespace: 'cache', storage })
      ]
    })
    try {
      await host.backend('prefs').set('key', 'preference')
      await host.backend('cache').set('key', 'cached')
      await host.backend('prefs').dispose()
      expect(await host.backend('cache').get('key')).toBe('cached')
      await expect(host.backend('prefs').get('key')).rejects.toMatchObject({
        source: '@migaia/storage-contract',
        code: 'STORE_DISPOSED'
      })
    } finally {
      await host.dispose()
    }
  })

  it('gives Max-Age precedence over Expires through the installed cookie store', async () => {
    /**
     * This existing fixture models attribute precedence, without claiming browser scope
     * enforcement.
     */
    const document = fakeCookieDocument()
    /** Cookie-specific operation context remains precise after host publication. */
    const host = await createStorageHost({ plugins: [cookieBackendPlugin({ document })] })
    try {
      await host.backend('cookies').set('consent', 'yes', {
        maxAge: 60,
        expires: new Date(0)
      })
      expect(await host.backend('cookies').get('consent')).toBe('yes')
      await host.backend('cookies').set('consent', 'removed', {
        maxAge: 0,
        expires: new Date(Date.now() + 60_000)
      })
      expect(await host.backend('cookies').get('consent')).toBeNull()
    } finally {
      await host.dispose()
    }
  })

  it('creates declared stores in the original database and lends only its own live native transaction', async () => {
    /** One reusable Feature declares schema separately for each actual registration. */
    const nativeFeature = defineFeature(indexedDbBackendKind, ({ featureExpose }) => {
      featureExpose.requireObjectStore('assets')
      return {
        capabilities: [],
        chain: {},
        api: {
          store: {
            client: async () => featureExpose.getClient(),
            native: async (scope: ITransactionScope) => featureExpose.getTransactionClient(scope)
          },
          transaction: {}
        }
      }
    })
    /** Independent registrations cannot authorize each other's authentic scopes. */
    const host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(
          { id: 'first', factory: new IDBFactory(), keyRange: IDBKeyRange },
          { native: nativeFeature }
        ),
        indexedDbBackendPlugin(
          { id: 'second', factory: new IDBFactory(), keyRange: IDBKeyRange },
          { native: nativeFeature }
        )
      ]
    })
    /** The retired callback view is checked again after its native transaction finishes. */
    let oldScope!: ITransactionScope
    try {
      expect((await host.backend('first').api.client()).objectStoreNames.contains('assets')).toBe(
        true
      )
      await host.backend('first').transaction(async (scope) => {
        oldScope = scope
        /** Both getters borrow the same already-open native transaction. */
        const native = await host.backend('first').api.native(scope)
        expect(await host.backend('first').api.native(scope)).toBe(native)
        expect(native.objectStoreNames.contains('assets')).toBe(true)
        await expect(host.backend('second').api.native(scope)).rejects.toMatchObject({
          source: '@migaia/storage-contract',
          code: 'INVALID_ARGUMENT'
        })
      })
      await expect(host.backend('first').api.native(oldScope)).rejects.toMatchObject({
        source: '@migaia/storage-contract',
        code: 'INVALID_ARGUMENT'
      })
    } finally {
      await host.dispose()
    }
  })

  it('rejects a Feature store collision before the native opener performs I/O', async () => {
    /** The selected Feature collides with the existing authoritative text channel. */
    const collision = defineFeature(indexedDbBackendKind, ({ featureExpose }) => {
      featureExpose.requireObjectStore('kv')
      return { capabilities: [], chain: {}, api: { store: {}, transaction: {} } }
    })
    /** The original factory records whether validation crossed the native I/O boundary. */
    const factory = new IDBFactory()
    /** Native open remains the highest observable port for this construction requirement. */
    const open = vi.spyOn(factory, 'open')
    const failure: unknown = await createStorageHost({
      plugins: [indexedDbBackendPlugin({ factory, keyRange: IDBKeyRange }, { collision })]
    }).catch((cause: unknown) => cause)
    expect(failure).toMatchObject({
      source: '@migaia/storage-host',
      code: 'BACKEND_INSTALL_FAILED'
    })
    expect(walkErrorCauses(failure)).toContainEqual(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    expect(open).not.toHaveBeenCalled()
  })
})
