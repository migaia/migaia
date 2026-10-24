import { EntityFeatureName } from './constants.js'
import type { IEntityFeature } from './assembly.js'

/** Keyset assembly delegates page and cursor work to the original canonical query owner. */
class EntityKeysetOwner {
  /** Keep canonical cursor, failure and resource identity while admitting explicitly assembled use. */
  run = <R>(invoke: () => R): R => invoke()
}
/** Internal owner contract keeps the public subpath limited to its Feature constructor. */
export type IEntityKeysetOwner = EntityKeysetOwner
/** Explicitly assemble keyset pagination without enabling query, indexes, unique or migration. */
export function entityKeysetFeature(): IEntityFeature {
  return {
    name: EntityFeatureName.keyset,
    create() {
      return new EntityKeysetOwner()
    }
  }
}
