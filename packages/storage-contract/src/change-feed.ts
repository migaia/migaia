import { snapshotKeyValueStoreDetailed, type IKeyValueStore } from './store.js'
import type { IStorageKey, IOperationContext } from './context.js'
import type { IStorageIterator } from './resource.js'
import type { IWithChangeFeedCapabilities } from './backend.js'
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
  /** A reset without orgId invalidates every organization; routed resets affect that org only. */
  readonly kind: 'put' | 'remove' | 'clear' | 'batch' | 'migrate' | 'reset'
  /** Optional provider-defined scope associated with this invalidation. */
  readonly scope?: string
  /** Optional affected keys; omission supplies no exact key list. */
  readonly keys?: readonly IStorageKey[]
}

/** Native text invalidations are not a durable event log or a query result stream. */
export type ITextWatchApi = {
  watch(key: string, ctx?: IOperationContext): IStorageIterator<IStorageChange>
}
/** The original observer and its native stream share one backend provider owner. */
export type ITextChangeFeedApi = ITextWatchApi & {
  /** Registers a change observer and returns its unsubscribe function; dispatch is provider-owned. */
  subscribeChanges(listener: (change: IStorageChange) => void): () => void
}
/** Extend the original admitted KV API without creating a second controller or subscription owner. */
export type IChangeFeedStore = IKeyValueStore & ITextChangeFeedApi

/** Compose base admission once and preserve extension-accessor failures for assertions. */
const inspectChangeFeedStore = (store: unknown) => {
  /** Base admission owns the shared callable/capability checks and their original failure. */
  const snapshot = snapshotKeyValueStoreDetailed(store)
  if (!snapshot.valid) return snapshot
  try {
    if (snapshot.capabilities.changeFeed !== true)
      return { valid: false as const, cause: undefined }
    /** Both public native functions are borrowed once and never executed during inspection. */
    const subscribeChanges = (store as Record<string, unknown>).subscribeChanges
    const watch = (store as Record<string, unknown>).watch
    if (typeof subscribeChanges === 'function' && typeof watch === 'function') return snapshot
    return { valid: false as const, cause: undefined }
  } catch (cause) {
    return { valid: false as const, cause }
  }
}

/**
 * Checks base store admission, a true changeFeed flag, and callable subscribeChanges/watch methods.
 * Returns false for malformed objects or throwing accessors. No operation or subscription starts.
 */
export function isChangeFeedStore<S extends Omit<IKeyValueStore, 'use'>>(
  store: S
): store is IWithChangeFeedCapabilities<S> & ITextChangeFeedApi & S
/** Unknown-input inspection retains the original real callable/base admission. */
export function isChangeFeedStore(store: unknown): store is IChangeFeedStore
/** Reads the actual original store once without creating subscriptions or replacing its object. */
export function isChangeFeedStore(store: unknown): store is IChangeFeedStore {
  return inspectChangeFeedStore(store).valid
}

/**
 * Returns the original store with its change-feed type after the same checks as isChangeFeedStore.
 * Use before subscribing without tying a consumer to a concrete provider. Missing capability or
 * method throws UNSUPPORTED_CAPABILITY; the exact accessor/reflection failure stays on cause.
 */
export function asChangeFeedStore<S extends Omit<IKeyValueStore, 'use'>>(
  store: S
): IWithChangeFeedCapabilities<S> & ITextChangeFeedApi {
  /** Keep the one-read result so a failed getter remains reachable through the contract error. */
  const inspection = inspectChangeFeedStore(store)
  if (!inspection.valid)
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: undefined,
      cause: inspection.cause
    })
  return store as IWithChangeFeedCapabilities<S> & ITextChangeFeedApi
}
