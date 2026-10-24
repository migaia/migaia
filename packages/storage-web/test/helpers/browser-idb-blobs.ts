import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'
import { indexedDbBlobFeature } from '../../src/features/blobs.js'

/** Real engines prove File metadata, original rollback, physical organization and reopening. */
export async function runBrowserIndexedDbBlobsScenario() {
  const dbName = 'browser-blobs-' + createOrgId()
  const org = createOrgId()
  const defaultOrg = createOrgId()
  const plugin = () => indexedDbBackendPlugin({ dbName }, { blobs: indexedDbBlobFeature() })
  const file = new File(['avatar bytes'], 'avatar.txt', {
    type: 'text/plain',
    lastModified: 123456789
  })
  let host = await createStorageHost({ org: defaultOrg, plugins: [plugin()] })
  try {
    const store = host.backend('indexed-db')
    const child = host.org(org).backend('indexed-db')
    await store.api.blobs.put('avatar', file)
    await child.api.blobs.put('avatar', new Blob(['organization']))
    const failure = new Error('rollback Blob and record')
    const rollback = await store
      .transaction(async (scope) => {
        await scope.api.blobs.put('discard', new Blob(['discard']))
        await scope.putRecord({ discard: true }, 'discard')
        throw failure
      })
      .then(
        () => false,
        () => true
      )
    const atomicRollback =
      rollback &&
      (await store.api.blobs.get('discard')) === undefined &&
      (await store.getRecord('discard')) === undefined
    const isolated = (await (await child.api.blobs.get('avatar'))!.text()) === 'organization'
    await host.dispose()
    host = await createStorageHost({ org: defaultOrg, plugins: [plugin()] })
    const reopened = await host.backend('indexed-db').api.blobs.get('avatar')
    const metadata =
      reopened instanceof File &&
      reopened.name === file.name &&
      reopened.lastModified === file.lastModified &&
      reopened.type === file.type
    const contents = (await reopened!.text()) === 'avatar bytes'
    await host.dropOrg(org)
    await host.dropOrg(defaultOrg)
    return { metadata, contents, atomicRollback, isolated }
  } finally {
    await host.dispose()
  }
}

/** Declaration merging exposes only the existing browser scenario's callable entry. */
declare global {
  interface Window {
    runBrowserIndexedDbBlobsScenario: typeof runBrowserIndexedDbBlobsScenario
  }
}
window.runBrowserIndexedDbBlobsScenario = runBrowserIndexedDbBlobsScenario
