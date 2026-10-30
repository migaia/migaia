import { EntityFeatureName } from './constants.ts'
import { EntityQueryOwner } from './query-owner.ts'
import { defineFeature } from '../contracts.ts'
import { entityUnitTarget, registerEntityUnit } from './assembly.ts'

/** Each repository request creates its query owner through the installed capability factory. */
function createEntityQuery(
  context: import('./repository.ts').EntityRepositoryOwner<any, any, any, any, any>
) {
  return new EntityQueryOwner(context)
}

/** Native installation publishes the capability factory once per entity registration. */
function installEntityQuery() {
  return { create: createEntityQuery }
}

/** Explicitly assemble entity query; omission keeps its owner outside the base import graph. */
export function entityQueryFeature() {
  /** Runtime state is produced only when the native registration installs this opaque identity. */
  const feature = defineFeature(entityUnitTarget, installEntityQuery)
  return registerEntityUnit(feature, EntityFeatureName.query)
}
