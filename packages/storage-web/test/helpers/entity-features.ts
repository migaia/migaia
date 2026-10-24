import { entityQueryFeature } from '@migaia/storage-host/entity/query'
import { entityUniqueFeature } from '@migaia/storage-host/entity/unique'
import { entityMigrationFeature } from '@migaia/storage-host/entity/migration'
import { entityIndexesFeature } from '@migaia/storage-host/entity/indexes'
import { entityKeysetFeature } from '@migaia/storage-host/entity/keyset'

/** Existing entity behavior cases explicitly retain the five original optional capabilities. */
export const entityTestFeatures = [
  entityQueryFeature(),
  entityUniqueFeature(),
  entityMigrationFeature(),
  entityIndexesFeature(),
  entityKeysetFeature()
] as const
