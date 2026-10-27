// Metadata keys, index generations, the raw mutation firewall, controller and mutation leases for the IndexedDB backend (see ./indexed-db.ts).
import { isIndexedDbPointRevision } from './indexed-db-revisions.js'
import {
  type IStorageOperationRuntime,
  encodeFlatStorageKey,
  createBackendLifecycleController,
  createStorageToken
} from '@migaia/storage-host/sdk'
import { createStorageAggregateError, StorageError } from '../types/errors.js'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.js'
import { StorageBackend, StorageOperation } from '../constants.js'
import { REPOSITORY_KEY_PREFIX, repositoryMigrationKey } from '@migaia/storage-host/entity'
import { fromIdbRequest } from '../utils/idb-request.js'
import type { IStorageKey } from '../types/context.js'
import type { IRecordIndexHandle } from '@migaia/storage-contract'
import {
  INTERNAL_META_NAMESPACE,
  LEGACY_RECORDS_MIGRATION_MIRROR_KEY,
  RECORD_EPOCH_KEY,
  createIndexGeneration,
  toIdbKey
} from './indexed-db-layout.js'
import type {
  IIndexedDbContext,
  IRawMutationAuthority,
  IMutationLeaseContext
} from './indexed-db.js'

export function recordRevisionKey<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  key: IStorageKey
): IDBValidKey {
  return [indexedDbContext.recordsStoreName, encodeFlatStorageKey(key)]
}

/** Private array key for the current index generation; public metadata strings are data only. */
export function indexMetadataKey(scope: string): IDBValidKey {
  return [INTERNAL_META_NAMESPACE, 'index', scope]
}

/** Recover an internally-owned index scope without trusting forgeable public string keys. */
function readInternalIndexScope(key: IDBValidKey): string | undefined {
  return Array.isArray(key) &&
    key.length === 3 &&
    key[0] === INTERNAL_META_NAMESPACE &&
    key[1] === 'index' &&
    typeof key[2] === 'string'
    ? key[2]
    : undefined
}

/** Identifies one observed owner heartbeat within this IndexedDB context. */
export function backfillTakeoverObservationKey(
  scope: string,
  generation: string,
  ownerToken: string,
  heartbeatRevision: number
): string {
  return `${scope}\u0000${generation}\u0000${ownerToken}\u0000${heartbeatRevision}`
}

/** Discard observations invalidated by a heartbeat revision or generation change. */
export function clearBackfillTakeoverObservations<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  scope: string,
  generation: string
): void {
  const prefix = `${scope}\u0000${generation}\u0000`
  for (const key of indexedDbContext.backfillTakeoverObservations.keys())
    if (key.startsWith(prefix)) indexedDbContext.backfillTakeoverObservations.delete(key)
}

/** Names an archived generation without colliding with the current scope pointer. */
function indexGenerationMetadataKey(scope: string, generation: string): IDBValidKey {
  return [INTERNAL_META_NAMESPACE, 'index-stale', scope, encodeFlatStorageKey(generation)]
}

/** Creates the public error used when a raw mutation has rotated an index handle. */
export function staleIndexHandleError(): StorageError {
  return new StorageError(
    StorageBrowserErrorCode.indexBackfillStale,
    { backend: StorageBackend.indexedDb },
    StorageErrorText.indexBackfillStale
  )
}

/**
 * Scope component of the `{global, scope}` mutation-epoch vector. Bumped atomically with every
 * `runIndexedTransaction` commit that mutates this scope's sidecar rows, so a paginated
 * `iterateRecordIndex` can detect an in-flight write between pages without re-scanning the whole
 * index.
 */
export function indexScopeEpochKey(scope: string): IDBValidKey {
  return ['__storage_web_index_epoch__', scope]
}

/** Separate raw-firewall invalidations from planner writes during backfill. */
export function indexRawEpochKey(scope: string): IDBValidKey {
  return ['__storage_web_raw_epoch__', scope]
}

/**
 * Scoped `META_STORE_NAME` cleanup for a raw `clearRecords`/`clearAll`: deletes only the
 * index-handle/readiness (`index:<scope>`) and repository migration-checkpoint
 * (`repository:<name>:migration`) keys this backend owns, inside the caller's existing transaction.
 * Never touches the backend's own legacy v1-to-v2 migration checkpoint
 * (`LEGACY_RECORDS_MIGRATION_KEY`) — deleting it would make `migrateLegacyRecords` silently re-copy
 * already-cleared legacy `documents` rows back into `records` on the next open — and never touches
 * arbitrary public `metadata` entries, which share this store but are not backend-owned.
 */
