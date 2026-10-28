import { indexedDbTestFeatures } from '../helpers/indexed-db-features.ts'
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '../../src/indexed-db.ts'
import {
  indexedDbBlobFeature,
  type IIndexedDbBlobApi,
  type ITransactionBlobApi
} from '../../src/features/blobs.ts'

/** Compile the exact selected and absent Feature projections without acquiring browser resources. */
async function blobFeatureTypes() {
  const host = await createStorageHost({
    plugins: [
      indexedDbBackendPlugin({}, { ...indexedDbTestFeatures, blobs: indexedDbBlobFeature() })
    ]
  })
  const root: IIndexedDbBlobApi = host.backend('indexed-db').api.blobs
  const found: Blob | undefined = await root.get('key')
  void found
  await host.backend('indexed-db').transaction(async (scope) => {
    const tx: ITransactionBlobApi = scope.api.blobs
    await tx.put('key', new Blob())
    // @ts-expect-error Transaction Blob requests borrow their existing context.
    await tx.put('key', new Blob(), { timeoutMs: 1 })
    // @ts-expect-error Blob API grants no database or backend shutdown authority.
    tx.dispose()
  })
  const bare = await createStorageHost({
    plugins: [indexedDbBackendPlugin({}, indexedDbTestFeatures)]
  })
  // @ts-expect-error Unselected Blob Feature contributes no API group.
  void bare.backend('indexed-db').api.blobs
  await host.dispose()
  await bare.dispose()
}
void blobFeatureTypes
