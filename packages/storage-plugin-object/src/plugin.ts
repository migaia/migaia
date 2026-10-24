import type { S3Client } from '@aws-sdk/client-s3'
import {
  definePlugin,
  defineStorageBackendKind,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import {
  StorageContractError,
  StorageContractErrorCode,
  type ICapabilityInstallPort,
  type IOperationContext
} from '@migaia/storage-contract'
import { ObjectDriverKind, ObjectNames } from './constants.js'
import { readObjectDriver } from './driver.js'
import { createObjectBackend } from './store.js'
import { invalidArgument } from './errors.js'
import type { IObjectAddress, IObjectDriver, IObjectStore } from './types.js'
/** Kind identity selects exactly the object backend and its two real native driver families. */
export const objectBackendKind = defineStorageBackendKind<
  IObjectStore,
  S3Client | undefined,
  {
    getDriverKind(): ObjectDriverKind
    getS3Client(): S3Client
    getObjectAddress(key: string, ctx?: IOperationContext): IObjectAddress
  }
>()(ObjectNames.backend)
/** Capture an authentic lazy driver; installation alone opens native resources. */
export function objectBackendPlugin<
  const TId extends string = 'object',
  const F extends IStorageFeatureRecord = {}
>(
  options: { readonly id?: TId; readonly driver: IObjectDriver },
  features?: F & IStorageFeatureStoreCompatibility<typeof objectBackendKind, NoInfer<F>>
): IStorageBackendPlugin<typeof objectBackendKind, NoInfer<TId>, F> {
  const driver = options?.driver
  readObjectDriver(driver)
  const id = (options.id ?? ObjectNames.backend) as TId
  if (typeof id !== 'string') throw invalidArgument()
  /** Installation receives immutable driver identity and allocates its own named lifecycle state. */
  const descriptor = (core: IStoragePluginCore<F>) => new ObjectBackendInstallation(driver, core)
  return definePlugin<TId, typeof descriptor, F>(id, descriptor, features)
}

/** One plugin installation publishes exactly one physical object backend into its original host. */
class ObjectBackendInstallation<F extends IStorageFeatureRecord> {
  /** Backend identity selects the existing capability contract. */
  readonly kind = objectBackendKind
  /** Lazy native construction uses the validated descriptor selected by the caller. */
  readonly #driver: IObjectDriver
  /** Original host owns registration, stages and resource shutdown. */
  readonly #core: IStoragePluginCore<F>
  /** Construction becomes available only after install succeeds. */
  #construction!: Awaited<ReturnType<typeof createObjectBackend>>
  /** Bind installation inputs without opening native resources. */
  constructor(driver: IObjectDriver, core: IStoragePluginCore<F>) {
    this.#driver = driver
    this.#core = core
  }
  /** Open native storage once and publish the same store, controller and org binding. */
  install = async () => {
    this.#construction = await createObjectBackend(this.#driver, this.#core)
    this.#core.registerStore(this.#construction.store)
    this.#core.registerChangeController(this.#construction.store, this.#construction.controller)
    this.#core.registerOrgBinding(this.#construction.store, this.#construction.orgBinding)
    this.#core.registerDetect((signal) => this.#construction.native.detect(signal))
    return {}
  }
  /** Capabilities use the installation port captured during original store publication. */
  capabilityInstaller = (_store: IObjectStore): ICapabilityInstallPort =>
    this.#construction.installer
  /** Native features borrow addresses and clients without acquiring driver shutdown authority. */
  featureExpose = () => ({
    getClient: () => this.#construction.native.client,
    getDriverKind: () => this.#driver.kind,
    getS3Client: () => {
      if (!this.#construction.native.client)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: ObjectNames.backend
        })
      return this.#construction.native.client
    },
    getObjectAddress: (key: string, ctx?: IOperationContext) => this.#construction.address(key, ctx)
  })
}
