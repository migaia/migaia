import type { ITransactionOptions, IWriteConcurrencyOptions } from './concurrency.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import {
  isStorageCapabilities,
  snapshotStorageCapabilities,
  type IBackendKind,
  type IStorageCapabilities
} from './capabilities.js'
import type {
  IKeyRange,
  IOperationContext,
  IStorageKey,
  ISyncWriteOptions,
  IWriteOptions
} from './context.js'
import type { ITransactionScope } from './transaction.js'
import { isBackendKind } from './backend.js'
import type { IStorageResource, IStorageIterator } from './resource.js'
import { STORAGE_KEY_VALUE_BASE_METHODS } from './capability-constants.js'

/** Runtime-neutral resource identity and facts; specialized stores need no KV methods. */
export type IStorageBase = IStorageResource & {
  readonly backend: IBackendKind
  readonly capabilities: IStorageCapabilities
}

/** Read-only base admission captures exact cleanup functions without taking ownership. */
export type IStorageBaseAdmission =
  | {
      readonly valid: true
      readonly store: IStorageBase
      readonly backend: IBackendKind
      readonly capabilities: IStorageCapabilities
      readonly dispose: () => Promise<void>
      readonly receiver: object
      readonly asyncDispose?: () => Promise<void>
    }
  | { readonly valid: false; readonly cause: unknown }

/** Pure resource shape admission with the caller's fixed cleanup identity. */
function hasStorageBaseShape(
  store: unknown,
  asyncDisposeKey: symbol | undefined
): store is IStorageBase {
  if (typeof store !== 'object' || store === null || Array.isArray(store)) return false
  /** The provider is borrowed; shape inspection neither clones facts nor invokes cleanup. */
  const candidate = store as Record<PropertyKey, unknown>
  return (
    isBackendKind(candidate.backend) &&
    isStorageCapabilities(candidate.capabilities) &&
    typeof candidate.dispose === 'function' &&
    (asyncDisposeKey === undefined || typeof candidate[asyncDisposeKey] === 'function')
  )
}

/**
 * Checks a specialized resource without requiring KV methods or copying its facts. The supplied
 * cleanup symbol is authoritative; without a native symbol only explicit disposal is required.
 */
export function isStorageBase(
  store: unknown,
  options?: { readonly asyncDisposeKey?: typeof Symbol.asyncDispose }
): store is IStorageBase {
  /** The outer host may supply its canonical identity; no fallback symbol is allocated here. */
  const asyncDisposeKey: symbol | undefined = options?.asyncDisposeKey ?? Symbol.asyncDispose
  return (
    (asyncDisposeKey === undefined || typeof asyncDisposeKey === 'symbol') &&
    hasStorageBaseShape(store, asyncDisposeKey)
  )
}

/**
 * Captures exact resource functions and detached scalar facts before host lifecycle admission can
 * await. Admission borrows the original receiver without taking cleanup ownership.
 */
export function snapshotStorageBaseDetailed(
  store: unknown,
  options?: { readonly asyncDisposeKey?: typeof Symbol.asyncDispose }
): IStorageBaseAdmission {
  /** The captured key keeps later cleanup independent of native symbol discovery. */
  const asyncDisposeKey: symbol | undefined = options?.asyncDisposeKey ?? Symbol.asyncDispose
  if (
    (asyncDisposeKey !== undefined && typeof asyncDisposeKey !== 'symbol') ||
    !hasStorageBaseShape(store, asyncDisposeKey)
  )
    return { valid: false, cause: undefined }
  /** Only the host snapshot detaches facts; the pure shape guard retains no descriptor. */
  const capabilities = snapshotStorageCapabilities(store.capabilities)!
  /** This exact method is borrowed together with its original provider receiver. */
  const dispose = store.dispose
  /** A fixed symbol may differ from the native key on the original provider. */
  const asyncDispose =
    asyncDisposeKey === undefined
      ? undefined
      : (store as unknown as Record<symbol, () => Promise<void>>)[asyncDisposeKey]
  return {
    valid: true,
    store,
    backend: store.backend,
    capabilities,
    dispose,
    receiver: store,
    ...(asyncDispose === undefined ? {} : { asyncDispose })
  }
}

/**
 * Exposes the synchronous channel only on synchronous backends. The backend drives it directly, and
 * asynchronous methods wrap it.
 */
export type ISyncKeyValueStore = {
  /** Reads a string value, returning null when the key is absent. */
  get(key: string): string | null
  /** Writes a string under a string key with optional reduced conflict options. */
  set(key: string, value: string, options?: ISyncWriteOptions): void
  /** Removes the value under this string key. */
  remove(key: string): void
  /** Reports whether this string key currently exists. */
  has(key: string): boolean
  /** Lists keys in this provider's string-value channel. */
  keys(): string[]
  /** Clears the string-value channel without clearing separate byte or record channels. */
  clearValues(): void
}

