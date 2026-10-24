import type { IChainMethods, IStorageBase, IStorageResource } from '@migaia/storage-contract'
import { createErrorCollector } from '@migaia/lifecycle'
import { StorageError, StorageErrorCode, STORAGE_HOST_SOURCE } from './errors.js'
import { StorageErrorText } from './error-text.js'
import type { IStorageFeatureProjection } from './feature-install.js'
import type {
  IStorageOrgBinding,
  IStorageBorrowedBackend,
  IStoragePluginCallContext,
  IStorageExecutionPort,
  IStorageFeatureClientResolver
} from './types.js'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
import type { IStorageJournalBackendBinding } from './journal/types.js'
import { snapshotStorageJournalBinding } from './journal/binding.js'
/** One registration binds one construction identity and publishes it only after admission. */
export type IStorageStoreCell = {
  /** A read-only original registration identity grants no methods or resource authority. */
  readonly journalIdentity: object
  bind(store: IStorageBase): void
  set(store: IStorageBase): void
  get(): IStorageBase
  setFeatureProjection(projection: IStorageFeatureProjection | undefined): void
  setFeatureClientResolver(resolver: IStorageFeatureClientResolver): void
  getFeatureClientResolver(): IStorageFeatureClientResolver | undefined
  createTransactionApi(scope: object): object | undefined
  getChainMethods(family: keyof IChainMethods): object | undefined
  setOrgBinding(binding: IStorageOrgBinding): void
  setJournalBinding(binding: IStorageJournalBackendBinding): void
  journalForOrg(orgId: string): Omit<IStorageJournalBackendBinding, 'forOrg'>
  retainJournalResource(resource: IStorageResource): () => void
  releaseJournalResources(): Promise<void>
  forOrg(orgId: string, defaultOrgId: string): IStorageBase
  dropOrg(orgId: string): Promise<void>
  createOrgApi(
    store: IStorageBase,
    context: IStoragePluginCallContext,
    execution: IStorageExecutionPort
  ): object | undefined
  createOrgTransactionApi(
    scope: object,
    store: IStorageBase,
    context: IStoragePluginCallContext,
    execution: IStorageExecutionPort
  ): object | undefined
  captureExtension(key: PropertyKey, value: unknown, receiver: object): void
  projectExtension(
    key: PropertyKey,
    context: IStoragePluginCallContext,
    assertCurrent: () => void
  ): unknown
  projectExtensions(context: IStoragePluginCallContext, assertCurrent: () => void): object
  projectOrgBackend(orgId: string, create: () => IStorageBorrowedBackend): IStorageBorrowedBackend
  retainOrgBinding(release: () => void | Promise<void>): void
  releaseOrgBindings(): Promise<void>
}
/** One original registration owns admission, projections and retained native resources. */
class StorageStoreCell implements IStorageStoreCell {
  /** The same store pointer survives construction binding and the final admitted handoff. */
  #value: IStorageBase | undefined

  /** Construction binding must agree with the one eventual admitted store. */
  #admitted = false

  /** Selected Feature output is owned by this same original registration, without a scope table. */
  #projection: IStorageFeatureProjection | undefined

  /** Only an explicitly registered native client resolver changes Feature client selection. */
  #featureClientResolver: IStorageFeatureClientResolver | undefined

  /** Optional native projection belongs to this same single-assignment store cell. */
  #orgBinding: IStorageOrgBinding | undefined

  /** The descriptor's one private journal binding shares this original single-assignment cell. */
  #journalBinding: IStorageJournalBackendBinding | undefined

  /** Dynamic journal handles are released by the one original install-time disposal callback. */
  #journalResources = new Map<IStorageResource, () => Promise<void>>()

  /** Only this registration's original extension methods need organization rebinding. */
  #extensions = new Map<
    PropertyKey,
    {
      readonly value: unknown
      readonly receiver: object
    }
  >()

  /** Each organization retains one business view, avoiding per-lookup resource aliases. */
  #orgViews = new Map<string, IStorageBorrowedBackend>()