export async function deleteOwnedMetaKeys<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  metaStore: IDBObjectStore,
  signal: AbortSignal | undefined,
  runtime: IStorageOperationRuntime
): Promise<void> {
  const keys = (await fromIdbRequest(metaStore.getAllKeys(), { signal }, runtime)) as IDBValidKey[]
  for (const key of keys) {
    if (readInternalIndexScope(key) !== undefined) {
      metaStore.delete(key)
      continue
    }
    if (Array.isArray(key)) continue
    if (typeof key !== 'string') continue
    if (key === LEGACY_RECORDS_MIGRATION_MIRROR_KEY) continue
    if (key.startsWith('index:') || /^repository:.+:migration$/.test(key)) metaStore.delete(key)
  }
}

/**
 * Scoped `REVISIONS_STORE_NAME` cleanup for a raw `clearRecords`/`clearAll`: clears every
 * per-record and per-scope revision/epoch entry, but leaves the global `RECORD_EPOCH_KEY` counter
 * for the caller to read-and-bump atomically in the same transaction.
 */
export async function deleteOwnedRevisionKeys(
  revisionStore: IDBObjectStore,
  signal: AbortSignal | undefined,
  runtime: IStorageOperationRuntime
): Promise<void> {
  const keys = (await fromIdbRequest(
    revisionStore.getAllKeys(),
    { signal },
    runtime
  )) as IDBValidKey[]
  for (const key of keys) {
    if (key === RECORD_EPOCH_KEY) continue
    if (isIndexedDbPointRevision(key, INTERNAL_META_NAMESPACE)) continue
    revisionStore.delete(key)
  }
}

/** Archives the old terminal metadata before publishing a new current-generation pointer. */
export function archiveIndexGeneration<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  metaStore: IDBObjectStore,
  state: Record<string, unknown> | undefined,
  nextGeneration: string
): void {
  if (state === undefined) return
  const handle = state.handle as IRecordIndexHandle | undefined
  if (handle === undefined) return
  metaStore.put(
    {
      ...state,
      currentGeneration: handle.generation,
      stale: true,
      staleBy: nextGeneration,
      lease: undefined,
      issued: undefined
    },
    indexGenerationMetadataKey(handle.scope, handle.generation)
  )
}

/** Rotates one registered scope atomically and returns both generations for sidecar cleanup. */
function rotateIndexGeneration<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  metaStore: IDBObjectStore,
  metadataKey: IDBValidKey,
  state: Record<string, unknown> | undefined
): { readonly oldHandle: IRecordIndexHandle; readonly newHandle: IRecordIndexHandle } | undefined {
  if (state === undefined) return undefined
  const oldHandle = state.handle as IRecordIndexHandle | undefined
  if (oldHandle === undefined) return undefined
  const newHandle = {
    scope: oldHandle.scope,
    generation: createIndexGeneration(),
    fingerprint: oldHandle.fingerprint
  }
  archiveIndexGeneration(indexedDbContext, metaStore, state, newHandle.generation)
  metaStore.put(
    {
      handle: newHandle,
      currentGeneration: newHandle.generation,
      readiness: { status: 'pending', scanned: 0, indexed: 0 }
    },
    metadataKey
  )
  return { oldHandle, newHandle }
}

/** Classify a complete legacy batch once, independent of its physical key ordering. */
export function classifyLegacyMutationBatch(keys: readonly IStorageKey[]): IRawMutationAuthority {
  const scopes = new Set<string>()
  let unscopedPresent = false
  for (const key of keys) {
    if (
      Array.isArray(key) &&
      key.length === 3 &&
      key[0] === REPOSITORY_KEY_PREFIX &&
      typeof key[1] === 'string' &&
      typeof key[2] === 'string'
    )
      scopes.add(key[1])
    else unscopedPresent = true
  }
  return {
    canonicalScopes: [...scopes].sort(),
    unscopedPresent
  }
}

