import { snapshotKeyValueStoreDetailed, type IKeyValueStore } from './store.js'
import type { IStorageKey } from './context.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'

/** Post-commit invalidation description, not a stored value or a guaranteed replayable event log. */
export type IStorageChange = {
  /**
   * Provider-supplied sequence value; ordering and delivery guarantees belong to the
   * implementation.
   */
  readonly sequence: number
  /** Provider-supplied identity of the change's origin. */
  readonly origin: string
  /** Optional organization identity supplied by the original host context; never a routing grant. */
  readonly orgId?: string
  /** Affected public channel: value, bytes, record, or all for a broad invalidation. */
  readonly channel: 'value' | 'bytes' | 'record' | 'all'
  /** Operation category: put, remove, clear, batch, or migrate. */
  readonly kind: 'put' | 'remove' | 'clear' | 'batch' | 'migrate'
  /** Optional provider-defined scope associated with this invalidation. */
  readonly scope?: string
  /** Optional affected keys; omission supplies no exact key list. */
  readonly keys?: readonly IStorageKey[]
}

/** Key-value provider extension for post-commit invalidation notifications. */
export type IChangeFeedStore = IKeyValueStore & {
  /** Registers a change observer and returns its unsubscribe function; dispatch is provider-owned. */
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

/**
 * Checks base store admission, a true changeFeed flag, and a callable subscribeChanges method.
 * Returns false for malformed objects or throwing accessors. No operation or subscription starts.
 */
export const isChangeFeedStore = (store: unknown): store is IChangeFeedStore =>
  inspectChangeFeedStore(store).valid

/**
 * Returns the original store with its change-feed type after the same checks as isChangeFeedStore.
 * Use before subscribing without tying a consumer to a concrete provider. Missing capability or
 * method throws UNSUPPORTED_CAPABILITY; the exact accessor/reflection failure stays on cause.
 */
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
