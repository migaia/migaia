import {
  collectUniqueIndexOwners as collectOwners,
  invokeExtension as invokeHostExtension,
  isStorageErrorFamily as isHostErrorFamily,
  normalizeError as normalizeHostError,
  planChannelWrite as planWrite,
  subscribeToAbort as subscribeHostAbort,
  type IChannelMutationPlan,
  type IChannelPresence,
  type IStorageErrorFamily as IHostErrorFamily,
  type IStorageOperationReporter,
  type IStorageOperationRuntime,
  type IUniqueIndexOwner
} from '@migaia/storage-host/sdk'
import type {
  IBackendKind,
  IRecordIndexDefinition,
  IRecordIndexProjection,
  IStorageKey
} from '@migaia/storage-contract'
import type { IAbortSignal } from '@migaia/utils/promise'
import { markRecordIndexBackfillContentionFailure } from '@migaia/storage-host/entity'
import {
  StorageError,
  StorageErrorCode,
  type IExtensionStage,
  type IStorageChannel,
  type IStorageErrorCode
} from '../types/errors.js'
import { StorageBackend, StorageConflictPolicy, type IStorageConflictPolicy } from '../constants.js'
import { indexUniqueConflictText } from '../error-text.js'

/** Web errors join the host's canonical family without changing any owner's error identity. */
export type IStorageErrorFamily = IHostErrorFamily<StorageError>

/** The backend class predicate is the only Web-specific admission supplied to shared helpers. */
const isWebError = (value: unknown): value is StorageError => value instanceof StorageError

/** Preserve the original host, contract or Web diagnostic at a backend normalization boundary. */
export const isStorageErrorFamily = (value: unknown): value is IStorageErrorFamily =>
  isHostErrorFamily(value, isWebError)

/** Unknown failures receive the Web source while the canonical family remains unchanged. */
export const normalizeError = (
  error: unknown,
  backend: IBackendKind,
  code: IStorageErrorCode = StorageErrorCode.transactionFailed,
  operation?: string,
  extensionStage?: IExtensionStage
): IStorageErrorFamily =>
  normalizeHostError(
    error,
    (cause) => new StorageError(code, { backend, cause, operation, extensionStage }),
    isWebError
  )

/** Shared extension execution delegates only Web context attachment to this backend boundary. */
export const invokeExtension = <T>(
  fn: () => T | Promise<T>,
  backend: IBackendKind,
  operation: string,
  extensionStage: IExtensionStage,
  signal: IAbortSignal | undefined,
  runtime: IStorageOperationRuntime
): Promise<T> =>
  invokeHostExtension(
    fn,
    backend,
    operation,
    extensionStage,
    signal,
    runtime,
    (error, op, stage) => {
      if (error instanceof StorageError) {
        if (error.operation !== undefined && error.extensionStage !== undefined) return error
        return new StorageError(
          error.code,
          {
            backend: error.backend ?? backend,
            key: error.key,
            existingChannel: error.existingChannel,
            attemptedChannel: error.attemptedChannel,
            operation: error.operation ?? op,
            extensionStage: error.extensionStage ?? stage,
            cause: error
          },
          error.message
        )
      }
      return normalizeError(error, backend, StorageErrorCode.extensionFailed, op, stage)
    }
  )

/** A Web error thrown by an abort callback keeps its source and exact identity. */
export const subscribeToAbort = (
  signal: IAbortSignal | undefined,
  onAbort: () => void,
  reporter: IStorageOperationReporter
): (() => void) => subscribeHostAbort(signal, onAbort, reporter, isWebError)

/** Cross-channel planning stays shared; the conflict diagnostic belongs to the Web backend. */
export const planChannelWrite = (
  key: IStorageKey,
  attempted: IStorageChannel,
  existing: IChannelPresence,
  policy: IStorageConflictPolicy = StorageConflictPolicy.conflict,
  backend: IBackendKind
): IChannelMutationPlan =>
  planWrite(
    key,
    attempted,
    existing,
    policy,
    backend,
    (details) => new StorageError(StorageErrorCode.duplicateKey, details)
  )

/** Unique-key collection supplies Web-owned errors while retaining the shared final-state rules. */
export const collectUniqueIndexOwners = (
  definitions: readonly IRecordIndexDefinition[],
  records: Iterable<{ readonly key: IStorageKey; readonly projection: IRecordIndexProjection }>,
  backend: IBackendKind
): ReadonlyMap<string, IUniqueIndexOwner> =>
  collectOwners(definitions, records, backend, {
    invalidConfig: (owner) => new StorageError(StorageErrorCode.invalidConfig, { backend: owner }),
    uniqueConflict: (owner, key, indexName) =>
      new StorageError(
        StorageErrorCode.indexUniqueConflict,
        { backend: owner, key },
        indexUniqueConflictText(indexName)
      )
  })

/** Preserve the native Web contention diagnostic while the host owns its private classification. */
export const createBackfillContentionFailure = (): StorageError => {
  /** This original error remains reachable unchanged through an entity fallback decision. */
  const failure = new StorageError(StorageErrorCode.unavailable, {
    backend: StorageBackend.indexedDb
  })
  markRecordIndexBackfillContentionFailure(failure)
  return failure
}
