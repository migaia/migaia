import { snapshotKeyValueStore, type IKeyValueStore } from './store.js'
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

const inspectChangeFeedStore = (store: unknown) => {
  const snapshot = snapshotKeyValueStore(store)
  if (snapshot === undefined) return false
  try {
    return (
      snapshot.capabilities.changeFeed === true &&
      typeof (store as Record<string, unknown>).subscribeChanges === 'function'
    )
  } catch {
    return false
  }
}

/** Narrow a key-value store to the post-commit change-feed capability. */
export const isChangeFeedStore = (store: unknown): store is IChangeFeedStore =>
  inspectChangeFeedStore(store)

/** Return the change-feed capability or throw contract unsupported when it is incomplete. */
export const asChangeFeedStore = (store: IKeyValueStore): IChangeFeedStore => {
  if (!inspectChangeFeedStore(store))
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: undefined
    })
  return store as IChangeFeedStore
}
