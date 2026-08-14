import type { IBackendKind } from '../types/capabilities';
import {
  StorageError,
  StorageErrorCode,
  type IExtensionStage,
  type IStorageErrorCode
} from '../types/errors';
import { readAbortReason, subscribeToAbort } from './operation';

/** Normalize an extension or backend failure without discarding its original cause. */
export const normalizeError = (
  error: unknown,
  backend: IBackendKind,
  code: IStorageErrorCode = StorageErrorCode.transactionFailed,
  operation?: string,
  extensionStage?: IExtensionStage
): StorageError => {
  if (error instanceof StorageError) return error;
  return new StorageError(code, { backend, cause: error, operation, extensionStage });
};

/** Execute developer-provided extension code behind one stable error boundary. */
export const invokeExtension = async <T>(
  fn: () => T | Promise<T>,
  backend: IBackendKind,
  operation: string,
  extensionStage: IExtensionStage,
  signal?: AbortSignal
): Promise<T> => {
  try {
    if (!signal) return await Promise.resolve().then(fn);
    const result = Promise.resolve().then(fn);
    /** Owns the shared race-safe abort subscription until extension settlement. */
    let disposeAbort = (): void => {};
    const aborted = new Promise<never>((_, reject) => {
      disposeAbort = subscribeToAbort(signal, () => {
        reject(
          new StorageError(StorageErrorCode.aborted, {
            backend,
            operation,
            extensionStage,
            cause: readAbortReason(signal)
          })
        );
      });
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
    throw normalizeError(
      error,
      backend,
      StorageErrorCode.extensionFailed,
      operation,
      extensionStage
    );
  }
};
