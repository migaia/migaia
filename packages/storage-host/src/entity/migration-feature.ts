import { EntityFeatureName } from './constants.ts'
import { EntityMigrationOwner } from './migration-owner.ts'
import type { IEntityFeature } from './assembly.ts'
import { createMigrationPlan } from '../authoring/migration.ts'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'

/** Explicitly assemble entity migration; omission keeps its owner outside the base import graph. */
export function entityMigrationFeature(): IEntityFeature {
  return {
    name: EntityFeatureName.migration,
    configure(options) {
      try {
        return {
          migrationPlan: createMigrationPlan({
            version: options.version ?? 1,
            steps: options.migrations
          })
        }
      } catch (cause) {
        throw new StorageError(
          StorageHostErrorCode.invalidConfig,
          { cause },
          StorageErrorText.entityMigrationGraphIncomplete
        )
      }
    },
    create(context) {
      return new EntityMigrationOwner(context)
    }
  }
}
