import { EntityText } from './text.js'
import { get, parseObjectPath, type IObjectPathTuple } from '@migaia/utils/object'
import type {
  IRecordIndexDefinition,
  IRecordIndexProjection,
  IRecordIndexProjectionValue,
  IQueryCondition,
  IStorageKey,
  IKeyRange
} from '@migaia/storage-contract'
import { assertStorageKey, QueryOperator } from '@migaia/storage-contract'
import { snapshotStorageKey, compareStorageKeys } from '../authoring/key.js'
import { StorageError, StorageErrorCode } from '../errors.js'
import type { IKeyValueStore } from '@migaia/storage-contract'

type IStorageBackend = IKeyValueStore['backend']

const RESERVED_INDEX_PREFIX = '__'

export type ISnapshotEntityIndex<TDomain> = {
  readonly definition: IRecordIndexDefinition
  /** Canonical declaration paths are detached once; custom selectors have no declarative path. */
  readonly paths?: readonly (readonly string[])[]
  project(value: TDomain, backend: IStorageBackend): IRecordIndexProjectionValue | undefined
}

export type ISnapshotEntityIndexes<TDomain> = Readonly<
  Record<string, ISnapshotEntityIndex<TDomain>>
>

/** Convert one declared result into the contract's explicit single/multiple representation. */
const normalizeProjection = (
  value: unknown,
  multiEntry: boolean,
  backend: IStorageBackend,
  label: string
): IRecordIndexProjectionValue | undefined => {
  if (value === undefined) return undefined
  if (multiEntry) {
    if (!Array.isArray(value))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend,
        cause: new TypeError(EntityText.entityIndexMultiEntryProjectionMustBeAnArray(label))
      })
    const keys = value.map((key) => {
      assertStorageKey(key, backend, `entity index "${label}" projection`)
      return key
    })
    return { kind: 'multiple', keys: keys }
  }
  assertStorageKey(value, backend, `entity index "${label}" projection`)
  return { kind: 'single', key: value }
}

/** Validate the explicit custom projection shape without falling back to legacy return conventions. */
const normalizeCustomProjection = (
  value: unknown,
  backend: IStorageBackend,
  label: string
): IRecordIndexProjectionValue | undefined => {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      backend,
      cause: new TypeError(EntityText.entitySelectorIndexProjectionMustBeAnObject(label))
    })
  let kind: unknown
  let key: unknown
  let keys: unknown
  try {
    ;({ kind, key, keys } = value as Record<string, unknown>)
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { backend, cause })
  }
  if (kind === 'single') {
    assertStorageKey(key, backend, `entity index "${label}" projection`)
    return { kind, key }
  }
  if (kind === 'multiple') {
    if (!Array.isArray(keys))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend,
        cause: new TypeError(EntityText.entitySelectorIndexMultipleProjectionMustBeAnArray(label))
      })
    const normalizedKeys = keys.map((item) => {
      assertStorageKey(item, backend, `entity index "${label}" projection`)
      return item
    })
    return { kind, keys: normalizedKeys }
  }
  throw new StorageError(StorageErrorCode.invalidConfig, {
    backend,
    cause: new TypeError(EntityText.entitySelectorIndexProjectionKindIsInvalid(label))
  })
}

