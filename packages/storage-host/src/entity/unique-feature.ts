import { snapshotEntityIndexes } from './index-projection.js'
import { EntityFeatureName } from './constants.js'
import { EntityUniqueOwner } from './unique-owner.js'
import type { IEntityFeature } from './assembly.js'

/** Explicitly assemble entity unique; omission keeps its owner outside the base import graph. */
export function entityUniqueFeature(): IEntityFeature {
  return {
    name: EntityFeatureName.unique,
    configure(options) {
      return options.features?.some((feature) => feature.name === EntityFeatureName.indexes)
        ? {}
        : { indexes: snapshotEntityIndexes(options.indexes) }
    },
    create(context) {
      return new EntityUniqueOwner(context)
    }
  }
}
