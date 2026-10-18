import { StoreWasmErrorCode, type IStoreWasmErrorCode } from './error-code.js'
import { attachErrorIdentity, isNativeErrorValue, tryReadProperty } from '@migaia/utils/error'
import type { IAbortSignal } from '@migaia/utils/promise'
import { StoreWasmErrorText } from './error-text.js'

export { StoreWasmErrorCode, type IStoreWasmErrorCode }

/** Identity of package-owned failures; complete foreign identities retain their original owner. */
export const STORE_WASM_SOURCE = '@migaia/store-wasm'

/** Attaches `(source, code)` onto an existing error object without touching its type or stack. */
function tagStoreWasmError<E extends Error>(error: E, code: IStoreWasmErrorCode): E {
  return attachErrorIdentity(error, { source: STORE_WASM_SOURCE, code })
}

/** Builds a `(source, code)`-tagged `Error` without touching `stack`. */
export function createStoreWasmError(
  code: IStoreWasmErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error {
  const error = new Error(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreWasmError(error, code)
}

/** Builds a `(source, code)`-tagged `RangeError`, preserving the runtime type. */
export function createStoreWasmRangeError(code: IStoreWasmErrorCode, message: string): RangeError {
  return tagStoreWasmError(new RangeError(message), code)
}

/** Builds a `(source, code)`-tagged `TypeError`, preserving the runtime type. */
export function createStoreWasmTypeError(
  code: IStoreWasmErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError {
  const error = new TypeError(
    message,
    options?.cause !== undefined ? { cause: options.cause } : undefined
  )
  return tagStoreWasmError(error, code)
}

/** Builds a tagged aggregate while preserving every original cleanup error by identity. */
export function createStoreWasmAggregateError(
  code: IStoreWasmErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError {
  return tagStoreWasmError(new AggregateError(errors, message), code)
}

/** Classifies a supported field boundary without replacing native or complete foreign errors. */
export function identifyStoreWasmFailure(
  error: unknown,
  code: IStoreWasmErrorCode,
  text: string
): Error {
  if (isNativeErrorValue(error)) {
    try {
      /** Inspect application error identity without running metadata getters. */
      const source = Object.getOwnPropertyDescriptor(error, 'source')
      /** Complete foreign identities remain traceable to their actual package owner. */
      const existingCode = Object.getOwnPropertyDescriptor(error, 'code')
      if (typeof source?.value === 'string' && typeof existingCode?.value === 'string') return error
      if (!source && !existingCode && Object.isExtensible(error))
        return tagStoreWasmError(error, code)
    } catch (metadataError) {
      return createStoreWasmAggregateError(code, [error, metadataError], text)
    }
  }
  return createStoreWasmError(code, text, { cause: error })
}

/** Shares one cancellation boundary across all five field constructors, keeping the original reason. */
export function assertWasmFieldNotAborted(signal: IAbortSignal): void {
  if (!signal.aborted) return
  /** Read the reason once; an inaccessible reason remains an observable original failure. */
  const reason = tryReadProperty(signal, 'reason')
  throw identifyStoreWasmFailure(
    reason.threw ? reason.error : reason.value,
    StoreWasmErrorCode.initAborted,
    StoreWasmErrorText.initAborted
  )
}
