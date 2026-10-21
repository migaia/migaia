import type { IAbortSignal } from '@migaia/utils/promise'
import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError
} from '@migaia/storage-contract'
import { raceWithAbort, UtilsAbortError } from '@migaia/utils/promise'
import { UtilsErrorCode } from '@migaia/utils/error'
import {
  createStorageOperationRuntime,
  type IStorageOperationRuntime
} from '../core/operation-reporter.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { assertOperationContext, throwIfAborted } from '../core/operation.js'

/** One declared version step; the signal belongs to the caller's existing operation. */
export type IMigrationContext = {
  /** Version immediately before this step. */
  readonly fromVersion: number
  /** Version produced by this step. */
  readonly toVersion: number
  /** Optional operation signal for cooperative migration cancellation. */
  readonly signal?: IAbortSignal
}

/** Runs migrations asynchronously so they can read other storage or make requests. */
export type IMigration = (previous: unknown, ctx: IMigrationContext) => Promise<unknown>

/**
 * Run own migration steps in ascending version order with one operation reporter. Version numbers
 * must be non-negative safe integers; fromVersion >= toVersion returns the same value after input
 * and cancellation admission. Missing steps are no-ops here, unlike a declared entity's complete
 * migration graph. Cancellation keeps the storage-contract ABORTED identity; step failure rejects
 * MIGRATION_FAILED without rolling back external effects performed by user callbacks.
 */
export const runMigrations = async (
  value: unknown,
  fromVersion: number,
  toVersion: number,
  migrations: Record<number, IMigration> | undefined,
  signal?: IAbortSignal
): Promise<unknown> => {
  const runtime = createStorageOperationRuntime()
  return runMigrationsWithRuntime(runtime, value, fromVersion, toVersion, migrations, signal)
}

/**
 * Uses the owning operation's runtime without creating another reporter. Runs declared migrations
 * in order from `fromVersion` to `toVersion`. A missing version's migration means the data shape is
 * unchanged and is a no-op. A failure for one record does not affect other records because the
 * caller catches failures per record. This function normalizes errors within one call.
 */
export const runMigrationsWithRuntime = async (
  runtime: IStorageOperationRuntime,
  value: unknown,
  fromVersion: number,
  toVersion: number,
  migrations: Record<number, IMigration> | undefined,
  signal?: IAbortSignal
): Promise<unknown> => {
  void runtime
  if (!Number.isSafeInteger(fromVersion) || fromVersion < 0)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new RangeError('migration fromVersion must be a non-negative safe integer')
    })
  if (!Number.isSafeInteger(toVersion) || toVersion < 0)
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new RangeError('migration toVersion must be a non-negative safe integer')
    })
  if (
    migrations !== undefined &&
    (typeof migrations !== 'object' || migrations === null || Array.isArray(migrations))
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('migrations must be an object')
    })
  assertOperationContext(signal === undefined ? undefined : { signal })
  throwIfAborted(signal)
  if (fromVersion >= toVersion) return value
  let current = value
  for (let version = fromVersion + 1; version <= toVersion; version += 1) {
    let migration: IMigration | undefined
    try {
      migration =
        migrations !== undefined && Object.hasOwn(migrations, version)
          ? migrations[version]
          : undefined
    } catch (cause) {
      throw new StorageError(StorageErrorCode.invalidConfig, { cause })
    }
    if (migration === undefined) continue
    if (typeof migration !== 'function')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(`migration ${version} must be a function`)
      })
    try {
      const migrationContext = signal
        ? { fromVersion: version - 1, toVersion: version, signal }
        : { fromVersion: version - 1, toVersion: version }
      const result = Promise.resolve().then(() => migration(current, migrationContext))
      if (!signal) {
        current = await result
        continue
      }
      current = await raceWithAbort(() => result, {
        signal,
        cleanupPolicy: 'report',
        report: (cause) => runtime.reporter(cause)
      })
    } catch (cause) {
      if (cause instanceof UtilsAbortError)
        throw new StorageContractError(StorageContractErrorCode.aborted, {
          cause: cause.cause
        })
      if (
        cause &&
        typeof cause === 'object' &&
        'code' in cause &&
        cause.code === UtilsErrorCode.invalidArgument
      )
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
      if (isStorageContractError(cause)) throw cause
      if (cause instanceof StorageError && cause.code === StorageErrorCode.invalidConfig)
        throw cause
      throw new StorageError(StorageErrorCode.migrationFailed, { cause })
    }
  }
  return current
}
