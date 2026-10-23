import { REPOSITORY_KEY_PREFIX } from '@migaia/storage-host/entity'
import { decodeFlatStorageKey, encodeFlatStorageKey } from '../core/key-domain.js'
import type { IKeyRange, IStorageKey } from '../types/context.js'

/**
 * Includes the entity name in a physical key so entities sharing one store do not overwrite records
 * with the same ID. For example, `users` and `posts` can share one `indexedDbHost()` connection.
 * Legacy structured keys use `[entityName, id]`, whose array prefix supports range queries.
 * Key-value keys use `<entityName>:<encoded-id>`.
 */
export const composeStructuredKey = (entityName: string, id: IStorageKey): IStorageKey => [
  entityName,
  id
]

/** Transactional conflict marker; its two-part key cannot be mistaken for a three-part entity row. */
export const repositoryUniqueWriteKey = (entityName: string): IStorageKey => [
  REPOSITORY_KEY_PREFIX,
  entityName
]

/** Encode repository identity as a sortable, reversible physical record key. */
export const composeRepositoryKey = (entityName: string, id: IStorageKey): IStorageKey => [
  REPOSITORY_KEY_PREFIX,
  entityName,
  encodeFlatStorageKey(id)
]

/** Decode a v2 repository key; unrelated raw record keys return undefined. */
export const decodeRepositoryKey = (
  entityName: string,
  key: IStorageKey
): IStorageKey | undefined => {
  if (
    !Array.isArray(key) ||
    key.length !== 3 ||
    key[0] !== REPOSITORY_KEY_PREFIX ||
    key[1] !== entityName ||
    typeof key[2] !== 'string'
  )
    return undefined
  return decodeFlatStorageKey(key[2])
}

/** Build an IDB range that isolates the v2 entity prefix without claiming ID encoding is sortable. */
export const repositoryEntityRange = (
  entityName: string
): {
  readonly lower: IStorageKey
  readonly upper: IStorageKey
  readonly lowerOpen?: boolean
  readonly upperOpen?: boolean
} => ({
  lower: [REPOSITORY_KEY_PREFIX, entityName, ''],
  lowerOpen: false,
  upper: [REPOSITORY_KEY_PREFIX, entityName, '\uffff'],
  upperOpen: false
})

/**
 * Preserves the complete key type and nested structure through reversible encoding. `String(id)`
 * loses that information.
 */
export const composeFlatKey = (entityName: string, id: IStorageKey): string =>
  `${entityName}:${encodeFlatStorageKey(id)}`

export const flatKeyPrefix = (entityName: string): string => `${entityName}:`

/**
 * Retains the historical structured prefix range for compatible callers. V2 repository queries scan
 * entity-isolated ranges and filter ID bounds. Legacy records still require a full-store scan.
 */
export const structuredEntityRange = (
  entityName: string
): { readonly lower: IStorageKey; readonly upper: IStorageKey } => ({
  lower: [entityName],
  upper: [entityName, []]
})

/** Build a valid IndexedDB range for legacy entity keys without admitting canonical v2 keys. */
export const legacyEntityRange = (
  entityName: string
): { readonly lower: IStorageKey; readonly upper: IStorageKey } => ({
  lower: [entityName],
  upper: [entityName, '\uffff']
})

/**
 * Combines bounds from the original ID space with the entity prefix. The result always has the form
 * `[entityName, ...]`. Treats `lower` and `upper` only as IDs, so the bounds cannot cross entity
 * keyspaces. Even an already prefixed ID becomes `[entityName, [entityName, id]]` and stays within
 * this entity.
 */
export const composeEntityRange = (
  entityName: string,
  range: IKeyRange | undefined
): {
  readonly lower: IStorageKey
  readonly lowerOpen?: boolean
  readonly upper: IStorageKey
  readonly upperOpen?: boolean
} => {
  const fallback = structuredEntityRange(entityName)
  return {
    lower:
      range?.lower !== undefined ? composeStructuredKey(entityName, range.lower) : fallback.lower,
    lowerOpen: range?.lower !== undefined ? range.lowerOpen : false,
    upper:
      range?.upper !== undefined ? composeStructuredKey(entityName, range.upper) : fallback.upper,
    upperOpen: range?.upper !== undefined ? range.upperOpen : false
  }
}
