import { StorageError } from '../errors.js'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { EntityText } from './text.js'
import type { EntityRepositoryOwner } from './repository.js'
import type { IRepositoryConfig } from './repository-shared.js'
import type { IEntityOptions } from './types.js'

/** An explicit entity subpath unit installs only its own operations on the original repository. */
export type IEntityFeature = Readonly<{
  /** Stable assembly name used by missing-feature diagnostics. */
  name: string
  /** Each connected repository gets its own named capability owner. */
  create(context: EntityRepositoryOwner<any, any, any, any, any>): object
  /** Definition-only admission reuses the canonical optional contract owner. */
  configure?(options: IEntityOptions<any, any, any>): Partial<IRepositoryConfig<any, any>>
}>
/** Reject an undeclared capability before backend or application extension work starts. */
export function missingEntityFeature(name: string): never {
  throw new StorageError(
    StorageHostErrorCode.entityFeatureRequired,
    {},
    EntityText.featureRequired(name)
  )
}
