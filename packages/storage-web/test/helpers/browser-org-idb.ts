import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'

/** Real browser databases prove physical default mapping, isolated deletion, and view reuse. */
export async function runBrowserIndexedDbOrgScenario() {
  const result = {
    combinations: 0,
    defaultShared: true,
    isolated: true,
    deleted: true,
    reused: true
  }
  for (const defaultOrg of ['00000000-0000-0000-0000-000000000000', createOrgId()]) {
    const prefix = 'browser-idb-org-' + createOrgId()
    const first = createOrgId()
    const second = createOrgId()
    const host = await createStorageHost({
      org: defaultOrg,
      plugins: [
        indexedDbBackendPlugin({ id: 'prefs', dbName: prefix }),
        indexedDbBackendPlugin({ id: 'cache', dbName: prefix + '-cache' })
      ]
    })
    try {
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
      await host.dropOrg(first)
      const remaining = (await indexedDB.databases()).map(({ name }) => name)
      result.deleted &&=
        !remaining.includes(prefix + '/' + first) &&
        !remaining.includes(prefix + '-cache/' + first) &&
        remaining.includes(prefix) &&
        remaining.includes(prefix + '/' + second)
      await host.dropOrg(first)
      result.deleted &&= (await left.get('key')) === null
      await left.set('key', 'reused')
      result.reused &&= (await left.get('key')) === 'reused'
      await host.dropOrg(defaultOrg)
      result.deleted &&=
        !(await indexedDB.databases()).some(({ name }) => name === prefix) &&
        (await right.get('key')) === 'right'
      await host.dropOrg(first)
      await host.dropOrg(second)
      result.combinations += 1
    } finally {
      await host.dispose()
    }
  }
  return result
}

/** Declaration merging adds only this existing browser fixture's callable test hook. */
declare global {
  interface Window {
    runBrowserIndexedDbOrgScenario: typeof runBrowserIndexedDbOrgScenario
  }
}
window.runBrowserIndexedDbOrgScenario = runBrowserIndexedDbOrgScenario
