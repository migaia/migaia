import type { IBackendKind } from '@migaia/storage-contract'
import type { IStorageKey } from '@migaia/storage-contract'
import { StorageErrorCode, type IStorageErrorCode } from './error-code.js'
import { StorageErrorText } from './error-text.js'

export { StorageErrorCode, type IStorageErrorCode }

/** `source` value stamped onto every error this package throws. */
export const STORAGE_HOST_SOURCE = '@migaia/storage-host'

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
  readonly code: IStorageErrorCode
}

/** Native generic error enriched with this package's stable boundary identity. */
export type IStorageNativeError = Error & {
  readonly source: string
  readonly code: IStorageErrorCode
}

/** Native range error enriched with this package's stable boundary identity. */
export type IStorageRangeError = RangeError & {
  readonly source: string
  readonly code: IStorageErrorCode
}

/** Attach the public package identity without replacing the supplied native error instance. */
const attachStorageErrorIdentity = <T extends Error>(
  error: T,
  code: IStorageErrorCode
): T & { readonly source: string; readonly code: IStorageErrorCode } => {
  Object.defineProperty(error, 'source', {
    configurable: false,
    enumerable: false,
    value: STORAGE_HOST_SOURCE,
    writable: false
  })
  Object.defineProperty(error, 'code', {
    configurable: false,
    enumerable: false,
    value: code,
    writable: false
  })
  return error as T & { readonly source: string; readonly code: IStorageErrorCode }
}

/** Create a coded native Error for internal failures that may cross the package boundary. */
export const createStorageError = (
  code: IStorageErrorCode,
  message: string,
  cause?: unknown
): IStorageNativeError =>
  attachStorageErrorIdentity(new Error(message, cause === undefined ? undefined : { cause }), code)

/** Create a coded native RangeError while preserving its runtime prototype. */
export const createStorageRangeError = (
  code: IStorageErrorCode,
  message: string,
  cause?: unknown
): IStorageRangeError =>
  attachStorageErrorIdentity(
    new RangeError(message, cause === undefined ? undefined : { cause }),
    code
  )

/** Native aggregate carrying storage-host identity while preserving every cleanup failure object. */
export type IStorageAggregateError = AggregateError & {
  readonly source: string
  readonly code: IStorageErrorCode
}

/**
 * Creates one coded native AggregateError whose cause and errors retain the first/original
 * failures.
 */
export const createStorageAggregateError = (
  code: IStorageErrorCode,
  message: string,
  errors: readonly unknown[]
): IStorageAggregateError => {
  /** Retain every original cleanup error and keep the first one as cause. */
  const aggregate = new AggregateError(errors, message, {
    cause: errors[0]
  }) as IStorageAggregateError
  Object.defineProperty(aggregate, 'source', {
    configurable: false,
    enumerable: false,
    value: STORAGE_HOST_SOURCE,
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
  code: IStorageErrorCode,
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
/** Extension phase used to locate a schema, codec, migration, comparator or diagnostic failure. */
export type IExtensionStage = 'schema' | 'codec' | 'migration' | 'comparator' | 'diagnostic'

/**
 * Frozen storage diagnostic retaining the original failure on cause. The top-level message defaults
 * to the package/code label; nested details are not deep-frozen and original stacks remain on
 * cause.
 */
export class StorageError extends Error {
  /** Canonical storage-host diagnostic source. */
  readonly source!: string
  /** Semantic failure scenario; branch on this rather than message text. */
  readonly code!: IStorageErrorCode
  /** Backend associated with this operation. */
  readonly backend?: IBackendKind
  /** Logical key associated with this operation. */
  readonly key?: string | IStorageKey
  /** Channel already occupying the conflicting key. */
  readonly existingChannel?: IStorageChannel
  /** Channel the rejected write attempted to use. */
  readonly attemptedChannel?: IStorageChannel
  /** Extension phase responsible for this failure. */
  readonly extensionStage?: IExtensionStage
  /** Operation name attached by its owning boundary. */
  readonly operation?: string
  /** Internal repository stage used to apply invalid-record policy. */
  readonly stage?: 'decode' | 'migrate' | 'validate'

  /** Capture diagnostic details once and freeze this error without replacing its original cause. */
  constructor(
    code: IStorageErrorCode,
    details: IStorageErrorDetails = {},
    message?: string,
    stage?: 'decode' | 'migrate' | 'validate'
  ) {
    super(message ?? StorageErrorText.defaultError(code), { cause: details.cause })
    this.name = 'StorageError'
    Object.defineProperties(this, {
      source: { value: STORAGE_HOST_SOURCE, enumerable: true },
      code: { value: code, enumerable: true }
    })
    this.backend = details.backend
    this.key = details.key
    this.existingChannel = details.existingChannel
    this.attemptedChannel = details.attemptedChannel
    this.extensionStage = details.extensionStage
    this.operation = details.operation
    this.stage = stage
    Object.freeze(this)
  }
}
