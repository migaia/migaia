import {
  definePlugin,
  defineStorageBackendKind,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import { invalidArgument } from './errors.js'
import { QdrantText } from './constants.js'
import { fetchHttp } from './http.js'
import { createQdrantBackend } from './store.js'
import type { IQdrantHttp, IQdrantStore, IQdrantOptions } from './types.js'
import type { IQdrantRescoreConfiguration } from './feature-types.js'
/** Kind identity carries the exact native store and finite caller-owned protocol port. */
export const qdrantBackendKind = defineStorageBackendKind<
  IQdrantStore,
  IQdrantHttp,
  { selectRescore(configuration: IQdrantRescoreConfiguration): void }
>()(QdrantText.backend)
/** Configuration capture is pure; actual connection checks remain the original host detect phase. */
export function qdrantBackendPlugin<
  const TId extends string = 'qdrant',
  const F extends IStorageFeatureRecord = {}
>(
  options: IQdrantOptions & { readonly id?: TId },
  features?: F &
    IStorageFeatureStoreCompatibility<typeof qdrantBackendKind, NoInfer<F>, IQdrantStore>
): IStorageBackendPlugin<typeof qdrantBackendKind, NoInfer<TId>, F, IQdrantStore> {
  const captured = (function readAcceptedInput() {
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
  })()
  /** Each installation gets its own named state while borrowing the validated configuration. */
  const descriptor = (core: IStoragePluginCore<F>) => new QdrantInstallation(captured, core)
  return definePlugin<TId, typeof descriptor, F>(captured.id, descriptor, features)
}

/** Normalized lazy options retain selected routing across asynchronous installation and detection. */
type IQdrantInstallationOptions = IQdrantOptions & {
  readonly http: IQdrantHttp
  readonly collectionPrefix: string
}
/** One installation owns selection and publication; original host/controller still own shutdown. */
class QdrantInstallation<F extends IStorageFeatureRecord> {
  /** The authentic backend kind keeps Feature compatibility checks unchanged. */
  readonly kind = qdrantBackendKind
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