/** Snapshot and validate declarations once, including hostile property access. */
export const snapshotEntityIndexes = <TDomain>(
  configured: unknown
): ISnapshotEntityIndexes<TDomain> => {
  if (configured === undefined) return {}
  if (configured === null || typeof configured !== 'object' || Array.isArray(configured))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError(EntityText.entityIndexesMustBeAnObject)
    })
  let entries: [string, unknown][]
  try {
    entries = Object.entries(configured)
  } catch (cause) {
    throw new StorageError(StorageErrorCode.invalidConfig, { cause })
  }
  const indexes: Record<string, ISnapshotEntityIndex<TDomain>> = {}
  for (const [name, raw] of entries) {
    if (name.trim() === '' || name.startsWith(RESERVED_INDEX_PREFIX))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(EntityText.entityIndexNameMustBeNonEmptyAndNonReserved)
      })
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(EntityText.entityIndexMustBeAnObject(name))
      })
    let path: unknown
    let paths: unknown
    let select: unknown
    let unique: unknown
    let multiEntry: unknown
    let revision: unknown
    try {
      ;({ path, paths, select, unique, multiEntry, revision } = raw as Record<string, unknown>)
    } catch (cause) {
      throw new StorageError(StorageErrorCode.invalidConfig, { cause })
    }
    const modes = [path !== undefined, paths !== undefined, select !== undefined].filter(Boolean)
    if (modes.length !== 1)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(EntityText.entityIndexMustDeclareExactlyOneProjectionMode(name))
      })
    if (unique !== undefined && typeof unique !== 'boolean')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(EntityText.entityIndexUniqueMustBeABoolean(name))
      })
    if (multiEntry !== undefined && typeof multiEntry !== 'boolean')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(EntityText.entityIndexMultiEntryMustBeABoolean(name))
      })
    const normalizedRevision = revision === undefined ? 1 : revision
    if (!Number.isSafeInteger(normalizedRevision) || (normalizedRevision as number) < 1)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new RangeError(EntityText.entityIndexRevisionMustBeAPositiveSafeInteger(name))
      })
    if (select !== undefined && (typeof select !== 'function' || revision === undefined))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(EntityText.entitySelectorIndexRequiresAFunctionAndRevision(name))
      })
    if (select !== undefined && multiEntry !== undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(EntityText.entitySelectorIndexDoesNotSupportMultiEntry(name))
      })
    if (paths !== undefined && (multiEntry === true || !Array.isArray(paths) || paths.length === 0))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(EntityText.entityCompoundIndexRequiresNonEmptyPaths(name))
      })
    const parsedPath = path === undefined ? undefined : parseObjectPath(path as IObjectPathTuple)
    const parsedPaths =
      paths === undefined
        ? undefined
        : (paths as IObjectPathTuple[]).map((item) => parseObjectPath(item))
    const definition = {
      name,
      unique: unique === true,
      // Custom selectors declare multiplicity in each explicit projection. The
      // definition must retain that capability so backend fingerprints agree
      // with a `{ kind: 'multiple' }` result instead of collapsing it to false.
      multiEntry: select !== undefined || multiEntry === true,
      revision: normalizedRevision as number
    }
    indexes[name] = {
      definition,
      ...(parsedPath !== undefined
        ? { paths: [parsedPath.map(String)] }
        : parsedPaths === undefined
          ? {}
          : { paths: parsedPaths.map((path) => path.map(String)) }),
      project: (value: TDomain, backend: IStorageBackend) => {
        const selected =
          parsedPath !== undefined
            ? get(value, parsedPath as never)
            : parsedPaths !== undefined
              ? parsedPaths.map((item) => get(value, item as never))
              : (select as (input: TDomain) => unknown)(value)
        return select === undefined
          ? normalizeProjection(selected, definition.multiEntry, backend, name)
          : normalizeCustomProjection(selected, backend, name)
      }
    }
  }
  return indexes
}

/** Project every declared index exactly once for one normalized domain value. */
export const projectEntityIndexes = <TDomain>(
  indexes: ISnapshotEntityIndexes<TDomain>,
  value: TDomain,
  backend: IStorageBackend
): IRecordIndexProjection =>
  Object.fromEntries(
    Object.entries(indexes).map(([name, index]) => [name, index.project(value, backend)])
  )

