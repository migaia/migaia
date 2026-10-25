import { EntityFeatureName } from './constants.js'
import { EntityIndexesOwner } from './indexes-owner.js'
import type { IEntityFeature } from './assembly.js'
import { snapshotEntityIndexes } from './index-projection.js'

/** Explicitly assemble entity indexes; omission keeps its owner outside the base import graph. */
export function entityIndexesFeature(): IEntityFeature {
  return {
    name: EntityFeatureName.indexes,
    configure(options) {
      return { indexes: snapshotEntityIndexes(options.indexes) }
    },
    create(context) {
      return new EntityIndexesOwner(context)
    }
  }
}
