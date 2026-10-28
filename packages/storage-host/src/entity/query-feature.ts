import { EntityFeatureName } from './constants.ts'
import { EntityQueryOwner } from './query-owner.ts'
import type { IEntityFeature } from './assembly.ts'

/** Explicitly assemble entity query; omission keeps its owner outside the base import graph. */
export function entityQueryFeature(): IEntityFeature {
  return {
    name: EntityFeatureName.query,
    create(context) {
      return new EntityQueryOwner(context)
    }
  }
}
