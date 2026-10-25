import { isKeyValueStore, type IKeyValueStore } from './store.js'
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

/** Checks the base shape and native feed ports without capturing or invoking them. */
const hasChangeFeedShape = (store: unknown): store is IChangeFeedStore =>
  isKeyValueStore(store) &&
  store.capabilities.changeFeed === true &&
  typeof (store as unknown as Record<string, unknown>).subscribeChanges === 'function' &&
  typeof (store as unknown as Record<string, unknown>).watch === 'function'

/**
 * Checks base store admission, a true changeFeed flag, and callable subscribeChanges/watch methods.
 * Returns false for malformed objects. No operation or subscription starts.
 */
export function isChangeFeedStore<S extends Omit<IKeyValueStore, 'use'>>(
  store: S
): store is IWithChangeFeedCapabilities<S> & ITextChangeFeedApi & S
/** Unknown-input inspection retains the original real callable/base admission. */
export function isChangeFeedStore(store: unknown): store is IChangeFeedStore
/** Inspects the original store without creating subscriptions or replacing its object. */
export function isChangeFeedStore(store: unknown): store is IChangeFeedStore {
  return hasChangeFeedShape(store)
}

/**
 * Returns the original store with its change-feed type after the same checks as isChangeFeedStore.
 * Use before subscribing without tying a consumer to a concrete provider. Missing capability or
 * method throws UNSUPPORTED_CAPABILITY.
 */
export function asChangeFeedStore<S extends Omit<IKeyValueStore, 'use'>>(
  store: S
): IWithChangeFeedCapabilities<S> & ITextChangeFeedApi {
  if (!hasChangeFeedShape(store))
    throw new StorageContractError(StorageContractErrorCode.unsupported, { backend: undefined })
  return store as IWithChangeFeedCapabilities<S> & ITextChangeFeedApi
}
