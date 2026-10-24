/** Stable entity boundary diagnostics remain shared across every root and transaction path. */
export const EntityText = {
  /** Predicates are synchronous boolean decisions; async mapping belongs to select. */
  queryPredicateBoolean: 'Entity query predicate must return a synchronous boolean',
  /** Query patches preserve their selected physical identity instead of moving or replacing a row. */
  queryIdentityChanged: 'Entity query update cannot change the record identity',

  /** Invalid callbacks are rejected before entering a native transaction. */
  batchCallbackMustBeAFunction: 'batch callback must be a function',
  /** Comparator configuration is bounded before opening a source cursor. */
  comparatorLimit: 'entity orderBy requires a limit',
  /** Value-only sources retain their authoritative full-key scan diagnostic. */
  valueScan: (name: string) =>
    `[storage-web] entity "${name}".list/stream on a value-only backend performs a full key scan`,
  /** Invalid records are reported observationally after the selected skip policy. */
  invalidRecord: (name: string, id: unknown) =>
    `[storage-web] entity "${name}" skipped invalid record ${String(id)}`,
  /** Index lookup rejects undeclared names before source I/O. */
  indexMissing: (name: string, index: string) =>
    `entity "${name}" index "${index}" is not declared`,
  /** An unavailable native projection uses the same actual materialization fallback. */
  indexFallback: (name: string, index: string) =>
    `[storage-web] entity "${name}" index "${index}" uses authoritative full-scan fallback`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entitySchemaMustBeAnObject: 'entity schema must be an object',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entitySchemaMustDeclareNameAndValidate: 'entity schema must declare name and validate',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityMigrationsMustBeAnObject: 'entity migrations must be an object',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityNameMustBeNonEmpty: 'entity name must be non-empty',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityNameUsesReservedPrefix: 'entity name uses reserved prefix',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityVersionMustBeAPositiveSafeInteger: 'entity version must be a positive safe integer',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityKeyMustBeANonEmptyPropertyName: 'entity key must be a non-empty property name',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entitySchemaSnapshotIsRequired: 'entity schema snapshot is required',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityOnDiagnosticMustBeAFunction: 'entity onDiagnostic must be a function',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityValidateOnReadMustBeABoolean: 'entity validateOnRead must be a boolean',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityDefaultOrderByMustBeAFunction: 'entity defaultOrderBy must be a function',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityMigrationVersionMustBeAnIntegerBetween2AndVersion:
    'entity migration version must be an integer between 2 and version',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityMigrationMustBeAFunction: 'entity migration must be a function',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityMigrationIsRequired: (arg0: unknown) => `entity migration ${arg0} is required`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityDefinitionMustBeAnObject: 'entity definition must be an object',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityIndexesRequireCurriedDeclaration: 'entity indexes require curried declaration',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityIndexMultiEntryProjectionMustBeAnArray: (arg0: unknown) =>
    `entity index "${arg0}" multiEntry projection must be an array`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entitySelectorIndexProjectionMustBeAnObject: (arg0: unknown) =>
    `entity selector index "${arg0}" projection must be an object`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entitySelectorIndexMultipleProjectionMustBeAnArray: (arg0: unknown) =>
    `entity selector index "${arg0}" multiple projection must be an array`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entitySelectorIndexProjectionKindIsInvalid: (arg0: unknown) =>
    `entity selector index "${arg0}" projection kind is invalid`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityIndexesMustBeAnObject: 'entity indexes must be an object',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityIndexNameMustBeNonEmptyAndNonReserved:
    'entity index name must be non-empty and non-reserved',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityIndexMustBeAnObject: (arg0: unknown) => `entity index "${arg0}" must be an object`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityIndexMustDeclareExactlyOneProjectionMode: (arg0: unknown) =>
    `entity index "${arg0}" must declare exactly one projection mode`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityIndexUniqueMustBeABoolean: (arg0: unknown) =>
    `entity index "${arg0}" unique must be a boolean`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityIndexMultiEntryMustBeABoolean: (arg0: unknown) =>
    `entity index "${arg0}" multiEntry must be a boolean`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityIndexRevisionMustBeAPositiveSafeInteger: (arg0: unknown) =>
    `entity index "${arg0}" revision must be a positive safe integer`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entitySelectorIndexRequiresAFunctionAndRevision: (arg0: unknown) =>
    `entity selector index "${arg0}" requires a function and revision`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entitySelectorIndexDoesNotSupportMultiEntry: (arg0: unknown) =>
    `entity selector index "${arg0}" does not support multiEntry`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityCompoundIndexRequiresNonEmptyPaths: (arg0: unknown) =>
    `entity compound index "${arg0}" requires non-empty paths`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  listLimitMustBeANonNegativeSafeInteger: 'list limit must be a non-negative safe integer',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  listOrderByMustBeAFunction: 'list orderBy must be a function',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  listOptionsMustBeAnObject: 'list options must be an object',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityMissingStorageKey: (arg0: unknown, arg1: unknown) =>
    `entity "${arg0}": missing storage key "${arg1}"`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  storageWebEntitySkippedInvalidIndexBackfillRecord: (
    arg0: unknown,
    arg1: unknown,
    arg2: unknown
  ) => `[storage-web] entity "${arg0}" skipped invalid index backfill record ${arg1}: ${arg2}`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  entityRequiresVersion: (arg0: unknown, arg1: unknown) =>
    `entity "${arg0}" requires version ${arg1}`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  invalidEntityEnvelope: 'invalid entity envelope',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  oninvalidMustBeSkipThrowOrAHandler: 'onInvalid must be skip, throw, or a handler',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  listDirectionMustBeNextOrPrev: 'list direction must be next or prev',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  indexedListIndexMustBeANonEmptyString: 'indexed list index must be a non-empty string',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  migrateOptionsMustBeAnObject: 'migrate options must be an object',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  migrateBatchSizeMustBeAPositiveSafeInteger: 'migrate batchSize must be a positive safe integer',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  oninvalidHandlerMustReturnSkipOrThrow: 'onInvalid handler must return skip or throw',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  storageWebEntityFindByOnNonUniqueIndexReturnedTheFirst: (arg0: unknown, arg1: unknown) =>
    `[storage-web] entity "${arg0}" findBy on non-unique index "${arg1}" returned the first canonical match`,
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  migrationFromVersionMustBeANonNegativeSafeInteger:
    'migration fromVersion must be a non-negative safe integer',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  migrationToVersionMustBeANonNegativeSafeInteger:
    'migration toVersion must be a non-negative safe integer',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  migrationsMustBeAnObject: 'migrations must be an object',
  /** Preserve the existing entity boundary diagnostic across root and transaction paths. */
  migrationMustBeAFunction: (arg0: unknown) => `migration ${arg0} must be a function`
} as const
