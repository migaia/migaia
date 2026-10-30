import { EntityFeatureName } from './constants.ts'
import { EntityIndexesOwner } from './indexes-owner.ts'
import { defineFeature } from '../contracts.ts'
import { entityUnitTarget, registerEntityUnit } from './assembly.ts'
import { snapshotEntityIndexes } from './index-projection.ts'
import type { IEntityPluginOptions } from './types.ts'

/** Index declarations retain the canonical immutable projection before any store connects. */
function configureEntityIndexes(options: IEntityPluginOptions<any, any, any>) {
  return { indexes: snapshotEntityIndexes(options.indexes) }
}

/** Each repository request creates the existing index owner through its installed factory. */
function createEntityIndexes(
  context: import('./repository.ts').EntityRepositoryOwner<any, any, any, any, any>
) {
  return new EntityIndexesOwner(context)
}

/** Native installation publishes the capability factory once per entity registration. */
function installEntityIndexes() {
  return { create: createEntityIndexes }
}

/** Explicitly assemble entity indexes; omission keeps its owner outside the base import graph. */
export function entityIndexesFeature() {
  /** Exact native identity selects this role independently of the caller's record key. */
  const feature = defineFeature(entityUnitTarget, installEntityIndexes)
  return registerEntityUnit(feature, EntityFeatureName.indexes, configureEntityIndexes)
}
