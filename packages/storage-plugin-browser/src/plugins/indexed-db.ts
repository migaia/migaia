import { indexedDbFeatureMissing } from '../backends/indexed-db-base-access.ts'
import type { IIndexedDbAssemblyPlan } from '../backends/indexed-db-assembly.ts'
import { readBuiltInPluginId } from './builtin-factory.ts'
import { indexedDbHost, type IIndexedDbOptions } from '../backends/indexed-db.ts'
import type { IIndexedDbBackend, IBuiltInPluginOptions } from '../host/builtin-backends.ts'
import {
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStoragePluginCore,
  type IStorageReactiveProfile,
  type IStorageBackendPluginDefiner
} from '@migaia/storage-host'
import { defineBackendPlugin, StorageReactiveVisibility } from '@migaia/storage-host/sdk'
import { StorageError } from '../types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import {
  BROWSER_REACTIVE_POLL_INTERVAL_MS,
  StorageBackend,
  IndexedDbFeature
} from '../constants.ts'
/** One installed backend owns its schema declarations and optional assembly selection. */
class IndexedDbPluginInstallation<F extends IStorageFeatureRecord> {
  /** Borrowed validated options remain fixed for this installation. */
  readonly #options: IIndexedDbOptions
  /** The original plugin core owns execution, publication and cleanup. */
  readonly #core: IStoragePluginCore<F>
  /** Features declare only their own stores before native opening. */
  readonly #objectStores = new Set<string>()
  /** Each explicit owner is selected once and shared across the installation's org views. */
  readonly #assemblies: IIndexedDbAssemblyPlan = {}
  /** Opening freezes native schema and assembly requirements. */
  #schemaSealed = false
  /** The original construction is unavailable until the backend install phase. */
  #construction!: ReturnType<typeof indexedDbHost>
  /** Capture the backend's original owner ports without acquiring native resources. */
  constructor(options: IIndexedDbOptions, core: IStoragePluginCore<F>) {
    this.#options = options
    this.#core = core
  }
  /** Publish callbacks which always resolve this same installation owner. */
  descriptor() {
    return {
      install: () => this.install(),
      featureExpose: () => this.featureExpose(),
      capabilityInstaller: (_store: ReturnType<typeof indexedDbHost>['store']) =>
        this.#construction.installer,
      journalBinding: (_store: ReturnType<typeof indexedDbHost>['store']) =>
        this.#construction.journalBinding
    }
  }
  /** Seal declared requirements, then let the native construction own rollback and disposal. */
  install(): Promise<{}> {
    this.#schemaSealed = true
    if (this.#core.journal !== undefined && this.#assemblies.journal === undefined)
      indexedDbFeatureMissing.fail(IndexedDbFeature.journal)
    this.#construction = indexedDbHost(
      this.#options,
      this.#core,
      [...this.#objectStores],
      true,
      this.#assemblies
    )
    this.#core.registerStore(this.#construction.store)
    this.#core.registerFeatureClientResolver(this.#construction.store, {
      getClient: this.#construction.getOrgClient,
      getTransactionClient: this.#construction.getOrgTransactionClient
    })
    this.#core.registerChangeController(this.#construction.store, this.#construction.controller)
    if (this.#construction.orgBinding !== undefined)
      this.#core.registerOrgBinding(this.#construction.store, this.#construction.orgBinding)
    return this.#construction.prepare!().then(() => ({}))
  }
  /** Features borrow client access only after install and select native owners before opening. */
  featureExpose() {
    return {
      installAssembly: <K extends keyof IIndexedDbAssemblyPlan>(
        name: K,
        owner: NonNullable<IIndexedDbAssemblyPlan[K]>
      ): void => this.installAssembly(name, owner),
      getClient: () => this.#construction.getClient(),
      getTransactionClient: (
        scope: Parameters<ReturnType<typeof indexedDbHost>['getTransactionClient']>[0]
      ) => this.#construction.getTransactionClient(scope),
      getTransactionClientForOrg: (scope: object, orgId: string) =>
        this.#construction.getOrgTransactionClient(scope, orgId),
      requireObjectStore: (name: string): void => this.requireObjectStore(name),
      reactiveProfile: (hasController: boolean) => this.reactiveProfile(hasController)
    }
  }
  /** Other pages change the same database, so a live query needs notifications and reconciles. */
  reactiveProfile(hasController: boolean): IStorageReactiveProfile {
    if (!hasController) indexedDbFeatureMissing.fail(IndexedDbFeature.notifications)
    return {
      mode: 'hybrid',
      visibility: StorageReactiveVisibility.originEventual,
      pollIntervalMs: BROWSER_REACTIVE_POLL_INTERVAL_MS
    }
  }
  /** Duplicate or late owners are configuration errors; no capability silently replaces another. */
  installAssembly<K extends keyof IIndexedDbAssemblyPlan>(
    name: K,
    owner: NonNullable<IIndexedDbAssemblyPlan[K]>
  ): void {
    if (this.#schemaSealed || this.#assemblies[name] !== undefined) this.invalidDeclaration()
    this.#assemblies[name] = owner
  }
  /** Only one pre-open declaration may own a native object store name. */
  requireObjectStore(name: string): void {
    if (
      this.#schemaSealed ||
      typeof name !== 'string' ||
      name.length === 0 ||
      this.#objectStores.has(name)
    )
      this.invalidDeclaration()
    this.#objectStores.add(name)
  }
  /** Preserve the existing adapter configuration code and stable schema diagnostic. */
  invalidDeclaration(): never {
    throw new StorageError(
      StorageBrowserErrorCode.invalidConfig,
      { backend: StorageBackend.indexedDb },
      StorageErrorText.indexedDbSchemaDeclarationInvalid
    )
  }
}

/** Backend-plugin definer typed for this backend; the annotation enables the descriptor checks. */
const defineIndexedDbBackend: IStorageBackendPluginDefiner<IIndexedDbBackend> = defineBackendPlugin
/** Declare basic IDB storage; each optional behavior requires its own explicit Feature. */
export const indexedDbBackendPlugin = <
  const TId extends string = 'indexed-db',
  const F extends IStorageFeatureRecord = {}
>(
  options: IIndexedDbOptions & IBuiltInPluginOptions<IIndexedDbBackend, TId, F> = {}
): IStorageBackendPlugin<IIndexedDbBackend, NoInfer<TId>, F> => {
  /** A named owner is created independently for every plugin installation. */
  const descriptor = (core: IStoragePluginCore<F>) =>
    new IndexedDbPluginInstallation(options, core).descriptor()
  return defineIndexedDbBackend<TId, typeof descriptor, F>({
    name: readBuiltInPluginId(options, 'indexed-db', StorageBackend.indexedDb),
    features: options.features,
    open: descriptor
  })
}
