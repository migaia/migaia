import {
  StorageContractError,
  StorageContractErrorCode,
  isStorageContractError
} from '@migaia/storage-contract';
import { isStorageErrorFamily } from './error-family.js';
import type { IStorageOperationRuntime } from './operation-reporter.js';
import type { IBackendKind } from '../types/capabilities.js';
import {
  StorageError,
  StorageErrorCode,
  type IExtensionStage,
  type IStorageErrorCode
} from '../types/errors.js';
import { readAbortReason, subscribeToAbort, type IWebAbortSignal } from './operation.js';

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
  try {
    if (!signal) return await Promise.resolve().then(fn);
    const result = Promise.resolve().then(fn);
    /** Owns the shared race-safe abort subscription until extension settlement. */
    let disposeAbort = (): void => {};
    const aborted = new Promise<never>((_, reject) => {
      disposeAbort = subscribeToAbort(
        signal,
        () => {
          reject(
            new StorageContractError(StorageContractErrorCode.aborted, {
              backend,
              cause: readAbortReason(signal)
            })
          );
        },
        runtime.reporter
      );
    });
    try {
      return await Promise.race([result, aborted]);
    } finally {
      disposeAbort();
    }
  } catch (error) {
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
