import {
  kv,
  provideCapabilities,
  type ICapabilityImpl,
  type ICapabilityInstallPort,
  type ICapabilityStore,
  type IKeyValueApi,
  type IStorageBase,
  type IKeyValueStore
} from '@migaia/storage-contract'
import type { IStoragePluginCore, IStorageOrgBinding } from '@migaia/storage-host'
import type {
  IBackendChangeController,
  IBackendValueCommit
} from '@migaia/storage-host/authoring/backend'

/** Backend factories borrow the original registration's execution and controller ports. */
export type IBackendRuntime = Pick<
  IStoragePluginCore,
  | 'defaultOrgId'
  | 'createChangeController'
  | 'createKeyLockPort'
  | 'createTransactionApi'
  | 'getChainMethods'
  | 'execution'
  | 'stageBindings'
  | 'featureExpose'
  | 'getOrgContext'
  | 'createOrgAuthoringPort'
  | 'journal'
>

/** Native KV methods and their exact synchronous channel remain on the same provided object. */
export type IKeyValueBackendStore<S extends IKeyValueStore> = Omit<
  ICapabilityStore<S, typeof kv, readonly [ICapabilityImpl<typeof kv, IBrowserKeyValueApi<S>>]>,
  'sync'
> &
  Pick<S, 'sync'>

/** The finite native API retains each backend's precise context types without token dispatch. */
export type IBrowserKeyValueApi<S extends IKeyValueStore> = Pick<
  S,
  'get' | 'set' | 'remove' | 'has' | 'keys' | 'clearValues' | 'clearAll' | 'sync'
> &
  IBrowserBatchApi

/** Native batches are supplied by the same backend without widening the ordinary raw KV base. */
export type IBrowserBatchApi = Pick<
  IKeyValueApi,
  'getMany' | 'setMany' | 'removeMany' | 'removeByPrefix'
>

/** Capture these arrow-backed native methods before the provider replaces base.has with dispatch. */
export function browserKeyValueApi<S extends IKeyValueStore>(
  store: S,
  batch: IBrowserBatchApi
): IBrowserKeyValueApi<S> {
  const { get, set, remove, has, keys, clearValues, clearAll, sync } = store
  return { get, set, remove, has, keys, clearValues, clearAll, sync, ...batch }
}

/** One construction closure holds the original store, controller and borrowed native client. */
export type IBackendConstruction<S extends IStorageBase, C> = {
  readonly store: S
  readonly controller: IBackendChangeController
  readonly installer: ICapabilityInstallPort
  readonly getClient: () => C
  readonly prepare?: () => Promise<void>
  /** The original value backend supplies its own atomic native terminal to entity orchestration. */
  readonly commitValueWrite?: IBackendValueCommit
  /** Physical organization lookup remains private to this installed backend construction. */
  readonly orgBinding?: IStorageOrgBinding
  /** Physical deletion stays with the original native opener and keeps the borrowed store usable. */
  readonly dropData?: () => Promise<void>
}

/** Publish the actual native descriptors without cloning their store or cleanup methods. */
export function provideBackendConstruction<
  S extends IKeyValueStore,
  C,
  const TImplementations extends readonly ICapabilityImpl[]
>(
  base: S,
  implementations: TImplementations,
  controller: IBackendChangeController,
  getClient: () => C,
  prepare?: () => Promise<void>
): IBackendConstruction<
  ICapabilityStore<S, TImplementations[number]['capability'], TImplementations>,
  C
> {
  /** The canonical provider grants this installation authority exactly once. */
  let installer!: ICapabilityInstallPort
  /** Capability publication refines the same backend object and captures its original methods. */
  const store = provideCapabilities(base, implementations, {
    onInstaller: (port) => {
      installer = port
    }
  })
  return { store, controller, installer, getClient, ...(prepare === undefined ? {} : { prepare }) }
}
