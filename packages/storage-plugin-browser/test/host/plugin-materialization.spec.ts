import { memoryTestFeatures } from '../helpers/memory-features.ts'
import { records } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { describe, expect, it } from 'vitest'
import { cookieBackendPlugin } from '../../src/cookies.ts'
import { localStorageBackendPlugin } from '../../src/local-storage.ts'
import { sessionStorageBackendPlugin } from '../../src/session-storage.ts'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.ts'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.ts'
import type { IMemoryBackend } from '@migaia/storage-host/plugins/memory'
import { defineStorageFeature } from '@migaia/storage-host/sdk'
import type { IStorageFeatureDefiner } from '@migaia/storage-host'

/** Feature definer typed for the imported backend. */
const defineMemoryFeature: IStorageFeatureDefiner<IMemoryBackend> = defineStorageFeature

describe('browser plugin materialization', () => {
  it('materializes five named registrations with exact identities', async () => {
    /** The original public expose reads the actual admitted store after installation. */
    let readCustomStore!: () => unknown
    const identity = defineMemoryFeature(({ featureExpose }) => {
      readCustomStore = () => featureExpose.getStore()
      return { capabilities: [] as const, chain: {}, api: { store: {}, transaction: {} } }
    })
    await using host = await createStorageHost({
      plugins: [
        memoryBackendPlugin({ name: 'custom', features: { ...memoryTestFeatures, identity } }),
        memoryBackendPlugin({ name: 'memory', features: memoryTestFeatures }),
        localStorageBackendPlugin({ name: 'local', storage: fakeWebStorage() }),
        sessionStorageBackendPlugin({ name: 'session', storage: fakeWebStorage() }),
        cookieBackendPlugin({ name: 'cookiesHost', document: fakeCookieDocument() })
      ]
    })
    expect(host.backends().size).toBe(5)
    expect(host.backend('custom')).toBe(readCustomStore())
    for (const id of ['memory', 'local', 'session', 'cookiesHost'])
      expect(host.hasBackend(id)).toBe(true)
    expect('live' in host.backend('memory').use(records).query()).toBe(false)
  })
})
