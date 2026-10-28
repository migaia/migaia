import { EntityFeatureName } from './constants.ts'
import { EntityIndexesOwner } from './indexes-owner.ts'
import type { IEntityFeature } from './assembly.ts'
import { snapshotEntityIndexes } from './index-projection.ts'

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