export async function applyRawMutationFirewall<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  metaStore: IDBObjectStore,
  revisionStore: IDBObjectStore,
  sidecarStore: IDBObjectStore | undefined,
  key: IStorageKey | undefined,
  signal: AbortSignal | undefined,
  runtime: IStorageOperationRuntime,
  authority?: IRawMutationAuthority
): Promise<void> {
  if (sidecarStore === undefined) return
  const effectiveAuthority =
    authority ?? classifyLegacyMutationBatch(key === undefined ? [] : [key])
  if (effectiveAuthority.unscopedPresent) {
    const metadataKeys = (await fromIdbRequest(
      metaStore.getAllKeys(),
      { signal },
      runtime
    )) as IDBValidKey[]
    sidecarStore.clear()
    for (const metadataKey of metadataKeys) {
      const metadataScope = readInternalIndexScope(metadataKey)
      if (metadataScope === undefined) continue
      const state = (await fromIdbRequest(metaStore.get(metadataKey), { signal }, runtime)) as
        | Record<string, unknown>
        | undefined
      const handle = state?.handle as IRecordIndexHandle | undefined
      if (handle === undefined || metadataScope !== handle.scope) continue
      rotateIndexGeneration(indexedDbContext, metaStore, metadataKey, state)
      const scope = handle.scope
      const rawEpoch = (await fromIdbRequest(
        revisionStore.get(indexRawEpochKey(scope)) as IDBRequest<number | undefined>,
        { signal },
        runtime
      )) as number | undefined
      revisionStore.put((rawEpoch ?? 0) + 1, indexRawEpochKey(scope))
      const scopeEpoch = (await fromIdbRequest(
        revisionStore.get(indexScopeEpochKey(scope)) as IDBRequest<number | undefined>,
        { signal },
        runtime
      )) as number | undefined
      revisionStore.put((scopeEpoch ?? 0) + 1, indexScopeEpochKey(scope))
    }
    for (const metadataKey of metadataKeys) {
      if (typeof metadataKey === 'string' && /^repository:.+:migration$/.test(metadataKey))
        metaStore.delete(metadataKey)
    }
    return
  }
  for (const canonicalScope of effectiveAuthority.canonicalScopes) {
    const scopeKey = indexMetadataKey(canonicalScope)
    const state = (await fromIdbRequest(metaStore.get(scopeKey), { signal }, runtime)) as
      | Record<string, unknown>
      | undefined
    const handle = state?.handle as IRecordIndexHandle | undefined
    if (handle === undefined) continue
    if (key !== undefined) {
      const oldRows = await fromIdbRequest(
        sidecarStore.index('record').getAllKeys([canonicalScope, handle.generation, toIdbKey(key)]),
        { signal },
        runtime
      )
      for (const oldRow of oldRows as IDBValidKey[]) sidecarStore.delete(oldRow)
    }
    rotateIndexGeneration(indexedDbContext, metaStore, scopeKey, state)
    metaStore.delete(repositoryMigrationKey(canonicalScope))
    const epochKey = indexScopeEpochKey(canonicalScope)
    const epoch = (await fromIdbRequest(
      revisionStore.get(epochKey) as IDBRequest<number | undefined>,
      { signal },
      runtime
    )) as number | undefined
    revisionStore.put((epoch ?? 0) + 1, epochKey)
    const rawEpoch = (await fromIdbRequest(
      revisionStore.get(indexRawEpochKey(canonicalScope)) as IDBRequest<number | undefined>,
      { signal },
      runtime
    )) as number | undefined
    revisionStore.put((rawEpoch ?? 0) + 1, indexRawEpochKey(canonicalScope))
  }
}

/** Open one metadata-owned backfill lease and expose immutable record batches. */
/** A native backfill session owns its existing lease token, heartbeat and checkpoint facts. */

/** Acquire a backfill session through the original controller mutation lease. */

/** Acquire and publish the same metadata-owned session in original native order. */

/** Publish this acquired native session's original maintenance methods. */

export function assertLive<TValue>(indexedDbContext: IIndexedDbContext<TValue>): void {
  indexedDbContext.controller.assertLive()
}

