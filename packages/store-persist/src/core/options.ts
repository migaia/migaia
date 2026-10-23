import { StorePersistErrorCode } from '../error-code.js'
import { createStorePersistTypeError } from '../errors.js'
import { StorePersistErrorText } from '../error-text.js'
import { snapshotOwnDescriptors } from '@migaia/utils/object'
import {
  createMigrationPlan,
  type IMigrationPlan,
  type IMigrationStep,
  type IMigrationReset
} from '@migaia/storage-contract'

/**
 * Captures one canonical plan before status allocation or subscription; contract failures remain on
 * cause.
 */
export function createPersistMigrationPlan(
  key: string,
  version: number,
  migrations: Readonly<Record<number, IMigrationStep>> | IMigrationReset | undefined
): IMigrationPlan {
  try {
    if (
      migrations !== undefined &&
      migrations !== null &&
      typeof migrations === 'object' &&
      Object.hasOwn(migrations, 'reset')
    ) {
      /** Only enumerable extras participate in the public reset descriptor grammar. */
      const extra = Reflect.ownKeys(migrations).some(
        (property) =>
          property !== 'reset' && Object.getOwnPropertyDescriptor(migrations, property)?.enumerable
      )
      /** The canonical owner rejects mixed reset/steps instead of duplicating its validation. */
      return createMigrationPlan({
        version,
        reset: (migrations as IMigrationReset).reset,
        ...(extra ? { steps: migrations as Readonly<Record<number, IMigrationStep>> } : {})
      })
    }
    return createMigrationPlan({
      version,
      steps: migrations as Readonly<Record<number, IMigrationStep>> | undefined
    })
  } catch (cause) {
    throw createStorePersistTypeError(
      StorePersistErrorCode.invalidOption,
      StorePersistErrorText.migrationsInvalid(key),
      { cause }
    )
  }
}

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
      snapshot[key] =
        'get' in descriptor
          ? descriptor.get === undefined
            ? undefined
            : Reflect.apply(descriptor.get, options, [])
          : descriptor.value
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
