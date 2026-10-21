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
export type IKeyValueStore = {
  /** Provider family label, used for diagnostics rather than extension admission. */
  readonly backend: IBackendKind
  /** Declared support facts. Runtime guards verify this descriptor and required methods together. */
  readonly capabilities: IStorageCapabilities

  /** Reads the string-value channel; a missing key resolves to null. The provider interprets ctx. */
  get(key: string, ctx?: IOperationContext): Promise<string | null>
  /** Writes a string value with optional operation timing and conflict options. */
  set(key: string, value: string, ctx?: IWriteOptions): Promise<void>
  /** Removes one string-channel entry without accessing record keys. */
  remove(key: string, ctx?: IOperationContext): Promise<void>
  /** Resolves whether a string-channel key exists. */
  has(key: string, ctx?: IOperationContext): Promise<boolean>
  /** Lists currently visible string-channel keys. Opaque provider entries may remain invisible. */
  keys(ctx?: IOperationContext): Promise<string[]>
  /** Clears only this store's string values. */
  clearValues(ctx?: IOperationContext): Promise<void>
  /** Clears this store's public value channels; structured extensions also clear bytes and records. */
  clearAll(ctx?: IOperationContext): Promise<void>
  /** Releases the provider-owned store lifetime; later operations follow STORE_DISPOSED semantics. */
  dispose(): Promise<void>

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
  /** Clears the byte channel without clearing string values or records. */
  clearBytes(ctx?: IOperationContext): Promise<void>
  /** Reads a structured record by storage key, resolving to undefined when missing. */
  getRecord(key: IStorageKey, ctx?: IOperationContext): Promise<TValue | undefined>
  /** Writes a record and resolves its key; omitting key requests provider-defined key generation. */
  putRecord(value: TValue, key?: IStorageKey, ctx?: IWriteOptions): Promise<IStorageKey>
  /** Deletes one structured record. */
  deleteRecord(key: IStorageKey, ctx?: IOperationContext): Promise<void>
  /** Clears records while leaving the other public channels intact. */
  clearRecords(ctx?: IOperationContext): Promise<void>
  /** Clears string values, bytes, and records owned by this store. */
  clearAll(ctx?: IOperationContext): Promise<void>
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
  ): AsyncIterableIterator<[IStorageKey, TValue]>
  /**
   * Executes work with a provider-owned transaction scope and returns its result; isolation is
   * implementation-defined.
   */
  transaction<T>(
    run: (tx: ITransactionScope<TValue>) => Promise<T>,
    ctx?: IOperationContext
  ): Promise<T>
}

const BACKEND_KINDS = new Set<IBackendKind>(['memory', 'local', 'session', 'cookie', 'indexeddb'])

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
  const candidate = store as Record<string, unknown>
  let backend: unknown
  let capabilitiesValue: unknown
  let methods: unknown[]
  let dispose: unknown
  try {
    if (typeof store !== 'object' || store === null || Array.isArray(store))
      return {
        valid: false,
        backend: undefined,
        capabilities: undefined,
        dispose: undefined,
        cause: undefined
      }
    backend = candidate.backend
    capabilitiesValue = candidate.capabilities
    methods = ['get', 'set', 'remove', 'has', 'keys', 'clearValues', 'clearAll'].map(
      (name) => candidate[name]
    )
    dispose = candidate.dispose
    methods.push(dispose)
    if (records)
      methods.push(
        ...[
          'getBytes',
          'setBytes',
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
  const normalizedBackend = BACKEND_KINDS.has(backend as IBackendKind)
    ? (backend as IBackendKind)
    : undefined
  const capabilitiesInspection = snapshotStorageCapabilitiesDetailed(capabilitiesValue)
  const capabilities = capabilitiesInspection.value
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
    dispose: typeof dispose === 'function' ? (dispose as () => Promise<void>) : undefined,
    cause: capabilitiesInspection.cause
  }
}

/**
 * Inspects a provider once before a lifecycle owner accepts it. Required methods must be callable,
 * backend must be known, and capabilities must be valid. No storage or dispose method is invoked.
 * Success returns original store/receiver plus captured facts; failure returns valid false with the
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
 * Tests a complete base key-value shape without running provider operations. Unknown backend
 * labels, invalid capability descriptors, missing methods, and throwing accessors return false.
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
