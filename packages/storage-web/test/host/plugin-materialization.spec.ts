import { memoryTestFeatures } from '../helpers/memory-features.js'
import { records } from '@migaia/storage-contract'
import {
  createStorageHost,
  defineFeature,
  memoryBackendKind,
  memoryBackendPlugin
} from '@migaia/storage-host'
import { describe, expect, it } from 'vitest'
import { cookieBackendPlugin } from '../../src/cookies.js'
import { localStorageBackendPlugin } from '../../src/local-storage.js'
import { sessionStorageBackendPlugin } from '../../src/session-storage.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'

describe('browser plugin materialization', () => {
  it('materializes five named registrations with exact identities', async () => {
    /** The original public expose reads the actual admitted store after installation. */
    let readCustomStore!: () => unknown
    const identity = defineFeature(memoryBackendKind, ({ featureExpose }) => {
      readCustomStore = () => featureExpose.getStore()
      return { capabilities: [] as const, chain: {}, api: { store: {}, transaction: {} } }
    })
    await using host = await createStorageHost({
      plugins: [
        memoryBackendPlugin({ id: 'custom' }, { ...memoryTestFeatures, identity }),
        memoryBackendPlugin({ id: 'memory' }, memoryTestFeatures),
        localStorageBackendPlugin({ id: 'local', storage: fakeWebStorage() }),
        sessionStorageBackendPlugin({ id: 'session', storage: fakeWebStorage() }),
        cookieBackendPlugin({ id: 'cookiesHost', document: fakeCookieDocument() })
      ]
    })
    expect(host.backends().size).toBe(5)
    expect(host.backend('custom')).toBe(readCustomStore())
    for (const id of ['memory', 'local', 'session', 'cookiesHost'])
      expect(host.hasBackend(id)).toBe(true)
    expect('live' in host.backend('memory').use(records).query()).toBe(false)
  })
})
