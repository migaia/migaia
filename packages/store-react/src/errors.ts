import { ERROR_SOURCE, StoreReactErrorCode, type IStoreReactErrorCode } from './error-code.ts'
import { attachErrorIdentity, isNativeErrorValue } from '@migaia/utils/error'
import { StoreReactErrorText } from './error-text.ts'

export { StoreReactErrorCode, type IStoreReactErrorCode }

/** Identity of package-owned errors; complete foreign package identities remain with their owner. */
export const STORE_REACT_SOURCE = ERROR_SOURCE

function tagStoreReactError<E extends Error>(error: E, code: IStoreReactErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_REACT_SOURCE, code })
}

/**
 * Return a new native Error with the supplied code/message and package source, without throwing. A
 * defined cause is retained by reference; omitted/undefined cause creates no cause property. The
 * new error keeps its constructor-created stack.
 */
export function createStoreReactError(
  code: IStoreReactErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreReactError(error, code)
}

/** Return a tagged native AggregateError retaining the supplied errors in order, without throwing. */
export function createStoreReactAggregateError(
  code: IStoreReactErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStoreReactError(new AggregateError(errors, message), code)
}

/**
 * Gives a boundary failure the package identity. A complete foreign identity is kept; an uncoded
 * native error gets `code` attached in place (type, stack and identity unchanged); any other value
 * is wrapped with the original on `cause`.
 */
export function identifyStoreReactFailure(
  error: unknown,
  code: IStoreReactErrorCode,
  text: string
): Error {
  if (isNativeErrorValue(error)) {
    try {
      /** Inspect identity without invoking application-owned metadata accessors. */
      const source = Object.getOwnPropertyDescriptor(error, 'source')
      /** Complete foreign identities keep their semantic package owner. */
      const existingCode = Object.getOwnPropertyDescriptor(error, 'code')
      if (typeof source?.value === 'string' && typeof existingCode?.value === 'string') return error
      if (!source && !existingCode && Object.isExtensible(error))
        return tagStoreReactError(error, code)
    } catch (metadataError) {
      return createStoreReactAggregateError(code, [error, metadataError], text)
    }
  }
  return createStoreReactError(code, text, { cause: error })
}

/** Classifies owned cleanup failures, preserving native identity or the original through cause. */
export function identifyRegistryDisposalFailure(error: unknown): Error {
  return identifyStoreReactFailure(
    error,
    StoreReactErrorCode.registryDisposalFailed,
    StoreReactErrorText.registryDisposalFailed
  )
}
