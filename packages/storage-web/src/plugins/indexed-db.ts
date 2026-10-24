import type { IIndexedDbAssemblyPlan } from '../backends/indexed-db-assembly.js'
import { readBuiltInPluginId } from './builtin-factory.js'
import { indexedDbHost, type IIndexedDbOptions } from '../backends/indexed-db.js'
import { indexedDbBackendKind, type IBuiltInPluginId } from '../host/builtin-kinds.js'
import {
  definePlugin,
  type IStorageBackendPlugin,
  type IStorageFeatureRecord,
  type IStorageFeatureStoreCompatibility,
  type IStoragePluginCore
} from '@migaia/storage-host'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { StorageBackend } from '../constants.js'
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
      kind: indexedDbBackendKind,
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
      requireObjectStore: (name: string): void => this.requireObjectStore(name)
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
      StorageErrorCode.invalidConfig,
      { backend: StorageBackend.indexedDb },
      StorageErrorText.indexedDbSchemaDeclarationInvalid
    )
  }
}

/** Declare basic IDB storage; each optional behavior requires its own explicit Feature. */
export const indexedDbBackendPlugin = <
  const TId extends string = 'indexed-db',
  const F extends IStorageFeatureRecord = {}
>(
  options: IIndexedDbOptions & IBuiltInPluginId<TId> = {},
  features?: F & IStorageFeatureStoreCompatibility<typeof indexedDbBackendKind, NoInfer<F>>
): IStorageBackendPlugin<typeof indexedDbBackendKind, NoInfer<TId>, F> => {
  /** A named owner is created independently for every plugin installation. */
  const descriptor = (core: IStoragePluginCore<F>) =>
    new IndexedDbPluginInstallation(options, core).descriptor()
  return definePlugin<TId, typeof descriptor, F>(
    readBuiltInPluginId(options, 'indexed-db', StorageBackend.indexedDb),
    descriptor,
    features
  )
}