/** A source candidate is only a canonical range and static priority, never a cursor or ready handle. */
type IEntityIndexQueryCandidate = Readonly<{
  index: string
  range: IKeyRange | undefined
  rank: number
  size: number
}>
/** Rank names remain stable explain facts while the original index reader owns actual execution. */
const EntityQueryIndexRank = { uniqueEquality: 0, equality: 1, bounded: 2, oneSided: 3 } as const
/** Only canonical operators with declared-index candidate semantics can be consumed by this source. */
export const ENTITY_QUERY_INDEX_OPERATORS: readonly QueryOperator[] = Object.freeze([
  QueryOperator.eq,
  QueryOperator.in,
  QueryOperator.gt,
  QueryOperator.gte,
  QueryOperator.lt,
  QueryOperator.lte,
  QueryOperator.between,
  QueryOperator.startsWith
])
/** Declarative field equality excludes opaque object identity and unsupported structured domains. */
const queryIndexKey = (value: unknown, backend: IStorageBackend): IStorageKey | undefined =>
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  value instanceof Date
    ? snapshotStorageKey(value, backend)
    : undefined
/**
 * Compare the original canonical path facts without parsing user conditions or declaration strings
 * again.
 */
const sameIndexPath = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((part, position) => part === right[position])
/** An AND contributes safe narrowing fields; OR and NOT cannot restrict a source to one branch. */
const queryIndexFields = (
  conditions: readonly IQueryCondition[]
): Extract<IQueryCondition, { kind: 'field' }>[] => {
  const fields: Extract<IQueryCondition, { kind: 'field' }>[] = []
  const pending = [...conditions]
  for (let position = 0; position < pending.length; position++) {
    const condition = pending[position]!
    if (condition.kind === 'field') fields.push(condition)
    else if (condition.kind === 'and') for (const child of condition.conditions) pending.push(child)
  }
  return fields
}
/** Pick the range for one declared index using only portable scalar field facts. */
const indexQueryCandidate = <T>(
  name: string,
  index: ISnapshotEntityIndex<T>,
  fields: readonly Extract<IQueryCondition, { kind: 'field' }>[],
  backend: IStorageBackend
): IEntityIndexQueryCandidate | undefined => {
  const paths = index.paths
  if (paths === undefined || index.definition.multiEntry) return
  if (paths.length > 1) {
    const keys: IStorageKey[] = []
    for (const path of paths) {
      const equality = fields.find(
        (field) => sameIndexPath(field.path, path) && field.operator === QueryOperator.eq
      )
      const key = equality === undefined ? undefined : queryIndexKey(equality.value, backend)
      if (key === undefined) return
      keys.push(key)
    }
    const key = keys
    return {
      index: name,
      range: { lower: key, upper: key },
      rank: index.definition.unique
        ? EntityQueryIndexRank.uniqueEquality
        : EntityQueryIndexRank.equality,
      size: 0
    }
  }
  const matching = fields.filter((field) => sameIndexPath(field.path, paths[0]!))
  for (const field of matching)
    if (field.operator === QueryOperator.eq) {
      const key = queryIndexKey(field.value, backend)
      if (key !== undefined)
        return {
          index: name,
          range: { lower: key, upper: key },
          rank: index.definition.unique
            ? EntityQueryIndexRank.uniqueEquality
            : EntityQueryIndexRank.equality,
          size: 0
        }
    }
  let membership: IEntityIndexQueryCandidate | undefined
  for (const field of matching)
    if (field.operator === QueryOperator.in && Array.isArray(field.value)) {
      const keys = field.value.map((value) => queryIndexKey(value, backend))
      if (keys.some((key) => key === undefined)) continue
      let lower: IStorageKey | undefined
      let upper: IStorageKey | undefined
      for (const key of keys as IStorageKey[]) {
        if (lower === undefined || compareStorageKeys(key, lower) < 0) lower = key
        if (upper === undefined || compareStorageKeys(key, upper) > 0) upper = key
      }
      if (membership === undefined || keys.length < membership.size)
        membership = {
          index: name,
          range: lower === undefined ? undefined : { lower, upper },
          rank: EntityQueryIndexRank.equality,
          size: keys.length
        }
    }
  if (membership !== undefined) return membership
  let lower: IStorageKey | undefined
  let upper: IStorageKey | undefined
  let lowerOpen = false
  let upperOpen = false
  for (const field of matching) {
    const between =
      field.operator === QueryOperator.between && Array.isArray(field.value)
        ? field.value
        : undefined
    const low =
      between?.[0] ??
      (field.operator === QueryOperator.gt || field.operator === QueryOperator.gte
        ? field.value
        : undefined)
    const high =
      between?.[1] ??
      (field.operator === QueryOperator.lt || field.operator === QueryOperator.lte
        ? field.value
        : undefined)
    const lowKey = queryIndexKey(low, backend)
    const highKey = queryIndexKey(high, backend)
    if (lowKey !== undefined) {
      const order = lower === undefined ? 1 : compareStorageKeys(lowKey, lower)
      if (order > 0) {
        lower = lowKey
        lowerOpen = field.operator === QueryOperator.gt
      } else if (order === 0) lowerOpen ||= field.operator === QueryOperator.gt
    }
    if (highKey !== undefined) {
      const order = upper === undefined ? -1 : compareStorageKeys(highKey, upper)
      if (order < 0) {
        upper = highKey
        upperOpen = field.operator === QueryOperator.lt
      } else if (order === 0) upperOpen ||= field.operator === QueryOperator.lt
    }
  }
  if (lower !== undefined || upper !== undefined)
    return {
      index: name,
      range:
        lower !== undefined && upper !== undefined && compareStorageKeys(lower, upper) > 0
          ? undefined
          : { lower, upper, lowerOpen, upperOpen },
      rank:
        lower !== undefined && upper !== undefined
          ? EntityQueryIndexRank.bounded
          : EntityQueryIndexRank.oneSided,
      size: 0
    }
  const prefix = matching.find((field) => field.operator === QueryOperator.startsWith)
  if (prefix !== undefined && typeof prefix.value === 'string')
    // A lower-only prefix candidate is conservative for every UTF-16 tail; the original AST checks it exactly.
    return {
      index: name,
      range: { lower: prefix.value },
      rank: EntityQueryIndexRank.oneSided,
      size: 0
    }
  return
}
/**
 * Select one declared source in static priority order; no statistics, readiness checks or I/O occur
 * here.
 */
