import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { isArrayBuffer } from './bytes.js'
import type { IBackendKind } from './capabilities.js'
import type { IKeyRange, IStorageKey } from './context.js'

/** Hard limits protect flat-key decoding from pathological persisted input. */
export const KEY_DOMAIN_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 4096,
  maxBinaryBytes: 1024 * 1024
} as const)

/** Validate keys for L0, bytes, and metadata channels whose contract is string-only. */
export function assertStringStorageKey(
  value: unknown,
  backend: IBackendKind,
  label = 'key'
): asserts value is string {
  if (typeof value !== 'string')
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend,
      cause: new TypeError(`${label} must be a string`)
    })
}

const dateValue = (value: unknown): number | undefined => {
  try {
    const structuredClone = (globalThis as { structuredClone?: (input: unknown) => unknown })
      .structuredClone
    const cloned = typeof structuredClone === 'function' ? structuredClone(value) : value
    return cloned instanceof Date ? cloned.getTime() : undefined
  } catch {
    return undefined
  }
}

const bufferValue = (value: unknown): ArrayBuffer | undefined => {
  if (!isArrayBuffer(value)) return undefined
  try {
    const structuredClone = (globalThis as { structuredClone?: (input: unknown) => unknown })
      .structuredClone
    const cloned = typeof structuredClone === 'function' ? structuredClone(value) : value
    if (isArrayBuffer(cloned)) return new Uint8Array(cloned).slice().buffer
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Validate the IndexedDB-compatible key domain. Date/ArrayBuffer use structuredClone when available
 * so cross-realm values are accepted while constructor-name forgeries are rejected.
 */
export function assertStorageKey(
  value: unknown,
  backend: IBackendKind,
  label = 'key'
): asserts value is IStorageKey {
  let nodes = 0
  const visit = (candidate: unknown, depth: number, seen: Set<unknown>): boolean => {
    nodes += 1
    if (nodes > KEY_DOMAIN_LIMITS.maxNodes || depth > KEY_DOMAIN_LIMITS.maxDepth) return false
    if (typeof candidate === 'string') return true
    if (typeof candidate === 'number') return Number.isFinite(candidate)
    const date = dateValue(candidate)
    if (date !== undefined) return !Number.isNaN(date)
    const buffer = bufferValue(candidate)
    if (buffer !== undefined) return buffer.byteLength <= KEY_DOMAIN_LIMITS.maxBinaryBytes
    if (!Array.isArray(candidate) || seen.has(candidate)) return false
    try {
      const length = candidate.length
      if (length === 0) return false
      seen.add(candidate)
      for (let index = 0; index < length; index += 1) {
        if (!Object.hasOwn(candidate, index) || !visit(candidate[index], depth + 1, seen)) {
          seen.delete(candidate)
          return false
        }
      }
      seen.delete(candidate)
      return true
    } catch {
      seen.delete(candidate)
      return false
    }
  }
  if (!visit(value, 0, new Set()))
    throw new StorageContractError(StorageContractErrorCode.invalidKey, {
      backend,
      key: value as IStorageKey,
      cause: new TypeError(`invalid ${label}`)
    })
}

/** Validate and detach one key so later asynchronous work cannot observe caller mutation. */
export const snapshotStorageKey = (
  value: unknown,
  backend: IBackendKind,
  label = 'key'
): IStorageKey => {
  assertStorageKey(value, backend, label)
  const clone = (candidate: IStorageKey): IStorageKey => {
    if (typeof candidate === 'string' || typeof candidate === 'number') return candidate
    const date = dateValue(candidate)
    if (date !== undefined) return new Date(date)
    const buffer = bufferValue(candidate)
    if (buffer !== undefined) return buffer
    const source = candidate as readonly IStorageKey[]
    const snapshot: IStorageKey[] = []
    for (let index = 0; index < source.length; index += 1) snapshot.push(clone(source[index]!))
    return snapshot
  }
  try {
    const snapshot = clone(value)
    assertStorageKey(snapshot, backend, label)
    return snapshot
  } catch (cause) {
    if (cause instanceof StorageContractError) throw cause
    throw new StorageContractError(StorageContractErrorCode.invalidKey, {
      backend,
      key: value,
      cause
    })
  }
}

/** Compare keys using the same cross-realm classification as validation and encoding. */
export const compareStorageKeys = (a: IStorageKey, b: IStorageKey): number => {
  const rank = (value: IStorageKey): number => {
    if (typeof value === 'number') return 0
    if (dateValue(value) !== undefined) return 1
    if (typeof value === 'string') return 2
    if (bufferValue(value) !== undefined) return 3
    return 4
  }
  const rankA = rank(a)
  const rankB = rank(b)
  if (rankA !== rankB) return rankA - rankB
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const dateA = dateValue(a)
  const dateB = dateValue(b)
  if (dateA !== undefined && dateB !== undefined) return dateA - dateB
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0
  const bytesA = bufferValue(a)
  const bytesB = bufferValue(b)
  if (bytesA !== undefined && bytesB !== undefined) {
    const viewA = new Uint8Array(bytesA)
    const viewB = new Uint8Array(bytesB)
    const length = Math.min(viewA.length, viewB.length)
    for (let index = 0; index < length; index += 1) {
      if (viewA[index] !== viewB[index]) return viewA[index]! - viewB[index]!
    }
    return viewA.length - viewB.length
  }
  const arrayA = a as readonly IStorageKey[]
  const arrayB = b as readonly IStorageKey[]
  const length = Math.min(arrayA.length, arrayB.length)
  for (let index = 0; index < length; index += 1) {
    const comparison = compareStorageKeys(arrayA[index]!, arrayB[index]!)
    if (comparison !== 0) return comparison
  }
  return arrayA.length - arrayB.length
}

export type { IKeyRange, IStorageKey }
