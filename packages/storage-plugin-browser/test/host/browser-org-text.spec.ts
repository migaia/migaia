import { entityTestFeatures } from '../helpers/entity-features.js'
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { STORAGE_CONTRACT_SOURCE } from '@migaia/storage-contract'
import { walkErrorCauses } from '@migaia/utils/error'
import { localStorageBackendPlugin } from '../../src/local-storage.js'
import { sessionStorageBackendPlugin } from '../../src/session-storage.js'
import { cookieBackendPlugin } from '../../src/cookies.js'
import { lengthPrefixedNamespaceCodec } from '../../src/utils/key.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'

/** Existing isolated platform fixtures retain one native text data universe per scenario. */
const factories = [
  {
    name: 'local',
    setup: () => {
      const storage = fakeWebStorage()
      return {
        plugin: <const N extends string>(id: N, namespace: string) =>
          localStorageBackendPlugin({ id, namespace, storage })
      }
    }
  },
  {
    name: 'session',
    setup: () => {
      const storage = fakeWebStorage()
      return {
        plugin: <const N extends string>(id: N, namespace: string) =>
          sessionStorageBackendPlugin({ id, namespace, storage })
      }
    }
  },
  {
    name: 'cookie',
    setup: () => {
      const document = fakeCookieDocument()
      return {
        plugin: <const N extends string>(id: N, namespace: string) =>
          cookieBackendPlugin({ id, namespace, document })
      }
    }
  }
] as const

/** Same repository definition exercises the real native value-commit owner in each organization. */
const users = defineEntity<{ id: string; email: string }>()({
  features: entityTestFeatures,
  name: 'organization-users',
  key: 'id',
  indexes: { byEmail: { path: 'email', unique: true } },
  onDiagnostic: () => {}
})

describe('physical organizations in text browser backends', () => {
  it.each(factories)(
    '$name shares the configured default and isolates targets and plugin prefixes',
    async ({ setup }) => {
      for (const defaultOrg of ['00000000-0000-0000-0000-000000000000', createOrgId()]) {
        const { plugin } = setup()
        await using host = await createStorageHost({
          org: defaultOrg,
          plugins: [plugin('prefs', 'preferences'), plugin('cache', 'cache')]
        })
        const first = createOrgId()
        const second = createOrgId()
        const root = host.backend('prefs')
        const same = host.org(defaultOrg).backend('prefs')
        const left = host.org(first).backend('prefs')
        const right = host.org(second).backend('prefs')
        await root.set('key', 'root')
        expect(await same.get('key')).toBe('root')
        await same.set('key', 'default')
        expect(await root.get('key')).toBe('default')
        const extracted = left.set
        await Promise.all([
          right.set('key', 'right'),
          host.org(first).backend('cache').set('key', 'cache')
        ])
        await extracted('key', 'left')
        expect(await left.get('key')).toBe('left')
        expect(await right.get('key')).toBe('right')
        expect(await host.org(first).backend('cache').get('key')).toBe('cache')
        expect(host.org(first).backend('prefs')).toBe(left)
        expect('dispose' in left).toBe(false)
        await host.dropOrg(first)
        expect(await left.get('key')).toBeNull()
        expect(await host.org(first).backend('cache').get('key')).toBeNull()
        expect(await right.get('key')).toBe('right')
        expect(await root.get('key')).toBe('default')
        await host.dropOrg(first)
        await left.set('key', 'reused')
        expect(await left.get('key')).toBe('reused')
        await host.dropOrg(defaultOrg)
        expect(await same.get('key')).toBeNull()
        expect(await left.get('key')).toBe('reused')
      }
    }
  )

  it.each(factories)(
    '$name retains the original atomic unique writer in each borrowed physical organization',
    async ({ setup }) => {
      const { plugin } = setup()
      await using host = await createStorageHost({ plugins: [plugin('prefs', 'unique')] })
      const left = users.connect(host.org(createOrgId()).backend('prefs'))
      const right = users.connect(host.org(createOrgId()).backend('prefs'))
      await left.put({ id: 'a', email: 'same' })
      await right.put({ id: 'a', email: 'same' })
      await expect(left.put({ id: 'b', email: 'same' })).rejects.toMatchObject({
        code: 'INDEX_UNIQUE_CONFLICT'
      })
      expect(await right.get('a')).toEqual({ id: 'a', email: 'same' })
      expect(await left.get('b')).toBeUndefined()
    }
  )

  it('uses the configured prefix plus organization UUID', async () => {
    const storage = fakeWebStorage()
    await using host = await createStorageHost({
      plugins: [
        localStorageBackendPlugin({
          storage,
          namespace: 'preferences'
        })
      ]
    })
    const org = createOrgId()
    await host.org(org).backend('local').set('key', 'value')
    expect(storage.getItem(lengthPrefixedNamespaceCodec.encode('preferences/' + org, 'key'))).toBe(
      'value'
    )
  })

  it('rejects a reserved configured suffix before Storage or Cookie I/O and accepts bare UUID targets', async () => {
    const org = createOrgId()
    const storage = fakeWebStorage()
    const write = vi.spyOn(storage, 'setItem')
    const read = vi.spyOn(storage, 'getItem')
    const document = {
      get cookie(): string {
        throw new Error('native cookie read must not run')
      }
    }
    for (const plugin of [
      localStorageBackendPlugin({ namespace: 'preferences/' + org, storage }),
      sessionStorageBackendPlugin({ namespace: 'preferences/' + org, storage }),
      cookieBackendPlugin({ namespace: 'preferences/' + org, document })
    ]) {
      const failure = await createStorageHost({ plugins: [plugin] }).catch(
        (error: unknown) => error
      )
      expect(walkErrorCauses(failure)).toContainEqual(
        expect.objectContaining({
          source: STORAGE_CONTRACT_SOURCE,
          code: 'INVALID_ARGUMENT'
        })
      )
    }
    expect(write).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    for (const { setup } of factories) {
      const { plugin } = setup()
      await using host = await createStorageHost({ plugins: [plugin('prefs', org)] })
      await host.backend('prefs').set('key', 'bare')
      expect(await host.backend('prefs').get('key')).toBe('bare')
    }
  })
})
