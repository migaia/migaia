import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError
} from '@migaia/storage-contract';
import { raceWithAbort, UtilsAbortError } from '@migaia/utils/promise';
import { UtilsErrorCode } from '@migaia/utils/error';
import { isStorageErrorFamily } from './error-family.js';
import type { IStorageOperationRuntime } from './operation-reporter.js';
import type { IBackendKind } from '../types/capabilities.js';
import {
  StorageError,
  StorageErrorCode,
  type IExtensionStage,
  type IStorageErrorCode
} from '../types/errors.js';
import { throwIfAborted, type IWebAbortSignal } from './operation.js';

/** Normalize an extension or backend failure without discarding its original cause. */
export const normalizeError = (
  error: unknown,
  backend: IBackendKind,
  code: IStorageErrorCode = StorageErrorCode.transactionFailed,
  operation?: string,
  extensionStage?: IExtensionStage
): StorageError | StorageContractError => {
  if (isStorageErrorFamily(error)) return error;
  return new StorageError(code, { backend, cause: error, operation, extensionStage });
};

/** Execute developer-provided extension code behind one stable error boundary. */
export const invokeExtension = async <T>(
  fn: () => T | Promise<T>,
  backend: IBackendKind,
  operation: string,
  extensionStage: IExtensionStage,
  signal: IWebAbortSignal | undefined,
  runtime: IStorageOperationRuntime
): Promise<T> => {
  void runtime;
  try {
    if (!signal) return await Promise.resolve().then(fn);
    // Preserve storage's hostile-signal boundary: a throwing `aborted` getter is invalid input,
    // not an extension failure. `raceWithAbort` cannot classify that package-specific contract.
    throwIfAborted(signal);
    const result = Promise.resolve().then(fn);
    return await raceWithAbort(() => result, {
      signal,
      cleanupPolicy: 'report',
      report: (error) => runtime.reporter(error)
    });
  } catch (error) {
    if (error instanceof UtilsAbortError)
      throw new StorageContractError(StorageContractErrorCode.aborted, {
        backend,
        cause: error.cause
      });
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === UtilsErrorCode.invalidArgument
    )
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend,
        cause: error
      });
    if (error instanceof StorageError) {
      if (error.operation !== undefined && error.extensionStage !== undefined) throw error;
      throw new StorageError(error.code, {
        backend: error.backend ?? backend,
        key: error.key,
        existingChannel: error.existingChannel,
        attemptedChannel: error.attemptedChannel,
        operation: error.operation ?? operation,
        extensionStage: error.extensionStage ?? extensionStage,
        cause: error.cause ?? error
      });
    }
    if (isStorageContractError(error)) throw error;
    throw normalizeError(
      error,
      backend,
      StorageErrorCode.extensionFailed,
      operation,
      extensionStage
    );
  }
};
