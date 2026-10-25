import { StorePersistErrorCode } from '../error-code.js'
import { createStorePersistTypeError } from '../errors.js'
import { StorePersistErrorText } from '../error-text.js'
import { snapshotOwnDescriptors } from '@migaia/utils/object'
import { observeThenableRejection } from '@migaia/utils/function'
import {
  type IMigrationPlan,
  type IMigrationStep,
  type IMigrationReset
} from '@migaia/storage-contract'
import { createMigrationPlan } from '@migaia/storage-host/authoring/migration'

/** Binds observations without allowing a public observer's accessor or callback to veto work. */
export function bindPersistStages<
  T extends {
    readonly forTransaction: (scope: object) => T
    readonly report: (error: unknown) => undefined
  }
>(observer: T | undefined, scope: object): T | undefined {
  if (observer === undefined) return undefined
  try {
    return observer.forTransaction(scope)
  } catch (cause) {
    observeThenableRejection(undefined, { error: cause }, (error) => observer.report(error))
    return undefined
  }
}

/** Reads one observer kind at configuration admission and retains an accessor failure on cause. */
export function assertPersistStageKind(
  observer: { readonly kind: unknown } | undefined,
  expected: string,
  message: string
): void {
  /** Metadata is never re-read while a codec or transaction is in progress. */
  let kind: unknown
  try {
    kind = observer?.kind
  } catch (cause) {
    throw createStorePersistTypeError(StorePersistErrorCode.invalidOption, message, { cause })
  }
  if (observer !== undefined && kind !== expected)
    throw createStorePersistTypeError(StorePersistErrorCode.invalidOption, message)
}

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
    const snapshot: Record<PropertyKey, unknown> = Object.create(null)
    for (const key of Reflect.ownKeys(descriptorSnapshot.descriptors)) {
      /** Backend context extensions may use symbols as well as ordinary own string fields. */
      const descriptor = Reflect.get(descriptorSnapshot.descriptors, key) as PropertyDescriptor
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
