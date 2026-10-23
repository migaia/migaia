import {
  definePlugin,
  defineStorageBackendKind,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import { capture, invalidArgument } from './errors.js'
import { QdrantText } from './constants.js'
import { fetchHttp } from './http.js'
import { createQdrantBackend } from './store.js'
import type { IQdrantHttp, IQdrantStore, IQdrantOptions } from './types.js'
/** Kind identity carries the exact native store and finite caller-owned protocol port. */
export const qdrantBackendKind = defineStorageBackendKind<IQdrantStore, IQdrantHttp>()(
  QdrantText.backend
)
/** Configuration capture is pure; actual connection checks remain the original host detect phase. */
export function qdrantBackendPlugin<
  const TId extends string = 'qdrant',
  const F extends IStorageFeatureRecord = {}
>(
  options: IQdrantOptions & { readonly id?: TId },
  features?: F &
    IStorageFeatureStoreCompatibility<typeof qdrantBackendKind, NoInfer<F>, IQdrantStore>
): IStorageBackendPlugin<typeof qdrantBackendKind, NoInfer<TId>, F, IQdrantStore> {
  const captured = capture(() => {
    const {
      url,
      apiKey,
      collectionPrefix = QdrantText.prefix,
      http,
      id = QdrantText.backend
    } = options
    if (typeof url !== 'string' || typeof collectionPrefix !== 'string' || typeof id !== 'string')
      throw invalidArgument()
    const fallback = fetchHttp(url, apiKey)
    return { url, apiKey, collectionPrefix, http: http ?? fallback, id: id as TId }
  })
  const descriptor = (core: IStoragePluginCore<F>) => {
    let construction!: ReturnType<typeof createQdrantBackend>
    return {
      kind: qdrantBackendKind,
      install() {
        construction = createQdrantBackend(captured, core)
        core.registerStore(construction.store)
        core.registerChangeController(construction.store, construction.controller)
        core.registerOrgBinding(construction.store, construction.orgBinding)
        core.registerDetect(construction.detect)
        return {}
      },
      capabilityInstaller: (_store: IQdrantStore) => construction.installer,
      featureExpose: () => ({ getClient: () => captured.http })
    }
  }
  return definePlugin<TId, typeof descriptor, F>(captured.id, descriptor, features)
}
