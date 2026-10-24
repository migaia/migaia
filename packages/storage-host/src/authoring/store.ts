import {
  type IStorageBaseAdmission,
  isStorageBase,
  type IKeyValueStore,
  type IRecordStore,
  type IKeyValueStoreAdmission,
  inspectStoreShape,
  type IBackendKind,
  type IStorageCapabilities,
  type IStorageCapabilitiesInspection,
  isStorageCapabilities
} from '@migaia/storage-contract'

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
  if (!isStorageBase(store, { asyncDisposeKey: asyncDisposeKey as typeof Symbol.asyncDispose }))
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
 * Inspects the full record-store shape without running operations. Requires a valid base store,
 * callable byte/record/iteration/transaction methods, and four corresponding true capability flags.
 * Returns original store plus captured facts, or undefined on a shape mismatch. The returned
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

/** Captures scalar capability facts for a later host route decision. */
export const snapshotStorageCapabilitiesDetailed = (
  value: unknown
): IStorageCapabilitiesInspection => ({
  value: snapshotStorageCapabilities(value),
  cause: undefined
})

/**
 * Detaches capability facts before a host consumer awaits. Legacy secondaryIndexes/changeFeed
 * omissions become false; the pure guard above remains the only scalar validation rule.
 */
export const snapshotStorageCapabilities = (value: unknown): IStorageCapabilities | undefined => {
  if (!isStorageCapabilities(value)) return undefined
  return {
    syncRead: value.syncRead,
    binary: value.binary,
    records: value.records,
    transactions: value.transactions,
    iteration: value.iteration,
    maxValueBytes: value.maxValueBytes,
    opaqueEntries: value.opaqueEntries,
    secondaryIndexes: value.secondaryIndexes ?? false,
    changeFeed: value.changeFeed ?? false,
    ...(value.batch === undefined ? {} : { batch: value.batch })
  }
}