  /** Exact aliases are released by the registration's existing resource scope. */
  #orgReleases: Array<() => void | Promise<void>> = []

  /** Capture one source receiver and org without rereading the caller's descriptors. */
  readonly projectExtension: IStorageStoreCell['projectExtension'] = (
    key: PropertyKey,
    context: IStoragePluginCallContext,
    assertCurrent: () => void
  ) => {
    const entry = this.#extensions.get(key)!
    if (typeof entry.value !== 'function') return entry.value
    const receiver = Object.assign(Object.create(entry.receiver), context)
    return (...args: unknown[]) => {
      assertCurrent()
      return receiver[key](...args)
    }
  }
  /** Registration identity grants no callable or resource authority. */
  readonly journalIdentity = {}
  /** Accept the sole native client resolver; duplicate registration rejects. */
  readonly setFeatureClientResolver: IStorageStoreCell['setFeatureClientResolver'] = (resolver) => {
    if (this.#featureClientResolver !== undefined)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    this.#featureClientResolver = resolver
  }
  /** Expose only the resolver explicitly retained by this registration. */
  readonly getFeatureClientResolver: IStorageStoreCell['getFeatureClientResolver'] = () =>
    this.#featureClientResolver
  /** Retain each native journal resource once for the existing reverse disposal order. */
  readonly retainJournalResource: IStorageStoreCell['retainJournalResource'] = (resource) => {
    if (this.#journalResources.has(resource)) return () => undefined
    /** Native handles remain responsible for their own idempotent disposal. */
    const release = () => resource.dispose()
    this.#journalResources.set(resource, release)
    return () => {
      if (this.#journalResources.get(resource) === release) this.#journalResources.delete(resource)
    }
  }
  /** Drain retained journal handles in reverse order and preserve collected failures. */
  readonly releaseJournalResources: IStorageStoreCell['releaseJournalResources'] = async () => {
    const releases = [...this.#journalResources.values()]
    this.#journalResources.clear()
    const errors = createErrorCollector('throw', undefined)
    for (let index = releases.length - 1; index >= 0; index--) {
      try {
        await releases[index]!()
      } catch (error) {
        errors.add(STORAGE_HOST_SOURCE, error)
      }
    }
    errors.finalize(StorageErrorText.storageHostDisposeFailed)
  }
  /** Accept the sole native journal binding before organization projection begins. */
  readonly setJournalBinding: IStorageStoreCell['setJournalBinding'] = (binding) => {
    if (this.#journalBinding !== undefined)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    this.#journalBinding = snapshotStorageJournalBinding(binding)
  }
  /** Project journal operations for one organization without granting another resource owner. */
  readonly journalForOrg: IStorageStoreCell['journalForOrg'] = (orgId) => {
    if (this.#journalBinding === undefined)
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    const { forOrg: _forOrg, ...projected } = snapshotStorageJournalBinding(
      this.#journalBinding.forOrg(orgId)
    )
    return projected
  }
  /** Reuse one native business view per organization for this registration. */
  readonly projectOrgBackend: IStorageStoreCell['projectOrgBackend'] = (orgId, create) => {
    const existing = this.#orgViews.get(orgId)
    if (existing !== undefined) return existing
    const view = create()
    this.#orgViews.set(orgId, view)
    return view
  }
  /** Retain the original alias release until the registration closes. */
  readonly retainOrgBinding: IStorageStoreCell['retainOrgBinding'] = (release) => {
    this.#orgReleases.push(release)
  }
  /** Release original aliases in registration order and report all cleanup failures. */
  readonly releaseOrgBindings: IStorageStoreCell['releaseOrgBindings'] = async () => {
    const errors = createErrorCollector('throw', undefined)
    for (const release of this.#orgReleases.splice(0)) {
      try {
        await release()
      } catch (error) {
        errors.add(STORAGE_HOST_SOURCE, error)
      }
    }
    this.#orgViews.clear()
    errors.finalize(StorageErrorText.storageHostDisposeFailed)
  }
  /** Accept one native organization binding without replacing an admitted owner. */
  readonly setOrgBinding: IStorageStoreCell['setOrgBinding'] = (binding) => {
    if (this.#orgBinding !== undefined)
      throw new StorageContractError(StorageContractErrorCode.invalidArgument)
    this.#orgBinding = binding
  }
  /** Resolve the native organization view or the admitted default store. */
  readonly forOrg: IStorageStoreCell['forOrg'] = (orgId, defaultOrgId) => {
    if (this.#orgBinding !== undefined) return this.#orgBinding.backend(orgId)
    if (orgId === defaultOrgId) return this.#value!
    throw new StorageContractError(StorageContractErrorCode.unsupported)
  }
  /** Delegate physical removal to the native organization owner. */
  readonly dropOrg: IStorageStoreCell['dropOrg'] = (orgId) =>
    this.#orgBinding === undefined
      ? Promise.reject(new StorageContractError(StorageContractErrorCode.unsupported))
      : this.#orgBinding.drop(orgId)
  /** Assemble feature methods with the native store and immutable organization context. */
  readonly createOrgApi: IStorageStoreCell['createOrgApi'] = (store, context, execution) =>
    this.#projection?.createStoreApi?.(store, context, execution)
  /** Assemble feature methods for the existing transaction view and organization. */
  readonly createOrgTransactionApi: IStorageStoreCell['createOrgTransactionApi'] = (
    scope,
    store,
    context,
    execution
  ) => this.#projection?.createTransactionApi?.(scope, store, context, execution)
  /** Retain the native extension receiver for later organization projection. */
  readonly captureExtension: IStorageStoreCell['captureExtension'] = (key, value, receiver) => {
    this.#extensions.set(key, { value, receiver })
  }
  /** Publish organization-bound extension methods from this registration only. */
  readonly projectExtensions: IStorageStoreCell['projectExtensions'] = (context, assertCurrent) => {
    /** Methods retain their source data receiver together with this immutable organization. */
    const result = Object.create(null)
    for (const key of this.#extensions.keys())
      result[key] = this.projectExtension(key, context, assertCurrent)
    return result
  }
  /** Retain selected feature assembly without replacing the native store. */
  readonly setFeatureProjection: IStorageStoreCell['setFeatureProjection'] = (value) => {
    this.#projection = value
  }
  /** Assemble features for the existing native transaction scope. */
  readonly createTransactionApi: IStorageStoreCell['createTransactionApi'] = (scope) =>
    this.#projection?.createTransactionApi?.(scope)
  /** Return the installed feature methods for the requested query family. */
  readonly getChainMethods: IStorageStoreCell['getChainMethods'] = (family) =>
    this.#projection?.chain?.[family]
  /** Require construction and admission to reference the same native store. */
  readonly bind: IStorageStoreCell['bind'] = (store) => {
    if (this.#value !== undefined && this.#value !== store)
      throw new StorageError(
        StorageErrorCode.backendPluginInvalid,
        {},
        StorageErrorText.backendPluginInvalid
      )
    this.#value = store
  }
  /** Admit the sole successfully constructed native store. */
  readonly set: IStorageStoreCell['set'] = (store) => {
    if (this.#admitted || (this.#value !== undefined && this.#value !== store))
      throw new StorageError(
        StorageErrorCode.backendPluginInvalid,
        {},
        StorageErrorText.backendPluginInvalid
      )
    this.#value = store
    this.#admitted = true
  }
  /** Expose the store only after successful single admission. */
  readonly get: IStorageStoreCell['get'] = () => {
    if (!this.#admitted || this.#value === undefined)
      throw new StorageError(
        StorageErrorCode.backendPluginInvalid,
        {},
        StorageErrorText.backendPluginInvalid
      )
    return this.#value
  }
}
/** Allocate a single registration cell before backend construction begins. */
export function createStorageStoreCell(): IStorageStoreCell {
  return new StorageStoreCell()
}
