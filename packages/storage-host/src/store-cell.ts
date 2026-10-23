import type { IChainMethods, IStorageBase } from '@migaia/storage-contract'
import { StorageError, StorageErrorCode } from './errors.js'
import { StorageErrorText } from './error-text.js'
import type { IStorageFeatureProjection } from './feature-install.js'
import type {
  IStorageOrgBinding,
  IStorageBorrowedBackend,
  IStoragePluginCallContext,
  IStorageExecutionPort
} from './types.js'
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'
/** One registration binds one construction identity and publishes it only after admission. */
export type IStorageStoreCell = {
  bind(store: IStorageBase): void
  set(store: IStorageBase): void
  get(): IStorageBase
  setFeatureProjection(projection: IStorageFeatureProjection | undefined): void
  createTransactionApi(scope: object): object | undefined
  getChainMethods(family: keyof IChainMethods): object | undefined
  setOrgBinding(binding: IStorageOrgBinding): void
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
  retainOrgBinding(release: () => void): void
  releaseOrgBindings(): void
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
  /** Only this registration's original extension methods need organization rebinding. */
  const extensions = new Map<PropertyKey, { readonly value: unknown; readonly receiver: object }>()
  /** Each organization retains one business view, avoiding per-lookup resource aliases. */
  const orgViews = new Map<string, IStorageBorrowedBackend>()
  /** Exact aliases are released by the registration's existing resource scope. */
  const orgReleases: Array<() => void> = []
  return {
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
    releaseOrgBindings: () => {
      for (const release of orgReleases.splice(0)) release()
      orgViews.clear()
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
