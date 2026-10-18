import { snapshotKeyValueStoreDetailed, type IKeyValueStore } from './store.js'
import type { IStorageKey } from './context.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'

export type IStorageChange = {
  readonly sequence: number
  readonly origin: string
  readonly channel: 'value' | 'bytes' | 'record' | 'all'
  readonly kind: 'put' | 'remove' | 'clear' | 'batch' | 'migrate'
  readonly scope?: string
  readonly keys?: readonly IStorageKey[]
}

export type IChangeFeedStore = IKeyValueStore & {
  subscribeChanges(listener: (change: IStorageChange) => void): () => void
}

/** Compose base admission once and preserve extension-accessor failures for assertions. */
const inspectChangeFeedStore = (store: unknown) => {
  /** Base admission owns the shared callable/capability checks and their original failure. */
  const snapshot = snapshotKeyValueStoreDetailed(store)
  if (!snapshot.valid) return snapshot
  try {
    if (
      snapshot.capabilities.changeFeed === true &&
      typeof (store as Record<string, unknown>).subscribeChanges === 'function'
    )
      return snapshot
    return { valid: false as const, cause: undefined }
  } catch (cause) {
    return { valid: false as const, cause }
  }
}

/** Narrow a key-value store to the post-commit change-feed capability. */
export const isChangeFeedStore = (store: unknown): store is IChangeFeedStore =>
  inspectChangeFeedStore(store).valid

/** Return the change-feed capability or throw contract unsupported when it is incomplete. */
export const asChangeFeedStore = (store: IKeyValueStore): IChangeFeedStore => {
  /** Keep the one-read result so a failed getter remains reachable through the contract error. */
  const inspection = inspectChangeFeedStore(store)
  if (!inspection.valid)
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: undefined,
      cause: inspection.cause
    })
  return store as IChangeFeedStore
}
