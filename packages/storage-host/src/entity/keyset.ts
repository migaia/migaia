import { createRecordQuery } from '../authoring/query.ts'
import { EntityFeatureName } from './constants.ts'
import { defineFeature } from '../contracts.ts'
import { entityUnitTarget, registerEntityUnit } from './assembly.ts'

/** Keyset assembly delegates page and cursor work to the original canonical query owner. */
class EntityKeysetOwner {
  /** Selecting this unit is the sole entity path retaining the canonical pagination engine. */
  readonly query = createRecordQuery
  /** Keep canonical cursor, failure and resource identity while admitting explicitly assembled use. */
  run = <R>(invoke: () => R): R => invoke()
}
/** Internal owner contract keeps the public subpath limited to its Feature constructor. */
export type IEntityKeysetOwner = EntityKeysetOwner
/** Each repository request creates the original independent pagination owner. */
function createEntityKeyset(): EntityKeysetOwner {
  return new EntityKeysetOwner()
}
/** Native installation publishes the independent keyset capability factory once. */
function installEntityKeyset() {
  return { create: createEntityKeyset }
}
/** Explicitly assemble keyset pagination without enabling query, indexes, unique or migration. */
export function entityKeysetFeature() {
  /** Role identity stays private while the native Feature owns its eventual runtime output. */
  const feature = defineFeature(entityUnitTarget, installEntityKeyset)
  return registerEntityUnit(feature, EntityFeatureName.keyset)
}
