import { get, parseObjectPath, type IObjectPathTuple } from '@migaia/utils/object'
import type {
  IRecordIndexDefinition,
  IRecordIndexProjection,
  IRecordIndexProjectionValue
} from '@migaia/storage-contract'
import { assertStorageKey } from '../core/key-domain.js'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import type { IKeyValueStore } from '../types/storage.js'

type IStorageBackend = IKeyValueStore['backend']

const RESERVED_INDEX_PREFIX = '__'

export type ISnapshotEntityIndex<TDomain> = {
  readonly definition: IRecordIndexDefinition
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
        cause: new TypeError(`entity index "${label}" multiEntry projection must be an array`)
      })
    const keys = value.map((key) => {
      assertStorageKey(key, backend, `entity index "${label}" projection`)
      return key
    })
    return Object.freeze({ kind: 'multiple', keys: Object.freeze(keys) })
  }
  assertStorageKey(value, backend, `entity index "${label}" projection`)
  return Object.freeze({ kind: 'single', key: value })
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
      cause: new TypeError(`entity selector index "${label}" projection must be an object`)
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
    return Object.freeze({ kind, key })
  }
  if (kind === 'multiple') {
    if (!Array.isArray(keys))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        backend,
        cause: new TypeError(
          `entity selector index "${label}" multiple projection must be an array`
        )
      })
    const normalizedKeys = keys.map((item) => {
      assertStorageKey(item, backend, `entity index "${label}" projection`)
      return item
    })
    return Object.freeze({ kind, keys: Object.freeze(normalizedKeys) })
  }
  throw new StorageError(StorageErrorCode.invalidConfig, {
    backend,
    cause: new TypeError(`entity selector index "${label}" projection kind is invalid`)
  })
}

/** Snapshot and validate declarations once, including hostile property access. */
export const snapshotEntityIndexes = <TDomain>(
  configured: unknown
): ISnapshotEntityIndexes<TDomain> => {
  if (configured === undefined) return Object.freeze({})
  if (configured === null || typeof configured !== 'object' || Array.isArray(configured))
    throw new StorageError(StorageErrorCode.invalidConfig, {
      cause: new TypeError('entity indexes must be an object')
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
        cause: new TypeError('entity index name must be non-empty and non-reserved')
      })
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(`entity index "${name}" must be an object`)
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
        cause: new TypeError(`entity index "${name}" must declare exactly one projection mode`)
      })
    if (unique !== undefined && typeof unique !== 'boolean')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(`entity index "${name}" unique must be a boolean`)
      })
    if (multiEntry !== undefined && typeof multiEntry !== 'boolean')
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(`entity index "${name}" multiEntry must be a boolean`)
      })
    const normalizedRevision = revision === undefined ? 1 : revision
    if (!Number.isSafeInteger(normalizedRevision) || (normalizedRevision as number) < 1)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new RangeError(`entity index "${name}" revision must be a positive safe integer`)
      })
    if (select !== undefined && (typeof select !== 'function' || revision === undefined))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(`entity selector index "${name}" requires a function and revision`)
      })
    if (select !== undefined && multiEntry !== undefined)
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(`entity selector index "${name}" does not support multiEntry`)
      })
    if (paths !== undefined && (multiEntry === true || !Array.isArray(paths) || paths.length === 0))
      throw new StorageError(StorageErrorCode.invalidConfig, {
        cause: new TypeError(`entity compound index "${name}" requires non-empty paths`)
      })
    const parsedPath = path === undefined ? undefined : parseObjectPath(path as IObjectPathTuple)
    const parsedPaths =
      paths === undefined
        ? undefined
        : Object.freeze((paths as IObjectPathTuple[]).map((item) => parseObjectPath(item)))
    const definition = Object.freeze({
      name,
      unique: unique === true,
      // Custom selectors declare multiplicity in each explicit projection. The
      // definition must retain that capability so backend fingerprints agree
      // with a `{ kind: 'multiple' }` result instead of collapsing it to false.
      multiEntry: select !== undefined || multiEntry === true,
      revision: normalizedRevision as number
    })
    indexes[name] = Object.freeze({
      definition,
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
    })
  }
  return Object.freeze(indexes)
}

/** Project every declared index exactly once for one normalized domain value. */
export const projectEntityIndexes = <TDomain>(
  indexes: ISnapshotEntityIndexes<TDomain>,
  value: TDomain,
  backend: IStorageBackend
): IRecordIndexProjection =>
  Object.freeze(
    Object.fromEntries(
      Object.entries(indexes).map(([name, index]) => [name, index.project(value, backend)])
    )
  )
