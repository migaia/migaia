import { ERROR_SOURCE, StoreDevtoolsErrorCode, type IStoreDevtoolsErrorCode } from './error-code.js'
import { attachErrorIdentity, isNativeErrorValue } from '@migaia/utils/error'

export { StoreDevtoolsErrorCode, type IStoreDevtoolsErrorCode }

/** Identity for package-owned errors; complete foreign callback identities keep their source. */
export const STORE_DEVTOOLS_SOURCE = ERROR_SOURCE

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreDevtoolsError<E extends Error>(error: E, code: IStoreDevtoolsErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_DEVTOOLS_SOURCE, code })
}

/**
 * Create a fresh native Error with this package's source and a caller-selected registered code and
 * message. Optional cause retains the supplied original value; absent or undefined cause adds no
 * cause property. This constructs an error without throwing or classifying an existing one.
 */
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

/**
 * Create a native AggregateError with this package's identity and the supplied message/errors.
 * Original failures remain reachable through errors in their supplied order; this factory does not
 * throw, deduplicate them or add a separate cause property.
 */
export function createStoreDevtoolsAggregateError(
  code: IStoreDevtoolsErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStoreDevtoolsError(new AggregateError(errors, message), code)
}

/**
 * Create a native RangeError with this package's source, a registered code and the supplied
 * message. Use it when a caller must branch on native range failure, as with depth or
 * missing-history ids. Construction does not throw, attach a cause or replace an existing error's
 * stack.
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