/** Private commit-after controller shared by direct and Host-created exact stores. */
export function createIndexedDbController<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IIndexedDbContext<TValue>['controller'] {
  return (
    indexedDbContext.assemblies.notifications?.controller ?? createBackendLifecycleController
  )({
    backend: StorageBackend.indexedDb,
    platform: indexedDbContext.factory,
    options: {
      dbName: indexedDbContext.dbName,
      kvStoreName: indexedDbContext.kvStoreName,
      bytesStoreName: indexedDbContext.bytesStoreName,
      recordsStoreName: indexedDbContext.recordsStoreName
    },
    origin: `indexeddb:${createStorageToken()}`,
    finalize: async () => {
      /** Cleanup keeps transport and native connection failures in their original order. */
      const failures: unknown[] = []
      if (indexedDbContext.deleting !== undefined) {
        try {
          await indexedDbContext.deleting
        } catch (cause) {
          failures.push(cause)
        }
      }
      try {
        await indexedDbContext.coordination.dispose()
      } catch (cause) {
        failures.push(cause)
      }
      /** Detach cached references once; the original controller still owns this cleanup attempt. */
      const pending = indexedDbContext.connection
      const recoveryDatabase = indexedDbContext.activeDatabase
      indexedDbContext.connection = undefined
      indexedDbContext.activeDatabase = undefined
      let pendingDatabase: IDBDatabase | undefined
      if (pending) {
        // A rejected opening is already observed by preparation; it acquired no closeable result.
        pendingDatabase = await pending.then(
          (database) => database,
          () => undefined
        )
        if (pendingDatabase) {
          const cause = tryCloseDatabase(pendingDatabase)
          if (cause !== undefined) failures.push(cause)
        }
      }
      if (recoveryDatabase && recoveryDatabase !== pendingDatabase) {
        const cause = tryCloseDatabase(recoveryDatabase)
        if (cause !== undefined) failures.push(cause)
      }
      if (failures.length > 0)
        throw createStorageAggregateError(
          StorageBrowserErrorCode.backendDisposeFailed,
          StorageErrorText.backendDisposeFailed,
          failures
        )
    }
  })
}

/** Reject work after disposal begins without invalidating already admitted transactions. */
function assertMutationAdmission<TValue>(indexedDbContext: IIndexedDbContext<TValue>): void {
  indexedDbContext.controller.assertLive()
}

/** Creates the package-private context passed through nested preparation work. */
function createMutationLeaseContext<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>
): IMutationLeaseContext {
  return { [indexedDbContext.mutationLeaseBrand]: true } as IMutationLeaseContext
}

/** Serialize a mutation's complete planner/firewall lifetime under one top-level lease. */
export async function withMutationLease<TValue, T>(
  indexedDbContext: IIndexedDbContext<TValue>,
  run: (lease: IMutationLeaseContext) => Promise<T>
): Promise<T> {
  assertMutationAdmission(indexedDbContext)
  const release = indexedDbContext.controller.beginMutation()
  const lease = createMutationLeaseContext(indexedDbContext)
  try {
    return await run(lease)
  } finally {
    release()
  }
}

/** Reuses an admitted lease for nested preparation, or owns one for standalone maintenance. */
export async function withInternalMutationLease<TValue, T>(
  indexedDbContext: IIndexedDbContext<TValue>,
  run: (lease: IMutationLeaseContext) => Promise<T>,
  inheritedLease?: IMutationLeaseContext
): Promise<T> {
  if (inheritedLease !== undefined) return run(inheritedLease)
  const release = indexedDbContext.controller.beginMutation()
  const lease = createMutationLeaseContext(indexedDbContext)
  try {
    return await run(lease)
  } finally {
    release()
  }
}

/**
 * / change feed: local commit publication plus metadata-only coordination hints. Every publish here
 * happens only after the owning `IDBTransaction` has actually committed (`await committed`), never
 * before, so an aborted/rolled-back IndexedDB transaction fires nothing.
 */

/** Attempt a host close without allowing it to replace the caller's owning failure. */
export function tryCloseDatabase(database: IDBDatabase): unknown | undefined {
  try {
    database.close()
    return undefined
  } catch (cause) {
    return cause
  }
}

/** Close before a required state transition, retaining ownership when the host refuses. */
export function closeForTransition<TValue>(
  indexedDbContext: IIndexedDbContext<TValue>,
  database: IDBDatabase
): void {
  const cause = tryCloseDatabase(database)
  if (cause !== undefined) {
    indexedDbContext.activeDatabase = database
    throw new StorageError(StorageBrowserErrorCode.unavailable, {
      backend: StorageBackend.indexedDb,
      operation: StorageOperation.indexedDbClose,
      cause
    })
  }
  if (indexedDbContext.activeDatabase === database) indexedDbContext.activeDatabase = undefined
}
