import type { S3Client } from '@aws-sdk/client-s3'
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
import {
  StorageContractError,
  StorageContractErrorCode,
  type ICapabilityInstallPort,
  type IOperationContext
} from '@migaia/storage-contract'
import { ObjectDriverKind, ObjectNames } from './constants.ts'
import { readObjectDriver } from './driver.ts'
import { createObjectBackend } from './store.ts'
import { invalidArgument } from './errors.ts'
import type { IObjectAddress, IObjectDriver, IObjectStore } from './types.ts'
/** The object engine as a type: its Store and the two real native driver families. */
export type IObjectBackend = IStorageBackendType<
  IObjectStore,
  S3Client | undefined,
  {
    getDriverKind(): ObjectDriverKind
    getS3Client(): S3Client
    getObjectAddress(key: string, ctx?: IOperationContext): IObjectAddress
    /** True once the driver confirmed conditional writes; presign checks it before signing. */
    supportsConditionalWrites(): boolean
  }
>
/** Defines this package's Features; the annotation carries the object backend type. */
export const defineObjectFeature: IStorageFeatureDefiner<IObjectBackend> = defineStorageFeature
/** Backend-plugin definer typed for this backend; the annotation enables the descriptor checks. */
const defineObjectBackend: IStorageBackendPluginDefiner<IObjectBackend> = defineBackendPlugin
/** Capture an authentic lazy driver; installation alone opens native resources. */
export function objectBackendPlugin<
  const TId extends string = 'object',
  const F extends IStorageFeatureRecord = {}
>(options: {
  /** Plugin name and backend lookup key; `'object'` when omitted. */
  readonly name?: TId
  readonly driver: IObjectDriver
  /** Features installed on this backend. */
  readonly features?: F & IStorageFeatureStoreCompatibility<IObjectBackend, NoInfer<F>>
}): IStorageBackendPlugin<IObjectBackend, NoInfer<TId>, F> {
  const driver = options?.driver
  readObjectDriver(driver)
  const id = (options.name ?? ObjectNames.backend) as TId
  if (typeof id !== 'string') throw invalidArgument()
  /** Installation receives immutable driver identity and allocates its own named lifecycle state. */
  const descriptor = (core: IStoragePluginCore<F>) => new ObjectBackendInstallation(driver, core)
  return defineObjectBackend<TId, typeof descriptor, F>({
    name: id,
    features: options.features,
    open: descriptor
  })
}

/** One plugin installation publishes exactly one physical object backend into its original host. */
class ObjectBackendInstallation<F extends IStorageFeatureRecord> {
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
    getObjectAddress: (key: string, ctx?: IOperationContext) =>
      this.#construction.address(key, ctx),
    supportsConditionalWrites: () => this.#construction.native.conditionalWrites?.() === true
  })
}
