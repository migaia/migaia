import {
  definePlugin,
  defineStorageBackendKind,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import { capture, invalidArgument } from './errors.js'
import { SparqlText } from './text.js'
import { captureEndpoint, createSparqlBackend } from './store.js'
import type { ISparqlEndpoint } from './endpoint.js'
import type { ISparqlStore } from './types.js'
/** The kind carries the exact non-KV native store and the unique caller-owned endpoint. */
export const sparqlBackendKind = defineStorageBackendKind<ISparqlStore, ISparqlEndpoint>()(
  SparqlText.backend
)
export type ISparqlOptions = { readonly endpoint: ISparqlEndpoint }
/** Capture configuration synchronously; only installation creates the actual backend owner. */
export function sparqlBackendPlugin<
  const TId extends string = 'sparql',
  const F extends IStorageFeatureRecord = {}
>(
  options: ISparqlOptions & { readonly id?: TId },
  features?: F &
    IStorageFeatureStoreCompatibility<typeof sparqlBackendKind, NoInfer<F>, ISparqlStore>
): IStorageBackendPlugin<typeof sparqlBackendKind, NoInfer<TId>, F, ISparqlStore> {
  const endpoint = captureEndpoint(capture(() => options.endpoint)),
    id = capture(() => options.id ?? SparqlText.backend) as TId
  if (typeof id !== 'string') throw invalidArgument()
  const descriptor = (core: IStoragePluginCore<F>) => {
    let construction!: ReturnType<typeof createSparqlBackend>
    return {
      kind: sparqlBackendKind,
      install() {
        construction = createSparqlBackend(endpoint, core)
        core.registerStore(construction.store)
        core.registerChangeController(construction.store, construction.controller)
        core.registerOrgBinding(construction.store, construction.orgBinding)
        core.registerDetect(construction.detect)
        return {}
      },
      capabilityInstaller: (_store: ISparqlStore) => construction.installer,
      featureExpose: () => ({ getClient: () => endpoint })
    }
  }
  return definePlugin<TId, typeof descriptor, F>(id, descriptor, features)
}
