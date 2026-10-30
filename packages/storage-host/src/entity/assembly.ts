import type { IFeature, IFeatureRecord } from '@migaia/plugin-host'
import { inspectFeatures } from '@migaia/plugin-host/composition'
import { defineStorageUnitTarget } from '../contracts.ts'
import type { IStorageUnitTarget } from '../types.ts'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { EntityText } from './text.ts'
import type { EntityFeatureName } from './constants.ts'
import type { EntityRepositoryOwner } from './repository.ts'
import type { IRepositoryConfig } from './repository-shared.ts'
import type { IEntityPluginOptions } from './types.ts'

/** Entity install outputs create repository-local business owners without another native install. */
export type IRepositoryUnitFactory = Readonly<{
  create(context: EntityRepositoryOwner<any, any, any, any, any>): object
}>

/** One installation-owned role address keeps the original native output as the factory receiver. */
export type IInstalledRepositoryUnit = Readonly<{
  role: EntityFeatureName
  factory: IRepositoryUnitFactory
}>

/** Entity units need no repository at native install; their output factories receive it later. */
export const entityUnitTarget: IStorageUnitTarget<Record<never, never>> =
  defineStorageUnitTarget<Record<never, never>>()

/** Declaration-only metadata carries role and optional canonical configuration admission. */
type IEntityUnitMetadata = Readonly<{
  readonly role: EntityFeatureName
  readonly configure?: (
    options: IEntityPluginOptions<any, any, any>,
    roles: ReadonlyMap<EntityFeatureName, string>
  ) => Partial<IRepositoryConfig<any, any>>
}>

/** Roles belong to exact native definitions and never to user-selected record keys. */
const entityUnits = new WeakMap<object, IEntityUnitMetadata>()

/** One admitted immutable record and its resolved role addresses serve every connection. */
export type IEntityAssembly = Readonly<{
  readonly features: IFeatureRecord
  readonly roles: ReadonlyMap<EntityFeatureName, string>
}>

/** Attach package-private role facts to an already-created native Feature identity. */
export function registerEntityUnit<F extends IFeature<any, any, any>>(
  feature: F,
  role: EntityFeatureName,
  configure?: IEntityUnitMetadata['configure']
): F {
  entityUnits.set(feature, { role, configure })
  return feature
}

/** Preserve INVALID_CONFIG and native TypeError traceability for rejected record admission. */
function invalidEntityUnits(cause?: unknown): StorageError {
  return new StorageError(StorageHostErrorCode.invalidConfig, {
    cause: new TypeError(
      EntityText.featuresMustBeRecord,
      cause === undefined ? undefined : { cause }
    )
  })
}

/** Snapshot trusted roots without resolving roles or running optional configuration. */
export function captureEntityUnitRecord(features: unknown): IFeatureRecord {
  try {
    return inspectFeatures((features === undefined ? {} : features) as IFeatureRecord).roots
  } catch (cause) {
    throw invalidEntityUnits(cause)
  }
}

/** Resolve semantic roles once in the native entity descriptor's installation window. */
export function snapshotEntityUnits(record: IFeatureRecord): IEntityAssembly {
  /** One address per role prevents aliases and independently created duplicate-role units. */
  const roles = new Map<EntityFeatureName, string>()
  for (const [key, feature] of Object.entries(record)) {
    /** Missing metadata also rejects foreign native Features and copied legacy unit objects. */
    const metadata = entityUnits.get(feature)
    if (metadata === undefined || roles.has(metadata.role)) throw invalidEntityUnits()
    roles.set(metadata.role, key)
  }
  return { features: record, roles }
}

/** Run only declaration admission; all per-repository state remains native install output. */
export function configureEntityUnits(
  assembly: IEntityAssembly,
  options: IEntityPluginOptions<any, any, any>
): Partial<IRepositoryConfig<any, any>> {
  /** Built-in configuration fields are disjoint after indexes/unique role resolution. */
  const configured: Partial<IRepositoryConfig<any, any>> = {}
  for (const feature of Object.values(assembly.features)) {
    /** Every admitted root has metadata captured before any configuration callback runs. */
    const metadata = entityUnits.get(feature)!
    Object.assign(configured, metadata.configure?.(options, assembly.roles))
  }
  return configured
}

/** Reject an undeclared capability before backend or application extension work starts. */
export function missingEntityFeature(name: string): never {
  throw new StorageError(
    StorageHostErrorCode.entityFeatureRequired,
    {},
    EntityText.featureRequired(name)
  )
}
