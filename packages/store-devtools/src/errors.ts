import { StoreDevtoolsErrorCode, type IStoreDevtoolsErrorCode } from './error-code.js'
import { attachErrorIdentity, isNativeErrorValue } from '@migaia/utils/error'

export { StoreDevtoolsErrorCode, type IStoreDevtoolsErrorCode }

/** Identity for package-owned errors; complete foreign callback identities keep their source. */
export const STORE_DEVTOOLS_SOURCE = '@migaia/store-devtools'

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreDevtoolsError<E extends Error>(error: E, code: IStoreDevtoolsErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_DEVTOOLS_SOURCE, code })
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreDevtoolsError(
  code: IStoreDevtoolsErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreDevtoolsError(error, code)
}

/** Builds a tagged AggregateError while retaining every subscription failure. */
export function createStoreDevtoolsAggregateError(
  code: IStoreDevtoolsErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStoreDevtoolsError(new AggregateError(errors, message), code)
}

/**
 * Builds a `(source, code)`-tagged `RangeError`. The error type matters to callers that branch on
 * `instanceof RangeError`, so this preserves it instead of producing a plain `Error`.
 */
export function createStoreDevtoolsRangeError(
  code: IStoreDevtoolsErrorCode,
  message: string
): RangeError {
  return tagStoreDevtoolsError(new RangeError(message), code)
}

/** Classifies diagnostic preparation while preserving native errors and complete foreign identities. */
export function identifyDevtoolsFailure(error: unknown, text: string): Error {
  if (isNativeErrorValue(error)) {
    try {
      /** Read only metadata descriptors so annotation never invokes application getters. */
      const source = Object.getOwnPropertyDescriptor(error, 'source')
      /** An existing complete identity remains owned by its originating package. */
      const code = Object.getOwnPropertyDescriptor(error, 'code')
      if (typeof source?.value === 'string' && typeof code?.value === 'string') return error
      if (!source && !code && Object.isExtensible(error))
        return tagStoreDevtoolsError(error, StoreDevtoolsErrorCode.callbackFailed)
    } catch (metadataError) {
      return createStoreDevtoolsAggregateError(
        StoreDevtoolsErrorCode.callbackFailed,
        [error, metadataError],
        text
      )
    }
  }
  return createStoreDevtoolsError(StoreDevtoolsErrorCode.callbackFailed, text, { cause: error })
}
