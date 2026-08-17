import type { IBackendKind } from './capabilities.js';
import type { IStorageKey } from './context.js';
import { StorageErrorCode, type IStorageErrorCode } from '../error-code.js';

export { StorageErrorCode, type IStorageErrorCode };

/** `source` value stamped onto every error this package throws. */
export const STORAGE_WEB_SOURCE = '@migaia/storage-web';

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
  readonly source: string;
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
    this.source = STORAGE_WEB_SOURCE;
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
