/** Persisted repository prefix separates entity records from raw records without changing format. */
export const REPOSITORY_KEY_PREFIX = '__storage_web_entity_v2__'

/** Stable metadata key shared by repository migration and the raw-record firewall. */
export const repositoryMigrationKey = (entityName: string): string =>
  `repository:${entityName}:migration`
