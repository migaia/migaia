import type {
  IBackendKind,
  IRecordIndexDefinition,
  IRecordIndexProjection,
  IStorageKey
} from '@migaia/storage-contract'
import { encodeFlatStorageKey } from './key-domain.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { indexUniqueConflictText } from '../error-text.js'

/** One unique projected key and its canonical record identity, shared by native and scan paths. */
export type IUniqueIndexOwner = {
  readonly indexName: string
  readonly indexValue: IStorageKey
  readonly owner: string
}

/** Collect one owner per logical unique key; repeated multi-entry keys on the same row are valid. */
export const collectUniqueIndexOwners = (
  definitions: readonly IRecordIndexDefinition[],
  records: Iterable<{ readonly key: IStorageKey; readonly projection: IRecordIndexProjection }>,
  backend: IBackendKind
): ReadonlyMap<string, IUniqueIndexOwner> => {
  /** Definitions are the single authority for whether a projected index is unique. */
  const definitionsByName = new Map(definitions.map((definition) => [definition.name, definition]))
  /** The same encoded identity is used by the IndexedDB sidecar and full-scan validation. */
  const owners = new Map<string, IUniqueIndexOwner>()
  for (const record of records) {
    for (const [indexName, entry] of Object.entries(record.projection)) {
      /** Reject undeclared projections before considering their multiplicity or value. */
      const definition = definitionsByName.get(indexName)
      if (definition === undefined)
        throw new StorageError(StorageErrorCode.invalidConfig, { backend })
      if (!definition.unique || entry === undefined) continue
      /** Canonical projection normalization has already validated each storage key. */
      const values = entry.kind === 'multiple' ? entry.keys : [entry.key]
      for (const indexValue of values) {
        /** Index names and encoded keys together distinguish separate unique constraints. */
        const identity = JSON.stringify([indexName, encodeFlatStorageKey(indexValue)])
        /** A row may own the same projected value more than once. */
        const owner = encodeFlatStorageKey(record.key)
        /** A different owner makes the complete proposed commit invalid. */
        const existing = owners.get(identity)
        if (existing !== undefined && existing.owner !== owner)
          throw new StorageError(
            StorageErrorCode.indexUniqueConflict,
            { backend, key: record.key },
            indexUniqueConflictText(indexName)
          )
        owners.set(identity, { indexName, indexValue, owner })
      }
    }
  }
  return owners
}
