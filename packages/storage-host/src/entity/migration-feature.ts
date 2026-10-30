import { EntityFeatureName } from './constants.ts'
import { EntityMigrationOwner } from './migration-owner.ts'
import { defineFeature } from '../contracts.ts'
import { entityUnitTarget, registerEntityUnit } from './assembly.ts'
import { createMigrationPlan } from '../authoring/migration.ts'
import { StorageError } from '../errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { StorageErrorText } from '../error-text.ts'
import type { IEntityPluginOptions } from './types.ts'

/** Canonical migration admission preserves the original plan error and its cause chain. */
function configureEntityMigration(options: IEntityPluginOptions<any, any, any>) {
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
}

/** Each repository request creates the existing migration owner through its installed factory. */
function createEntityMigration(
  context: import('./repository.ts').EntityRepositoryOwner<any, any, any, any, any>
) {
  return new EntityMigrationOwner(context)
}

/** Native installation publishes the capability factory once per entity registration. */
function installEntityMigration() {
  return { create: createEntityMigration }
}

/** Explicitly assemble entity migration; omission keeps its owner outside the base import graph. */
export function entityMigrationFeature() {
  /** The opaque native definition exposes no configuration callbacks or public role name. */
  const feature = defineFeature(entityUnitTarget, installEntityMigration)
  return registerEntityUnit(feature, EntityFeatureName.migration, configureEntityMigration)
}
