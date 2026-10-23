import type { IAbortSignal } from '@migaia/utils/promise'
import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError
} from '@migaia/storage-contract'
import { raceWithAbort, UtilsAbortError } from '@migaia/utils/promise'
import { UtilsErrorCode, tryReadProperty } from '@migaia/utils/error'

import { reportCleanupError, type IStorageOperationRuntime } from './operation-reporter.js'
import type { IBackendKind } from '@migaia/storage-contract'
import { StorageError, StorageErrorCode, type IExtensionStage } from '../errors.js'
import { throwIfAborted } from './operation.js'

/** Execute developer-provided extension code behind one stable error boundary. */
export const invokeExtension = async <T>(
  fn: () => T | Promise<T>,
  backend: IBackendKind,
  operation: string,
  extensionStage: IExtensionStage,
  signal: IAbortSignal | undefined,
  runtime: IStorageOperationRuntime,
  normalizeFailure?: (error: unknown, operation: string, extensionStage: IExtensionStage) => Error
): Promise<T> => {
  try {
    if (!signal) return await Promise.resolve().then(fn)
    // Preserve storage's hostile-signal boundary: a throwing `aborted` getter is invalid input,
    // not an extension failure. `raceWithAbort` cannot classify that package-specific contract.
    throwIfAborted(signal)
    const result = Promise.resolve().then(fn)
    return await raceWithAbort(() => result, {
      signal,
      cleanupPolicy: 'report',
      report: (error) => runtime.reporter(error)
    })
  } catch (error) {
    if (error instanceof UtilsAbortError)
      throw new StorageContractError(StorageContractErrorCode.aborted, {
        backend,
        cause: error.cause
      })
    if (error && typeof error === 'object') {
      /** Preserve the primary failure if its diagnostic property cannot be inspected. */
      const code = tryReadProperty(error as { readonly code?: unknown }, 'code')
      if (code.threw) reportCleanupError(runtime.reporter, code.error)
      else if (code.value === UtilsErrorCode.invalidArgument)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
          backend,
          cause: error
        })
    }
    if (error instanceof StorageError) {
      if (error.operation !== undefined && error.extensionStage !== undefined) throw error
      /** Attach operation context with the original owner and keep its exact failure on cause. */
      const details = {
        backend: error.backend ?? backend,
        key: error.key,
        existingChannel: error.existingChannel,
        attemptedChannel: error.attemptedChannel,
        operation: error.operation ?? operation,
        extensionStage: error.extensionStage ?? extensionStage,
        cause: error
      }
      throw new StorageError(error.code, details, error.message)
    }
    if (isStorageContractError(error)) throw error
    if (normalizeFailure !== undefined) throw normalizeFailure(error, operation, extensionStage)
    throw new StorageError(StorageErrorCode.extensionFailed, {
      backend,
      cause: error,
      operation,
      extensionStage
    })
  }
}
