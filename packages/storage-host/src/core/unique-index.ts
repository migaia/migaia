import type {
  IBackendKind,
  IRecordIndexDefinition,
  IRecordIndexProjection,
  IStorageKey
} from '@migaia/storage-contract'
import { encodeFlatStorageKey } from './key-domain.js'
import { StorageError, StorageErrorCode } from '../errors.js'
import { StorageErrorText } from '../error-text.js'

/** One unique projected value and its original logical record identity. */
export type IUniqueIndexOwner = {
  readonly indexName: string
  readonly indexValue: IStorageKey
  readonly owner: string
}
/** Only native backend error construction varies; index ownership validation has one implementation. */
export type IUniqueIndexErrorFactory = {
  invalidConfig(backend: IBackendKind): Error
  uniqueConflict(backend: IBackendKind, key: IStorageKey, indexName: string): Error
}

/** Collect owners with original same-record multi-entry deduplication before any commit writes. */
export function collectUniqueIndexOwners(
  definitions: readonly IRecordIndexDefinition[],
  records: Iterable<{ readonly key: IStorageKey; readonly projection: IRecordIndexProjection }>,
  backend: IBackendKind,
  errors?: IUniqueIndexErrorFactory
): ReadonlyMap<string, IUniqueIndexOwner> {
  /** Declared definitions are the only source of uniqueness metadata. */
  const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]))
  /** This is the original validation-local owner map, shared by scan and native commit plans. */
  const owners = new Map<string, IUniqueIndexOwner>()
  for (const record of records) {
    for (const [indexName, entry] of Object.entries(record.projection)) {
      /** Reject undeclared projections before considering multiplicity. */
      const definition = definitionsByName.get(indexName)
      if (definition === undefined)
        throw (
          errors?.invalidConfig(backend) ??
          new StorageError(StorageErrorCode.invalidConfig, { backend })
        )
      if (!definition.unique || entry === undefined) continue
      /** Projection normalization already admitted every actual storage key. */
      const values = entry.kind === 'multiple' ? entry.keys : [entry.key]
      for (const indexValue of values) {
        /** Preserve the original persisted identity used by the native sidecar. */
        const identity = JSON.stringify([indexName, encodeFlatStorageKey(indexValue)])
        /** Duplicate projected values on one row retain one logical owner. */
        const owner = encodeFlatStorageKey(record.key)
        /** A second row invalidates the complete proposed commit. */
        const existing = owners.get(identity)
        if (existing !== undefined && existing.owner !== owner)
          throw (
            errors?.uniqueConflict(backend, record.key, indexName) ??
            new StorageError(
              StorageErrorCode.indexUniqueConflict,
              { backend, key: record.key },
              StorageErrorText.indexUniqueConflict(indexName)
            )
          )
        owners.set(identity, { indexName, indexValue, owner })
      }
    }
  }
  return owners
}
