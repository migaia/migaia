import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createRuntime } from '@migaia/reactive'
import { records } from '@migaia/storage-contract'
import {
  STORAGE_BROWSER_ERROR_SOURCE,
  StorageBrowserErrorCode
} from '@migaia/storage-contract/error-code'
import { createStorageHost } from '@migaia/storage-host'
import { describe, expect, it } from 'vitest'
import { BROWSER_REACTIVE_POLL_INTERVAL_MS } from '../../src/constants.ts'
import { indexedDbKeysetFeature } from '../../src/features/indexed-db-keyset.ts'
import { reactiveFeature } from '../../src/features/reactive.ts'
import { defaultReactiveProfile } from '../../src/host/reactive-profile.ts'
import { indexedDbBackendPlugin } from '../../src/plugins/indexed-db.ts'

/** Live-query consistency chosen when a backend's Feature expose states, or omits, a profile. */
describe('reactive profile selection', () => {
  it('falls back to controller push, else to polling this instance', () => {
    expect(defaultReactiveProfile(true)).toEqual({ mode: 'push', visibility: 'instance' })
    expect(defaultReactiveProfile(false)).toEqual({
      mode: 'polling',
      visibility: 'instance',
      pollIntervalMs: BROWSER_REACTIVE_POLL_INTERVAL_MS
    })
  })

  it('rejects IndexedDB live without the notifications Feature and keeps the backend usable', async () => {
    const host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin({
          name: 'idb',
          factory: new IDBFactory(),
          keyRange: IDBKeyRange,
          dbName: 'reactive-profile-no-notifications',
          features: { indexedDbKeyset: indexedDbKeysetFeature(), reactive: reactiveFeature() }
        })
      ]
    })
    try {
      const store = host.backend('idb')
      expect(() => store.use(records).query().live({ runtime: createRuntime() })).toThrow(
        expect.objectContaining({
          source: STORAGE_BROWSER_ERROR_SOURCE,
          code: StorageBrowserErrorCode.indexedDbFeatureNotInstalled
        })
      )
      await store.putRecord({ value: 'still writable' }, 'record')
      await expect(store.getRecord('record')).resolves.toEqual({ value: 'still writable' })
    } finally {
      await host.dispose()
    }
  })
})
