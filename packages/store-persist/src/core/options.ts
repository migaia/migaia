import { StorePersistErrorCode } from '../error-code.js'
import { createStorePersistTypeError } from '../errors.js'
import { StorePersistErrorText } from '../error-text.js'
import { snapshotOwnDescriptors } from '@migaia/utils/object'

/** Rejects JavaScript-boundary null/non-object persistence options before property access. */
export function assertPersistOptions(options: unknown): asserts options is object {
  if (options === null || typeof options !== 'object') {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.optionsObject
    )
  }
  const descriptorSnapshot = snapshotOwnDescriptors(options)
  if (!descriptorSnapshot.ok) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.optionsObject,
      { cause: descriptorSnapshot.error }
    )
  }
}

/** Copies persistence wrapper options once so validation and persist-unit construction share values. */
export function snapshotPersistOptions<T extends object>(options: T): T {
  if (options === null || typeof options !== 'object') {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.optionsObject
    )
  }
  const descriptorSnapshot = snapshotOwnDescriptors(options)
  if (!descriptorSnapshot.ok) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.optionsObject,
      { cause: descriptorSnapshot.error }
    )
  }
  try {
    const snapshot: Record<PropertyKey, unknown> = {}
    for (const [key, descriptor] of Object.entries(descriptorSnapshot.descriptors)) {
      snapshot[key] = 'get' in descriptor ? descriptor.get?.() : descriptor.value
    }
    return snapshot as T
  } catch (error) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.optionsObject,
      { cause: error }
    )
  }
}

/**
 * Rejects JavaScript-boundary key components before template-string coercion can alter storage
 * identity.
 */
export function assertPersistString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.stringOption(label)
    )
  }
}
