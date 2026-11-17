import {
  type IStorageBackendPlugin,
  type IStorageBackendType,
  type IStorageFeatureDefiner,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore,
  type IStorageBackendPluginDefiner
} from '@migaia/storage-host'
import { defineBackendPlugin, defineStorageFeature } from '@migaia/storage-host/sdk'
import { invalidArgument } from './errors.ts'
import { SparqlText } from './text.ts'
import { captureEndpoint, createSparqlBackend } from './store.ts'
import type { ISparqlEndpoint } from './endpoint.ts'
import type { ISparqlStore } from './types.ts'
/** The SPARQL engine as a type: its non-KV Store and the caller-owned endpoint. */
export type ISparqlBackend = IStorageBackendType<ISparqlStore, ISparqlEndpoint>
/** Defines this package's Features; the annotation carries the SPARQL backend type. */
export const defineSparqlFeature: IStorageFeatureDefiner<ISparqlBackend> = defineStorageFeature
export type ISparqlOptions = { readonly endpoint: ISparqlEndpoint }
/** Backend-plugin definer typed for this backend; the annotation enables the descriptor checks. */
const defineSparqlBackend: IStorageBackendPluginDefiner<ISparqlBackend> = defineBackendPlugin
/** Capture configuration synchronously; only installation creates the actual backend owner. */
export function sparqlBackendPlugin<
  const TId extends string = 'sparql',
  const F extends IStorageFeatureRecord = {}
>(
  options: ISparqlOptions & {
    /** Plugin name and backend lookup key; `'sparql'` when omitted. */
    readonly name?: TId
    /** Features installed on this backend. */
    readonly features?: F &
      IStorageFeatureStoreCompatibility<ISparqlBackend, NoInfer<F>, ISparqlStore>
  }
): IStorageBackendPlugin<ISparqlBackend, NoInfer<TId>, F, ISparqlStore> {
  /** Construction admits the caller endpoint and logical backend identity before installation. */
  const endpoint = captureEndpoint(options.endpoint),
    id = (options.name ?? SparqlText.backend) as TId
  if (typeof id !== 'string') throw invalidArgument()
  /** The existing backend descriptor owns capability installation and physical controller disposal. */
  const descriptor = (core: IStoragePluginCore<F>) => {
    /** The existing installation registrar owns organization bindings and ready/detect behavior. */
    let construction!: ReturnType<typeof createSparqlBackend>
    return {
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
  return defineSparqlBackend<TId, typeof descriptor, F>({
    name: id,
    features: options.features,
    open: descriptor
  })
}
