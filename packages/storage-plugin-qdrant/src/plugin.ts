import { snapshotOptionProperties } from '@migaia/utils/object'
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
import { QdrantText } from './constants.ts'
import { fetchHttp } from './http.ts'
import { createQdrantBackend } from './store.ts'
import type { IQdrantHttp, IQdrantStore, IQdrantOptions } from './types.ts'
import type { IQdrantRescoreConfiguration } from './feature-types.ts'
/** The Qdrant engine as a type: its Store, the caller-owned HTTP port and rescore selection. */
export type IQdrantBackend = IStorageBackendType<
  IQdrantStore,
  IQdrantHttp,
  { selectRescore(configuration: IQdrantRescoreConfiguration): void }
>
/** Defines this package's Features; the annotation carries the Qdrant backend type. */
export const defineQdrantFeature: IStorageFeatureDefiner<IQdrantBackend> = defineStorageFeature
/** Backend-plugin definer typed for this backend; the annotation enables the descriptor checks. */
const defineQdrantBackend: IStorageBackendPluginDefiner<IQdrantBackend> = defineBackendPlugin
/** Configuration capture is pure; actual connection checks remain the original host detect phase. */
export function qdrantBackendPlugin<
  const TId extends string = 'qdrant',
  const F extends IStorageFeatureRecord = {}
>(
  options: IQdrantOptions & {
    /** Plugin name and backend lookup key; `'qdrant'` when omitted. */
    readonly name?: TId
    /** Features installed on this backend. */
    readonly features?: F &
      IStorageFeatureStoreCompatibility<IQdrantBackend, NoInfer<F>, IQdrantStore>
  }
): IStorageBackendPlugin<IQdrantBackend, NoInfer<TId>, F, IQdrantStore> {
  const { features, ...captured } = readQdrantOptions(options)
  /** Each installation gets its own named state while borrowing the validated configuration. */
  const descriptor = (core: IStoragePluginCore<F>) => new QdrantInstallation(captured, core)
  return defineQdrantBackend<TId, typeof descriptor, F>({
    name: captured.id,
    features,
    open: descriptor
  })
}

/** Normalized lazy options retain selected routing across asynchronous installation and detection. */
type IQdrantInstallationOptions = IQdrantOptions & {
  readonly http: IQdrantHttp
  readonly collectionPrefix: string
}
/** One installation owns selection and publication; original host/controller still own shutdown. */
class QdrantInstallation<F extends IStorageFeatureRecord> {
  /** Validated immutable configuration determines the original physical HTTP endpoint. */
  readonly #options: IQdrantInstallationOptions
  /** The original host alone owns backend registration and operation execution. */
  readonly #core: IStoragePluginCore<F>
  /** Native construction exists only after the original installation phase succeeds. */
  #construction!: ReturnType<typeof createQdrantBackend>
  /** Only the installation window selects extra rescore schema shared across organizations. */
  #rescore: IQdrantRescoreConfiguration | undefined
  /** Bind configuration without contacting the native service. */
  constructor(options: IQdrantInstallationOptions, core: IStoragePluginCore<F>) {
    this.#options = options
    this.#core = core
  }
  /** Publish the original store and lifecycle ports through own-function descriptor fields. */
  install = () => {
    this.#construction = createQdrantBackend(this.#options, this.#core, this.#rescore)
    this.#core.registerStore(this.#construction.store)
    this.#core.registerChangeController(this.#construction.store, this.#construction.controller)
    this.#core.registerOrgBinding(this.#construction.store, this.#construction.orgBinding)
    this.#core.registerDetect(this.#construction.detect)
    return {}
  }
  /** Capability publication retains the exact installer captured by the store. */
  capabilityInstaller = (_store: IQdrantStore) => this.#construction.installer
  /** Features borrow the same transport and select schema without gaining client lifetime. */
  featureExpose = () => ({
    getClient: () => this.#options.http,
    selectRescore: (configuration: IQdrantRescoreConfiguration) => {
      this.#rescore = configuration
    }
  })
}

/**
 * Read and validate plugin options once. A throwing option getter is INVALID_ARGUMENT with the
 * getter error on cause; invalid values are INVALID_ARGUMENT without a cause.
 */
function readQdrantOptions<TId extends string, TFeatures>(
  options: IQdrantOptions & { readonly name?: TId; readonly features?: TFeatures }
): IQdrantInstallationOptions & { readonly id: TId; readonly features: TFeatures | undefined } {
  /** One read of every option. */
  let snapshot: IQdrantOptions & { readonly name?: TId; readonly features?: TFeatures }
  try {
    snapshot = snapshotOptionProperties(options)
  } catch (cause) {
    throw invalidArgument(cause)
  }
  const {
    url,
    apiKey,
    collectionPrefix = QdrantText.prefix,
    http,
    name: id = QdrantText.backend,
    features
  } = snapshot
  if (typeof url !== 'string' || typeof collectionPrefix !== 'string' || typeof id !== 'string')
    throw invalidArgument()
  const fallback = fetchHttp(url, apiKey)
  return { url, apiKey, collectionPrefix, http: http ?? fallback, id: id as TId, features }
}
