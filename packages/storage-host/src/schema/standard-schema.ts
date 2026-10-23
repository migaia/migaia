import { StorageError, StorageErrorCode, createStorageTypeError } from '../errors.js'
import { StorageErrorText } from '../error-text.js'
import { EntityAdapterName } from '../adapter-constants.js'
import type { ISchemaAdapter } from './types.js'

/**
 * Minimal Standard Schema version-one protocol. Any validator implementing this structure can
 * supply synchronous or asynchronous validation without becoming a dependency of storage-host.
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
      cause: new TypeError(StorageErrorText.standardSchemaObject)
    })
  /** Capture the external protocol once before descriptor validation. */
  let standard: unknown
  try {
    standard = (schema as { readonly '~standard'?: unknown })['~standard']
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { cause })
  }
  if (typeof standard !== 'object' || standard === null || Array.isArray(standard))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError(StorageErrorText.standardSchemaDescriptor)
    })
  /** Read only the captured protocol object, preserving throwing getters as causes. */
  const candidate = standard as Record<string, unknown>
  /** Version admission is independent of the validator callback. */
  let version: unknown
  /** Stable adapter name retains the original vendor label. */
  let vendor: unknown
  /** Captured callback is never reread after construction. */
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
      cause: new TypeError(StorageErrorText.standardSchemaDescriptor)
    })
  return {
    name: EntityAdapterName.standardSchema(vendor),
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
          cause: new TypeError(StorageErrorText.standardSchemaResult)
        })
      /** Read the single returned result without reconstructing its value. */
      const resultCandidate = result as Record<string, unknown>
      /** Issues distinguish rejection from a successful undefined value. */
      let issues: unknown
      /** Own value presence is required even when the value is undefined. */
      let hasValue: boolean
      /** Retain the original accepted value without cloning it. */
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
            cause: new TypeError(StorageErrorText.standardSchemaIssuesInvalid)
          })
        /** Join original issue text while retaining failure classification. */
        const messages: string[] = []
        try {
          for (const issue of issues) {
            if (typeof issue !== 'object' || issue === null || Array.isArray(issue))
              throw createStorageTypeError(
                StorageErrorCode.validationFailed,
                StorageErrorText.standardSchemaIssuesInvalid
              )
            /** Each issue message is captured once. */
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
          cause: new TypeError(StorageErrorText.standardSchemaMissingValue)
        })
      return output as T
    }
  }
}
