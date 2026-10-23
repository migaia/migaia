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
import { invalidArgument, captureObjectOptions } from './errors.js'
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
  const driver = captureObjectOptions(() => options?.driver)
  readObjectDriver(driver)
  const id = captureObjectOptions(() => options.id ?? ObjectNames.backend) as TId
  if (typeof id !== 'string') throw invalidArgument()
  const descriptor = (core: IStoragePluginCore<F>) => {
    let construction!: Awaited<ReturnType<typeof createObjectBackend>>
    return {
      kind: objectBackendKind,
      async install() {
        construction = await createObjectBackend(driver, core)
        core.registerStore(construction.store)
        core.registerChangeController(construction.store, construction.controller)
        core.registerOrgBinding(construction.store, construction.orgBinding)
        core.registerDetect((signal) => construction.native.detect(signal))
        return {}
      },
      capabilityInstaller: (_store: IObjectStore): ICapabilityInstallPort => construction.installer,
      featureExpose: () => ({
        getClient: () => construction.native.client,
        getDriverKind: () => driver.kind,
        getS3Client: () => {
          if (!construction.native.client)
            throw new StorageContractError(StorageContractErrorCode.unsupported, {
              backend: ObjectNames.backend
            })
          return construction.native.client
        },
        getObjectAddress: (key: string, ctx?: IOperationContext) => construction.address(key, ctx)
      })
    }
  }
  return definePlugin<TId, typeof descriptor, F>(id, descriptor, features)
}
