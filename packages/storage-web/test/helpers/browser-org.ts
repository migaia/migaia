import { entityTestFeatures } from './entity-features.js'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { localStorageBackendPlugin } from '../../src/local-storage.js'
import { sessionStorageBackendPlugin } from '../../src/session-storage.js'
import { cookieBackendPlugin } from '../../src/cookies.js'
import { lengthPrefixedNamespaceCodec } from '../../src/utils/key.js'

/**
 * Real browser ports prove default mapping, child isolation, drop and native unique write
 * ownership.
 */
export async function runBrowserTextOrgScenario() {
  /** Every scenario owns only a fresh configured namespace in this browser context. */
  const prefix = 'browser-org-' + createOrgId()
  /** Accumulate only actual completed cases and comparisons, never assumed native support. */
  const result = {
    combinations: 0,
    defaultShared: true,
    isolated: true,
    dropIsolated: true,
    physicalPrefix: true,
    uniqueConflicts: 0
  }
  /** The same public entity definition exercises each original value-commit implementation. */
  const users = defineEntity<{ id: string; email: string }>()({
    features: entityTestFeatures,
    name: 'browser-org-users',
    key: 'id',
    indexes: { byEmail: { path: 'email', unique: true } },
    onDiagnostic: () => {}
  })
  /** Native client selection changes only the backend plugin; no test Storage substitutes exist. */
  const plugins = [
    {
      name: 'local',
      create: <const N extends string>(id: N, namespace: string) =>
        localStorageBackendPlugin({ id, namespace })
    },
    {
      name: 'session',
      create: <const N extends string>(id: N, namespace: string) =>
        sessionStorageBackendPlugin({ id, namespace })
    },
    {
      name: 'cookie',
      create: <const N extends string>(id: N, namespace: string) =>
        cookieBackendPlugin({ id, namespace })
    }
  ] as const
  for (const selected of plugins) {
    for (const defaultOrg of ['00000000-0000-0000-0000-000000000000', createOrgId()]) {
      /** Separate configured targets preserve other plugins even for the same organization. */
      const namespace = prefix + '-' + selected.name + '-' + defaultOrg
      const host = await createStorageHost({
        org: defaultOrg,
        plugins: [
          selected.create('prefs', namespace),
          selected.create('cache', namespace + '-cache')
        ]
      })
      try {
        const first = createOrgId()
        const second = createOrgId()
        const root = host.backend('prefs')
        const same = host.org(defaultOrg).backend('prefs')
        const left = host.org(first).backend('prefs')
        const right = host.org(second).backend('prefs')
        const cache = host.org(first).backend('cache')
        await root.set('key', 'root')
        result.defaultShared &&= (await same.get('key')) === 'root'
        await same.set('key', 'default')
        result.defaultShared &&= (await root.get('key')) === 'default'
        await left.set('key', 'left')
        await right.set('key', 'right')
        await cache.set('key', 'cache')
        result.isolated &&=
          (await left.get('key')) === 'left' &&
          (await right.get('key')) === 'right' &&
          (await cache.get('key')) === 'cache'
        if (selected.name === 'local')
          result.physicalPrefix &&=
            localStorage.getItem(
              lengthPrefixedNamespaceCodec.encode(namespace + '/' + first, 'key')
            ) === 'left'
        const leftUsers = users.connect(left)
        const rightUsers = users.connect(right)
        await leftUsers.put({ id: 'a', email: 'same' })
        await rightUsers.put({ id: 'a', email: 'same' })
        try {
          await leftUsers.put({ id: 'b', email: 'same' })
        } catch (error) {
          if (error instanceof Error && Reflect.get(error, 'code') === 'INDEX_UNIQUE_CONFLICT')
            result.uniqueConflicts += 1
          else throw error
        }
        await host.dropOrg(first)
        await host.dropOrg(first)
        result.dropIsolated &&=
          (await left.get('key')) === null &&
          (await cache.get('key')) === null &&
          (await right.get('key')) === 'right'
        await left.set('key', 'reused')
        result.dropIsolated &&= (await left.get('key')) === 'reused'
        await host.dropOrg(defaultOrg)
        result.dropIsolated &&=
          (await same.get('key')) === null && (await right.get('key')) === 'right'
        await host.dropOrg(first)
        await host.dropOrg(second)
        result.combinations += 1
      } finally {
        await host.dispose()
      }
    }
  }
  return result
}

/** Declaration merging adds only this existing browser fixture's callable test hook. */
declare global {
  interface Window {
    runBrowserTextOrgScenario: typeof runBrowserTextOrgScenario
  }
}
window.runBrowserTextOrgScenario = runBrowserTextOrgScenario
