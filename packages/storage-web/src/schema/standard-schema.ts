import { StorageError, StorageErrorCode, createStorageTypeError } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import type { ISchemaAdapter } from './types.js'

/**
 * Minimal Standard Schema version-one protocol. Any validator implementing this structure can
 * supply synchronous or asynchronous validation without becoming a dependency of storage-web.
 */
export type IStandardSchemaV1<TInput = unknown, TOutput = TInput> = {
  /** Captured version-one validator protocol; this property is read once at adapter construction. */
  readonly '~standard': {
    /** Required protocol version; other versions reject adapter construction. */
    readonly version: 1
    /** Nonempty validator label used to name this schema adapter. */
    readonly vendor: string
    /**
     * Return a value on acceptance or issues on refusal; synchronous and asynchronous validation
     * share the same error boundary.
     */
    validate(
      value: unknown
    ):
      | { readonly value: TOutput; readonly issues?: undefined }
      | { readonly issues: ReadonlyArray<{ readonly message: string }> }
      | Promise<
          | { readonly value: TOutput; readonly issues?: undefined }
          | { readonly issues: ReadonlyArray<{ readonly message: string }> }
        >
  }
}

/**
 * Capture a valid Standard Schema version-one descriptor and expose it as an asynchronous schema
 * adapter. Invalid descriptors throw INVALID_CONFIG; issues, malformed results or validator
 * failures reject VALIDATION_FAILED with the original cause retained.
 */
export const fromStandardSchema = <T>(
  schema: IStandardSchemaV1<unknown, T>
): ISchemaAdapter<T, T> => {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('Standard Schema must be an object')
    })
  let standard: unknown
  try {
    standard = (schema as { readonly '~standard'?: unknown })['~standard']
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { cause })
  }
  if (typeof standard !== 'object' || standard === null || Array.isArray(standard))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('Standard Schema must provide version 1, vendor, and validate')
    })
  const candidate = standard as Record<string, unknown>
  let version: unknown
  let vendor: unknown
  let validate: unknown
  try {
    version = candidate.version
    vendor = candidate.vendor
    validate = candidate.validate
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { cause })
  }
  if (
    version !== 1 ||
    typeof vendor !== 'string' ||
    vendor.trim() === '' ||
    typeof validate !== 'function'
  )
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('Standard Schema must provide version 1, vendor, and validate')
    })
  return {
    name: `standard-schema:${vendor}`,
    validate: async (value) => {
      /** The adapter owns classification of both synchronous throws and asynchronous rejection. */
      let result: unknown
      try {
        result = await (validate as IStandardSchemaV1<unknown, T>['~standard']['validate'])(value)
      } catch (cause) {
        throw new StorageError(StorageErrorCode.validationFailed, { cause })
      }
      if (typeof result !== 'object' || result === null || Array.isArray(result))
        throw new StorageError(StorageErrorCode.validationFailed, {
          cause: new TypeError('Standard Schema returned an invalid result')
        })
      const resultCandidate = result as Record<string, unknown>
      let issues: unknown
      let hasValue: boolean
      let output: unknown
      try {
        issues = resultCandidate.issues
        hasValue = Object.hasOwn(resultCandidate, 'value')
        if (issues === undefined && hasValue) output = resultCandidate.value
      } catch (cause) {
        throw new StorageError(StorageErrorCode.validationFailed, { cause })
      }
      if (issues !== undefined) {
        if (!Array.isArray(issues))
          throw new StorageError(StorageErrorCode.validationFailed, {
            cause: new TypeError('Standard Schema returned invalid issues')
          })
        const messages: string[] = []
        try {
          for (const issue of issues) {
            if (typeof issue !== 'object' || issue === null || Array.isArray(issue))
              throw createStorageTypeError(
                StorageErrorCode.validationFailed,
                StorageErrorText.standardSchemaIssuesInvalid
              )
            const message = (issue as { readonly message?: unknown }).message
            if (typeof message !== 'string')
              throw createStorageTypeError(
                StorageErrorCode.validationFailed,
                StorageErrorText.standardSchemaIssuesInvalid
              )
            messages.push(message)
          }
        } catch (cause) {
          throw new StorageError(StorageErrorCode.validationFailed, { cause })
        }
        throw new StorageError(StorageErrorCode.validationFailed, {
          cause: new Error(messages.join('; '))
        })
      }
      if (!hasValue)
        throw new StorageError(StorageErrorCode.validationFailed, {
          cause: new TypeError('Standard Schema result must contain value or issues')
        })
      return output as T
    }
  }
}
