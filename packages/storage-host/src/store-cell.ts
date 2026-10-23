import type { IChainMethods, IStorageBase, IStorageResource } from '@migaia/storage-contract'
import { createErrorCollector } from '@migaia/lifecycle'
import { StorageError, StorageErrorCode, STORAGE_HOST_SOURCE } from './errors.js'
import { StorageErrorText } from './error-text.js'
import type { IStorageFeatureProjection } from './feature-install.js'
import type {
  IStorageOrgBinding,
  IStorageBorrowedBackend,
  IStoragePluginCallContext,
  IStorageExecutionPort
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
/** Preserve the original install handoff without letting a Feature replace its store. */
export function createStorageStoreCell(): IStorageStoreCell {
  /** The same store pointer survives construction binding and the final admitted handoff. */
  let value: IStorageBase | undefined
  /** Construction binding must agree with the one eventual admitted store. */
  let admitted = false
  /** Selected Feature output is owned by this same original registration, without a scope table. */
  let projection: IStorageFeatureProjection | undefined
  /** Optional native projection belongs to this same single-assignment store cell. */
  let orgBinding: IStorageOrgBinding | undefined
  /** The descriptor's one private journal binding shares this original single-assignment cell. */
  let journalBinding: IStorageJournalBackendBinding | undefined
  /** Dynamic journal handles are released by the one original install-time disposal callback. */
  const journalResources = new Map<IStorageResource, () => Promise<void>>()
  /** Only this registration's original extension methods need organization rebinding. */
  const extensions = new Map<PropertyKey, { readonly value: unknown; readonly receiver: object }>()
  /** Each organization retains one business view, avoiding per-lookup resource aliases. */
  const orgViews = new Map<string, IStorageBorrowedBackend>()
  /** Exact aliases are released by the registration's existing resource scope. */
  const orgReleases: Array<() => void | Promise<void>> = []
  return {
    journalIdentity: Object.freeze({}),
    retainJournalResource: (resource) => {
      if (journalResources.has(resource)) return () => undefined
      let dispose: IStorageResource['dispose']
      try {
        dispose = resource?.dispose
      } catch (cause) {
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
      }
      if (typeof dispose !== 'function')
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      const release = () => Reflect.apply(dispose, resource, [])
      journalResources.set(resource, release)
      return () => {
        if (journalResources.get(resource) === release) journalResources.delete(resource)
      }
    },
    releaseJournalResources: async () => {
      const releases = [...journalResources.values()]
      journalResources.clear()
      const errors = createErrorCollector('throw', undefined)
      for (let index = releases.length - 1; index >= 0; index--) {
        try {
          await releases[index]!()
        } catch (error) {
          errors.add(STORAGE_HOST_SOURCE, error)
        }
      }
      errors.finalize(StorageErrorText.storageHostDisposeFailed)
    },
    setJournalBinding: (binding) => {
      if (journalBinding !== undefined)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      journalBinding = snapshotStorageJournalBinding(binding)
    },
    journalForOrg: (orgId) => {
      if (journalBinding === undefined)
        throw new StorageContractError(StorageContractErrorCode.unsupported)
      const { forOrg: _forOrg, ...projected } = snapshotStorageJournalBinding(
        journalBinding.forOrg(orgId)
      )
      return Object.freeze(projected)
    },
    projectOrgBackend: (orgId, create) => {
      const existing = orgViews.get(orgId)
      if (existing !== undefined) return existing
      const view = create()
      orgViews.set(orgId, view)
      return view
    },
    retainOrgBinding: (release) => {
      orgReleases.push(release)
    },
    releaseOrgBindings: async () => {
      const errors = createErrorCollector('throw', undefined)
      for (const release of orgReleases.splice(0)) {
        try {
          await release()
        } catch (error) {
          errors.add(STORAGE_HOST_SOURCE, error)
        }
      }
      orgViews.clear()
      errors.finalize(StorageErrorText.storageHostDisposeFailed)
    },
    setOrgBinding: (binding) => {
      if (orgBinding !== undefined)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      orgBinding = binding
    },
    forOrg: (orgId, defaultOrgId) => {
      if (orgBinding !== undefined) return orgBinding.backend(orgId)
      if (orgId === defaultOrgId) return value!
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    },
    dropOrg: (orgId) =>
      orgBinding === undefined
        ? Promise.reject(new StorageContractError(StorageContractErrorCode.unsupported))
        : orgBinding.drop(orgId),
    createOrgApi: (store, context, execution) =>
      projection?.createStoreApi?.(store, context, execution),
    createOrgTransactionApi: (scope, store, context, execution) =>
      projection?.createTransactionApi?.(scope, store, context, execution),
    captureExtension: (key, value, receiver) => {
      extensions.set(key, { value, receiver })
    },
    projectExtension,
    projectExtensions: (context, assertCurrent) => {
      /** Methods retain their source data receiver together with this immutable organization. */
      const result = Object.create(null)
      for (const key of extensions.keys())
        result[key] = projectExtension(key, context, assertCurrent)
      return Object.freeze(result)
    },
    setFeatureProjection: (value) => {
      projection = value
    },
    createTransactionApi: (scope) => projection?.createTransactionApi?.(scope),
    getChainMethods: (family) => projection?.chain?.[family],
    bind(store) {
      if (value !== undefined && value !== store)
        throw new StorageError(
          StorageErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      value = store
    },
    set(store) {
      if (admitted || (value !== undefined && value !== store))
        throw new StorageError(
          StorageErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      value = store
      admitted = true
    },
    get() {
      if (!admitted || value === undefined)
        throw new StorageError(
          StorageErrorCode.backendPluginInvalid,
          {},
          StorageErrorText.backendPluginInvalid
        )
      return value
    }
  }

  /** Capture one source receiver and org without rereading the caller's descriptors. */
  function projectExtension(
    key: PropertyKey,
    context: IStoragePluginCallContext,
    assertCurrent: () => void
  ): unknown {
    const entry = extensions.get(key)!
    if (typeof entry.value !== 'function') return entry.value
    const receiver = Object.assign(Object.create(entry.receiver), context)
    return (...args: unknown[]) => {
      assertCurrent()
      return Reflect.apply(entry.value as Function, receiver, args)
    }
  }
}