export const chooseEntityQueryIndex = <T>(
  indexes: ISnapshotEntityIndexes<T>,
  conditions: readonly IQueryCondition[],
  backend: IStorageBackend
) => {
  const fields = queryIndexFields(conditions)
  const candidates = Object.entries(indexes).map(([name, index]) => ({
    name,
    candidate: indexQueryCandidate(name, index, fields, backend)
  }))
  let chosen: IEntityIndexQueryCandidate | undefined
  for (const { candidate } of candidates)
    if (
      candidate !== undefined &&
      (chosen === undefined ||
        candidate.rank < chosen.rank ||
        (candidate.rank === chosen.rank && candidate.size < chosen.size))
    )
      chosen = candidate
  return {
    selection: chosen === undefined ? undefined : { index: chosen.index, range: chosen.range },
    sourceReason:
      chosen === undefined
        ? EntityText.queryIndexNoCandidate
        : EntityText.queryIndexChosen(chosen.rank),
    sourceCandidates: candidates.map(({ name, candidate }) => ({
      index: name,
      reason:
        candidate === undefined
          ? EntityText.queryIndexNotEligible
          : name === chosen?.index
            ? EntityText.queryIndexChosen(candidate.rank)
            : EntityText.queryIndexLowerPriority
    }))
  }
}
/**
 * Canonical residual predicates may use other declared scalar paths after the chosen candidate
 * range.
 */
export const supportsEntityIndexCondition = <T>(
  indexes: ISnapshotEntityIndexes<T>,
  condition: IQueryCondition
): boolean => {
  if (condition.kind === 'not') return supportsEntityIndexCondition(indexes, condition.condition)
  if (condition.kind !== 'field')
    return condition.conditions.every((child) => supportsEntityIndexCondition(indexes, child))
  return (
    ENTITY_QUERY_INDEX_OPERATORS.includes(condition.operator) &&
    Object.values(indexes).some(
      (index) =>
        !index.definition.multiEntry &&
        index.paths?.some((path) => sameIndexPath(path, condition.path)) === true
    )
  )
}
