import { snapshotEntityIndexes } from './index-projection.ts'
import { EntityFeatureName } from './constants.ts'
import { EntityUniqueOwner } from './unique-owner.ts'
import { defineFeature } from '../contracts.ts'
import { entityUnitTarget, registerEntityUnit } from './assembly.ts'
import type { IEntityPluginOptions } from './types.ts'

/** Unique-only assembly snapshots indexes without implicitly enabling index planning. */
function configureEntityUnique(
  options: IEntityPluginOptions<any, any, any>,
  roles: ReadonlyMap<EntityFeatureName, string>
) {
  return roles.has(EntityFeatureName.indexes)
    ? {}
    : { indexes: snapshotEntityIndexes(options.indexes) }
}

/** Each repository request creates its original unique owner and transaction state. */
function createEntityUnique(
  context: import('./repository.ts').EntityRepositoryOwner<any, any, any, any, any>
) {
  return new EntityUniqueOwner(context)
}

/** Native installation publishes the capability factory once per entity registration. */
function installEntityUnique() {
  return { create: createEntityUnique }
}

/** Explicitly assemble entity unique; omission keeps its owner outside the base import graph. */
export function entityUniqueFeature() {
  /** Metadata declares this unit's role; all mutable state belongs to its native output. */
  const feature = defineFeature(entityUnitTarget, installEntityUnique)
  return registerEntityUnit(feature, EntityFeatureName.unique, configureEntityUnique)
}
