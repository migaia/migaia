import type { ITransactionOptions, IWriteConcurrencyOptions } from './concurrency.js'
import { StorageContractError, StorageContractErrorCode } from './errors.js'
import {
  snapshotStorageCapabilitiesDetailed,
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
import { STORAGE_KEY_VALUE_METHODS } from './capability-constants.js'

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

/** Shared field inspection checks a supplied fixed symbol without creating a fallback. */
function inspectStorageBase(
  store: unknown,
  asyncDisposeKey: symbol | undefined
): IStorageBaseAdmission {
  try {
    if (typeof store !== 'object' || store === null || Array.isArray(store))
      return { valid: false, cause: undefined }
    /** Each base property is read once before normalization or callable admission. */
    const candidate = store as Record<PropertyKey, unknown>
    /** Backend labels select diagnostics, never runtime permissions. */
    const backend = candidate.backend
    /** Individual fact fields reuse the existing capability inspector. */
    const declaredCapabilities = candidate.capabilities
    /** Cleanup is borrowed and never invoked by admission. */
    const dispose = candidate.dispose
    /** The fixed symbol is captured by the caller and never rediscovered later. */
    const asyncDispose = asyncDisposeKey === undefined ? undefined : candidate[asyncDisposeKey]
    /** Getter failures remain the exact original cause rather than escaping the guard. */
    const capabilities = snapshotStorageCapabilitiesDetailed(declaredCapabilities)
    if (
      !isBackendKind(backend) ||
      !capabilities.value ||
      typeof dispose !== 'function' ||
      (asyncDisposeKey !== undefined && typeof asyncDispose !== 'function')
    )
      return { valid: false, cause: capabilities.cause }
    return {
      valid: true,
      store: store as IStorageBase,
      backend,
      capabilities: capabilities.value,
      dispose: dispose as () => Promise<void>,
      receiver: store,
      ...(asyncDispose === undefined ? {} : { asyncDispose: asyncDispose as () => Promise<void> })
    }
  } catch (cause) {
    return { valid: false, cause }
  }
}

/**
 * Admits the original resource base without I/O, cleanup or ownership transfer. The outer host may
 * supply its canonical async-dispose key; absent native symbols promise only explicit cleanup.
 */
export function snapshotStorageBaseDetailed(
  store: unknown,
  options?: { readonly asyncDisposeKey?: typeof Symbol.asyncDispose }
): IStorageBaseAdmission {
  try {
    /** Capture the outer fixed key or native key once; no fallback symbol is allocated here. */
    const asyncDisposeKey: symbol | undefined = options?.asyncDisposeKey ?? Symbol.asyncDispose
    if (asyncDisposeKey !== undefined && typeof asyncDisposeKey !== 'symbol')
      return { valid: false, cause: undefined }
    return inspectStorageBase(store, asyncDisposeKey)
  } catch (cause) {
    return { valid: false, cause }
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
  /** Reads one native text snapshot, retaining input order, duplicates and undefined missing rows. */
  getMany(
    keys: readonly IStorageKey[],
    ctx?: IOperationContext
  ): Promise<readonly (string | undefined)[]>
  /** Atomically writes a batch in one native operation; canonical duplicate keys reject before I/O. */
  setMany(
    entries: readonly {
      readonly key: IStorageKey
      readonly value: string
      readonly ttlMs?: number
    }[],
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<void>
  /** Atomically removes distinct canonical text keys and returns the actual deleted count. */
  removeMany(
    keys: readonly IStorageKey[],
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<number>
  /** Removes only matching text keys using the canonical prefix range in the current organization. */
  removeByPrefix(
    prefix: IStorageKey,
    ctx?: IOperationContext & IWriteConcurrencyOptions
  ): Promise<number>
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
 * capabilities, and original dispose function; failure retains the exact reflection/getter cause.
 * These records do not freeze or wrap the provider and do not prove its asynchronous behavior.
 */
export type IKeyValueStoreAdmission =
  | {
      /** Discriminates a complete base shape from failed admission. */
      readonly valid: true
      /** Original provider object, without cloning or proxying its operations. */
      readonly store: IKeyValueStore
      /** Backend label captured during this inspection. */
      readonly backend: IBackendKind
      /** Independent descriptor captured once, including normalized legacy capability flags. */
      readonly capabilities: IStorageCapabilities
      /** Original dispose method; its receiver is supplied separately for lifecycle integration. */
      readonly dispose: () => Promise<void>
      /** Original object that owns the captured dispose method. */
      readonly receiver: object
    }
  | {
      /** Failed shape admission, without throwing a reflected provider failure. */
      readonly valid: false
      /** Exact accessor/reflection failure, or undefined for an ordinary shape mismatch. */
      readonly cause: unknown
    }

/** Internal admission owner shared by record extensions; retain reflection and getter failures. */
export const inspectStoreShape = (store: unknown, records: boolean): IStoreShapeInspection => {
  /** Original KV admission shares one base-field owner before inspecting its callable API. */
  const base = inspectStorageBase(store, Symbol.asyncDispose)
  if (!base.valid)
    return {
      valid: false,
      backend: undefined,
      capabilities: undefined,
      dispose: undefined,
      cause: base.cause
    }
  /** Only KV-specific members remain to be inspected. */
  const candidate = store as Record<string, unknown>
  let methods: unknown[]
  try {
    methods = STORAGE_KEY_VALUE_METHODS.map((name) => candidate[name])
    methods.push(base.dispose)
    if (records)
      methods.push(
        ...[
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
        ].map((name) => candidate[name])
      )
  } catch (cause) {
    return {
      valid: false,
      backend: undefined,
      capabilities: undefined,
      dispose: undefined,
      cause
    }
  }
  const normalizedBackend = base.backend
  const capabilities = base.capabilities
  const validCapabilities =
    capabilities !== undefined &&
    (!records ||
      (capabilities.records &&
        capabilities.binary &&
        capabilities.transactions &&
        capabilities.iteration))
  return {
    valid:
      normalizedBackend !== undefined &&
      validCapabilities &&
      methods.every((method) => typeof method === 'function'),
    backend: normalizedBackend,
    capabilities,
    dispose: base.dispose,
    cause: undefined
  }
}

/**
 * Inspects a provider once before a lifecycle owner accepts it. Required methods must be callable,
 * backend syntax and capabilities must be valid. No storage or dispose method is invoked. Success
 * returns original store/receiver plus captured facts; failure returns valid false with the
 * original getter/reflection cause when present. The result record is not frozen.
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
    capabilities: inspection.capabilities,
    dispose: inspection.dispose,
    receiver: store as object
  }
}

/**
 * Returns a new base-store inspection record with the original store, backend, and captured
 * capabilities, or undefined for invalid shapes and throwing accessors. No I/O is performed. The
 * record is not frozen; use snapshotKeyValueStoreDetailed when a failure cause is needed.
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
 * Inspects the full record-store shape once without running operations. Requires a valid base
 * store, callable byte/record/iteration/transaction methods, and four corresponding true capability
 * flags. Returns original store plus captured facts, or undefined on mismatch/accessor failure. The
 * returned description and capability records are not frozen.
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
    capabilities: inspection.capabilities
  }
}

/**
 * Tests a complete base key-value shape without running provider operations. Invalid backend
 * syntax, invalid capability descriptors, missing methods, and throwing accessors return false.
 * This proves structural admission, not that promises, persistence, or backend semantics work.
 */
export const isKeyValueStore = (store: unknown): store is IKeyValueStore =>
  inspectStoreShape(store, false).valid

/**
 * Returns the same provider as a record store after full shape and capability admission. Use before
 * depending on bytes, records, iteration, or transactions. No operation is invoked. Missing
 * capabilities/methods throw UNSUPPORTED_CAPABILITY rather than silently degrading; an
 * accessor/reflection failure remains the exact cause on StorageContractError.
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
