import { EntityFeatureName } from './constants.js'
import { EntityMigrationOwner } from './migration-owner.js'
import type { IEntityFeature } from './assembly.js'
import { createMigrationPlan } from '../authoring/migration.js'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'

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
          StorageErrorCode.invalidConfig,
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
