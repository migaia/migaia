import { EntityFeatureName } from './constants.js'
import { EntityQueryOwner } from './query-owner.js'
import type { IEntityFeature } from './assembly.js'

/** Explicitly assemble entity query; omission keeps its owner outside the base import graph. */
export function entityQueryFeature(): IEntityFeature {
  return {
    name: EntityFeatureName.query,
    create(context) {
      return new EntityQueryOwner(context)
    }
  }
}