/** Defines the L0 string key-value channel implemented by every backend. */
export type IKeyValueStore = IStorageBase & {
  /** Reads the string-value channel; a missing key resolves to null. The provider interprets ctx. */
  get(key: string, ctx?: IOperationContext): Promise<string | null>
  /** Writes a string value with optional operation timing and conflict options. */
  set(key: string, value: string, ctx?: IWriteOptions): Promise<void>
  /** Removes one string-channel entry without accessing record keys. */
  remove(key: string, ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  /** Resolves whether a string-channel key exists. */
  has(key: string, ctx?: IOperationContext): Promise<boolean>
  /** Lists currently visible string-channel keys. Opaque provider entries may remain invisible. */
  keys(ctx?: IOperationContext): Promise<string[]>
  /** Clears only this store's string values. */
  clearValues(ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  /** Clears this store's public value channels; structured extensions also clear bytes and records. */
  clearAll(ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>

  /**
   * Exists only on synchronous backends. Asynchronous backends such as IndexedDB expose
   * `undefined`.
   */
  readonly sync?: ISyncKeyValueStore
}

/**
 * Requires the `sync` channel on a variant of `IKeyValueStore`. Factory functions for localStorage,
 * sessionStorage, memoryStorage, and cookies use it for their return types.
 */
export type ISyncCapableStore<TStore extends { readonly sync?: object }> = TStore & {
  /**
   * Required synchronous channel; this type refinement does not create or validate an
   * implementation.
   */
  readonly sync: NonNullable<TStore['sync']>
}

/** Defines the additional L1 byte and object channels supplied by structured backends. */
export type IRecordStore<TValue = unknown> = IKeyValueStore & {
  /** Reads bytes by string key, resolving to null when missing. */
  getBytes(key: string, ctx?: IOperationContext): Promise<Uint8Array | null>
  /**
   * Writes bytes using optional timing and conflict options; data ownership belongs to the provider
   * contract.
   */
  setBytes(key: string, value: Uint8Array, ctx?: IWriteOptions): Promise<void>
  /**
   * Deletes only this key's byte entry, preserving text and records. Missing byte entries succeed
   * without mutation; asynchronous backends resolve only after the deletion commits.
   */
  removeBytes(key: string, ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  /** Clears the byte channel without clearing string values or records. */
  clearBytes(ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  /** Reads a structured record by storage key, resolving to undefined when missing. */
  getRecord(key: IStorageKey, ctx?: IOperationContext): Promise<TValue | undefined>
  /** Writes a record and resolves its key; omitting key requests provider-defined key generation. */
  putRecord(value: TValue, key?: IStorageKey, ctx?: IWriteOptions): Promise<IStorageKey>
  /** Deletes one structured record. */
  deleteRecord(key: IStorageKey, ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  /** Clears records while leaving the other public channels intact. */
  clearRecords(ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  /** Clears string values, bytes, and records owned by this store. */
  clearAll(ctx?: IOperationContext & IWriteConcurrencyOptions): Promise<void>
  /** Optional backend-owned metadata channel used by resumable maintenance migrations. */
  readonly metadata?: {
    /** Reads backend-owned maintenance metadata; a missing value resolves to undefined. */
    get(key: string, ctx?: IOperationContext): Promise<unknown | undefined>
    /** Writes backend-owned maintenance metadata under a string key. */
    set(key: string, value: unknown, ctx?: IWriteOptions): Promise<void>
    /** Removes one maintenance metadata entry. */
    delete(key: string, ctx?: IOperationContext): Promise<void>
  }
  /**
   * Iterates matching key/record pairs; omitted range requests the provider's unbounded record
   * scan.
   */
  iterateRecords(
    range?: IKeyRange,
    ctx?: IOperationContext
  ): IStorageIterator<[IStorageKey, TValue]>
  /**
   * Executes work with a provider-owned transaction scope and returns its result; isolation is
   * implementation-defined.
   */
  transaction<TResult>(
    run: (tx: ITransactionScope<TValue>) => TResult,
    ctx?: ITransactionOptions
  ): Promise<Awaited<TResult>>
}

type IStoreShapeInspection = {
  readonly valid: boolean
  readonly backend: IBackendKind | undefined
  readonly capabilities: IStorageCapabilities | undefined
  readonly dispose: (() => Promise<void>) | undefined
  readonly cause: unknown
}

/**
 * Result of one base-store inspection. Success retains the original store/receiver, captured
 * capabilities, and original dispose function; failure identifies an ordinary invalid shape. These
 * records do not freeze or wrap the provider and do not prove its asynchronous behavior.
 */
export type IKeyValueStoreAdmission =
  | {
      /** Discriminates a complete base shape from failed admission. */
      readonly valid: true
      /** Original provider object, without cloning or proxying its operations. */
      readonly store: IKeyValueStore
      /** Backend label captured during this inspection. */
      readonly backend: IBackendKind
      /** Independent descriptor for deferred host routing, including normalized legacy flags. */
      readonly capabilities: IStorageCapabilities
      /** Original dispose method; its receiver is supplied separately for lifecycle integration. */
      readonly dispose: () => Promise<void>
      /** Original object that owns the captured dispose method. */
      readonly receiver: object
    }
  | {
      /** Failed ordinary shape admission. */
      readonly valid: false
      /** Undefined for an ordinary shape mismatch. */
      readonly cause: unknown
    }

/** Required record operations are a fixed shape, independent of any native implementation. */
const STORAGE_RECORD_METHODS = [
  'getBytes',
  'setBytes',
  'removeBytes',
  'clearBytes',
  'getRecord',
  'putRecord',
  'deleteRecord',
  'clearRecords',
  'iterateRecords',
  'transaction'
] as const

/** Pure shape inspection shares record requirements without cloning provider facts. */
export const inspectStoreShape = (store: unknown, records: boolean): IStoreShapeInspection => {
  if (!isStorageBase(store))
    return {
      valid: false,
      backend: undefined,
      capabilities: undefined,
      dispose: undefined,
      cause: undefined
    }
  /** Public methods are checked without invoking or wrapping them. */
  const candidate = store as unknown as Record<string, unknown>
  /** Facts remain borrowed here; only the host snapshot detaches them for deferred admission. */
  const capabilities = store.capabilities
  return {
    valid:
      STORAGE_KEY_VALUE_BASE_METHODS.every((name) => typeof candidate[name] === 'function') &&
      (!records ||
        (capabilities.records &&
          capabilities.binary &&
          capabilities.transactions &&
          capabilities.iteration &&
          STORAGE_RECORD_METHODS.every((name) => typeof candidate[name] === 'function'))),
    backend: store.backend,
    capabilities,
    dispose: store.dispose,
    cause: undefined
  }
}

/**
 * Inspects a provider before a lifecycle owner accepts it. Required methods must be callable,
 * backend syntax and capabilities must be valid. No storage or dispose method is invoked. Success
 * returns original store/receiver plus captured facts; failure returns valid false with the
 * ordinary shape-mismatch data. The result record is not frozen.
 */
export const snapshotKeyValueStoreDetailed = (store: unknown): IKeyValueStoreAdmission => {
  const inspection = inspectStoreShape(store, false)
  if (
    !inspection.valid ||
    inspection.backend === undefined ||
    inspection.capabilities === undefined ||
    inspection.dispose === undefined
  )
    return { valid: false, cause: inspection.cause }
  return {
    valid: true,
    store: store as IKeyValueStore,
    backend: inspection.backend,
    capabilities: snapshotStorageCapabilities(inspection.capabilities)!,
    dispose: inspection.dispose,
    receiver: store as object
  }
}

/**
 * Returns a new base-store inspection record with the original store, backend, and captured
 * capabilities, or undefined for invalid shapes. No I/O is performed. The record is not frozen; use
 * snapshotKeyValueStoreDetailed when a failure cause is needed.
 */
export const snapshotKeyValueStore = (
  store: unknown
):
  | {
      readonly store: IKeyValueStore
      readonly backend: IBackendKind
      readonly capabilities: IStorageCapabilities
    }
  | undefined => {
  const inspection = snapshotKeyValueStoreDetailed(store)
  if (!inspection.valid) return undefined
  return {
    store: inspection.store,
    backend: inspection.backend,
    capabilities: inspection.capabilities
  }
}

/**
 * Inspects the full record-store shape without running operations. Requires a valid base
 * store, callable byte/record/iteration/transaction methods, and four corresponding true capability
 * flags. Returns original store plus captured facts, or undefined on a shape mismatch. The returned
 * description and capability records are not frozen.
 */
export const snapshotRecordStore = <T = unknown>(
  store: unknown
):
  | {
      readonly store: IRecordStore<T>
      readonly backend: IBackendKind
      readonly capabilities: IStorageCapabilities
    }
  | undefined => {
  const inspection = inspectStoreShape(store, true)
  if (!inspection.valid || inspection.capabilities === undefined) return undefined
  return {
    store: store as IRecordStore<T>,
    backend: inspection.backend!,
    capabilities: snapshotStorageCapabilities(inspection.capabilities)!
  }
}

/**
 * Tests a complete base key-value shape without running provider operations. Invalid backend
 * syntax, invalid capability descriptors, and missing methods return false. This proves structural
 * admission, not that promises, persistence, or backend semantics work.
 */
export const isKeyValueStore = (store: unknown): store is IKeyValueStore =>
  inspectStoreShape(store, false).valid

/**
 * Returns the same provider as a record store after full shape and capability admission. Use before
 * depending on bytes, records, iteration, or transactions. No operation is invoked. Missing
 * capabilities/methods throw UNSUPPORTED_CAPABILITY rather than silently degrading.
 */
export const asRecordStore = <T = unknown>(store: IKeyValueStore): IRecordStore<T> => {
  const inspection = inspectStoreShape(store, true)
  if (!inspection.valid)
    throw new StorageContractError(StorageContractErrorCode.unsupported, {
      backend: inspection.backend,
      cause: inspection.cause
    })
  return store as IRecordStore<T>
}

/** Same full admission as asRecordStore, returning false instead of throwing when the shape fails. */
export const isRecordStore = (store: IKeyValueStore): store is IRecordStore =>
  inspectStoreShape(store, true).valid
