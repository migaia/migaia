import { StorageError as HostStorageError } from '@migaia/storage-host'
import { StorageErrorText } from '../error-text.ts'
import type { IBackendKind } from './capabilities.ts'
import type { IStorageKey } from './context.ts'
import { STORAGE_BROWSER_ERROR_SOURCE } from '@migaia/storage-contract/error-code'
import type { IStorageBrowserErrorCode } from '@migaia/storage-contract/error-code'

/**
 * Optional diagnostic context for a frozen StorageError; nested values and cause retain their
 * original identity.
 */
export type IStorageErrorDetails = {
  /** Backend whose operation failed, when known. */
  readonly backend?: IBackendKind
  /** Logical key associated with this failure. */
  readonly key?: string | IStorageKey
  /** Channel already occupying a conflicting logical key. */
  readonly existingChannel?: IStorageChannel
  /** Channel the rejected mutation attempted to use. */
  readonly attemptedChannel?: IStorageChannel
  /** Schema, codec, migration, comparator or diagnostic extension that failed. */
  readonly extensionStage?: IExtensionStage
  /** Operation name attached by the owning boundary. */
  readonly operation?: string
  /** Original failure retained for bounded cause-chain inspection. */
  readonly cause?: unknown
}

/** Native admission error enriched with this package's stable boundary identity. */
export type IStorageTypeError = TypeError & {
  readonly source: string
  readonly code: IStorageBrowserErrorCode
}

/** Native generic error enriched with this package's stable boundary identity. */
export type IStorageNativeError = Error & {
  readonly source: string
  readonly code: IStorageBrowserErrorCode
}

/** Native range error enriched with this package's stable boundary identity. */
export type IStorageRangeError = RangeError & {
  readonly source: string
  readonly code: IStorageBrowserErrorCode
}

/** Attach the public package identity without replacing the supplied native error instance. */
const attachStorageErrorIdentity = <T extends Error>(
  error: T,
  code: IStorageBrowserErrorCode
): T & { readonly source: string; readonly code: IStorageBrowserErrorCode } => {
  Object.defineProperty(error, 'source', {
    configurable: false,
    enumerable: false,
    value: STORAGE_BROWSER_ERROR_SOURCE,
    writable: false
  })
  Object.defineProperty(error, 'code', {
    configurable: false,
    enumerable: false,
    value: code,
    writable: false
  })
  return error as T & { readonly source: string; readonly code: IStorageBrowserErrorCode }
}

/** Create a coded native Error for internal failures that may cross the package boundary. */
export const createStorageError = (
  code: IStorageBrowserErrorCode,
  message: string,
  cause?: unknown
): IStorageNativeError =>
  attachStorageErrorIdentity(new Error(message, cause === undefined ? undefined : { cause }), code)

/** Create a coded native RangeError while preserving its runtime prototype. */
export const createStorageRangeError = (
  code: IStorageBrowserErrorCode,
  message: string,
  cause?: unknown
): IStorageRangeError =>
  attachStorageErrorIdentity(
    new RangeError(message, cause === undefined ? undefined : { cause }),
    code
  )

/**
 * Native aggregate carrying storage-plugin-browser identity while preserving every cleanup failure
 * object.
 */
export type IStorageAggregateError = AggregateError & {
  readonly source: string
  readonly code: IStorageBrowserErrorCode
}

/**
 * Creates one coded native AggregateError whose cause and errors retain the first/original
 * failures.
 */
export const createStorageAggregateError = (
  code: IStorageBrowserErrorCode,
  message: string,
  errors: readonly unknown[]
): IStorageAggregateError => {
  const aggregate = new AggregateError(errors, message, {
    cause: errors[0]
  }) as IStorageAggregateError
  Object.defineProperty(aggregate, 'source', {
    configurable: false,
    enumerable: false,
    value: STORAGE_BROWSER_ERROR_SOURCE,
    writable: false
  })
  Object.defineProperty(aggregate, 'code', {
    configurable: false,
    enumerable: false,
    value: code,
    writable: false
  })
  return aggregate
}

/**
 * Creates a native TypeError while attaching the package source/code without replacing its native
 * prototype or its exact cause. Host descriptor and store admission use this helper so callers can
 * branch on TypeError and still traverse the original failure.
 */
export const createStorageTypeError = (
  code: IStorageBrowserErrorCode,
  message: string,
  cause?: unknown
): IStorageTypeError => {
  return attachStorageErrorIdentity(
    new TypeError(message, cause === undefined ? undefined : { cause }),
    code
  )
}

/** Value, bytes or structured-record channel sharing one logical key conflict domain. */
export type IStorageChannel = 'value' | 'bytes' | 'record'
/** Shared extension stages retain the host execution owner's exact diagnostic vocabulary. */
export type IExtensionStage = NonNullable<
  import('@migaia/storage-host').IStorageErrorDetails['extensionStage']
>

/**
 * The storage-host error class with this package's error domain as source. Branch on `code`; the
 * original failure stays on `cause`.
 */
export class StorageError extends HostStorageError<IStorageBrowserErrorCode> {
  /** Attach the browser domain and this package's default message. */
  constructor(
    code: IStorageBrowserErrorCode,
    details: IStorageErrorDetails = {},
    message?: string,
    stage?: 'decode' | 'migrate' | 'validate'
  ) {
    super(
      code,
      details,
      message ?? StorageErrorText.defaultError(code),
      stage,
      STORAGE_BROWSER_ERROR_SOURCE
    )
  }
}
