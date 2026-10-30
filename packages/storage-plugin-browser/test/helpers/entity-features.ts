import type { IFeatureRecord } from '@migaia/plugin-host'
import { entityQueryFeature } from '@migaia/storage-host/entity/features/query'
import { entityUniqueFeature } from '@migaia/storage-host/entity/features/unique'
import { entityMigrationFeature } from '@migaia/storage-host/entity/features/migration'
import { entityIndexesFeature } from '@migaia/storage-host/entity/features/indexes'
import { entityKeysetFeature } from '@migaia/storage-host/entity/features/keyset'

/** Existing entity behavior cases explicitly retain the five original optional capabilities. */
export const entityTestFeatures: IFeatureRecord = {
  query: entityQueryFeature(),
  unique: entityUniqueFeature(),
  migration: entityMigrationFeature(),
  indexes: entityIndexesFeature(),
  keyset: entityKeysetFeature()
} as const
