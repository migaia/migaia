import type { IBackendKind } from './capabilities';
import type { IStorageKey } from './context';

export const StorageErrorCode = Object.freeze({
  unavailable: 'BACKEND_UNAVAILABLE', // 隐私模式、被禁用、无 IndexedDB
  quotaExceeded: 'QUOTA_EXCEEDED',
  valueTooLarge: 'VALUE_TOO_LARGE', // 超出单值上限（cookie 4KB）
  unsupported: 'UNSUPPORTED_CAPABILITY',
  serializeFailed: 'SERIALIZE_FAILED',
  deserializeFailed: 'DESERIALIZE_FAILED',
  validationFailed: 'VALIDATION_FAILED',
  migrationFailed: 'MIGRATION_FAILED',
  transactionFailed: 'TRANSACTION_FAILED',
  aborted: 'ABORTED',
  disposed: 'STORE_DISPOSED',
  duplicateKey: 'DUPLICATE_KEY',
  invalidArgument: 'INVALID_ARGUMENT',
  invalidKey: 'INVALID_KEY',
  versionUnsupported: 'VERSION_UNSUPPORTED',
  extensionFailed: 'EXTENSION_FAILED',
  transactionConflict: 'TRANSACTION_CONFLICT',
  writeFailed: 'WRITE_FAILED',
  cookieScopeAmbiguous: 'COOKIE_SCOPE_AMBIGUOUS'
} as const);

export type IStorageErrorCode = (typeof StorageErrorCode)[keyof typeof StorageErrorCode];

export type IStorageErrorDetails = {
  readonly backend?: IBackendKind;
  readonly key?: string | IStorageKey;
  readonly existingChannel?: IStorageChannel;
  readonly attemptedChannel?: IStorageChannel;
  readonly extensionStage?: IExtensionStage;
  readonly operation?: string;
  readonly cause?: unknown;
};

export type IStorageChannel = 'value' | 'bytes' | 'record';
export type IExtensionStage = 'schema' | 'codec' | 'migration' | 'comparator' | 'diagnostic';

/** 所有后端异常的统一归一化形态。原始异常一律进 cause，不改写其 message。 */
export class StorageError extends Error {
  readonly code: IStorageErrorCode;
  readonly backend?: IBackendKind;
  readonly key?: string | IStorageKey;
  readonly existingChannel?: IStorageChannel;
  readonly attemptedChannel?: IStorageChannel;
  readonly extensionStage?: IExtensionStage;
  readonly operation?: string;
  /** Internal repository stage used to apply invalid-record policy. */
  readonly stage?: 'decode' | 'migrate' | 'validate';

  constructor(
    code: IStorageErrorCode,
    details: IStorageErrorDetails = {},
    message?: string,
    stage?: 'decode' | 'migrate' | 'validate'
  ) {
    super(message ?? `[storage-web] ${code}`, { cause: details.cause });
    this.name = 'StorageError';
    this.code = code;
    this.backend = details.backend;
    this.key = details.key;
    this.existingChannel = details.existingChannel;
    this.attemptedChannel = details.attemptedChannel;
    this.extensionStage = details.extensionStage;
    this.operation = details.operation;
    this.stage = stage;
    Object.freeze(this);
  }
}
