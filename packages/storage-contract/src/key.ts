import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { isArrayBuffer } from '@migaia/utils/bytes'
import type { IBackendKind } from './capabilities.js'
import type { IKeyRange, IStorageKey } from './context.js'

/** Hard limits protect flat-key decoding from pathological persisted input. */
export const KEY_DOMAIN_LIMITS = Object.freeze({
  /** Maximum recursive key depth, measured from zero for the root value. */
  maxDepth: 32,
  /** Maximum visited nodes, counting each array and each key component. */
  maxNodes: 4096,
  /** Maximum bytes of each ArrayBuffer key component: one mebibyte. */
  maxBinaryBytes: 1024 * 1024
} as const)

/**
 * Checks a string-only key before a value, byte, or metadata operation. Empty strings are valid. A
 * non-string throws INVALID_ARGUMENT with backend and a TypeError cause; this is distinct from the
 * structured-record INVALID_KEY domain. label defaults to key and affects diagnostic text only.
 */
export function assertStringStorageKey(
  value: unknown,
  backend: IBackendKind | undefined,
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
 * Checks the shared record-key domain before an implementation accesses storage. Accepts strings,
 * finite numbers, valid Dates, available ArrayBuffers, and nonempty, dense, acyclic arrays of keys.
 * KEY_DOMAIN_LIMITS bounds recursive depth, visited nodes, and each binary component's size.
 *
 * Date/ArrayBuffer inspection uses structuredClone when available for cross-realm support, rather
 * than trusting constructor names. Invalid keys produce INVALID_KEY with backend/key details. label
 * defaults to key and affects only the message. No key is copied or frozen by this assertion.
 */
export function assertStorageKey(
  value: unknown,
  backend: IBackendKind | undefined,
  label = 'key'
): asserts value is IStorageKey {
  let nodes = 0
  const visit = (candidate: unknown, depth: number, seen: Set<unknown>): boolean => {
    nodes += 1
    if (nodes > KEY_DOMAIN_LIMITS.maxNodes || depth > KEY_DOMAIN_LIMITS.maxDepth) return false
    if (typeof candidate === 'string') return true
    if (typeof candidate === 'number') return Number.isFinite(candidate)
    if (Array.isArray(candidate)) {
      try {
        const length = candidate.length
        if (length === 0) return false
        if (seen.has(candidate)) return false
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
    const date = dateValue(candidate)
    if (date !== undefined) return !Number.isNaN(date)
    const buffer = bufferValue(candidate)
    if (buffer !== undefined) return buffer.byteLength <= KEY_DOMAIN_LIMITS.maxBinaryBytes
    return false
  }
  if (!visit(value, 0, new Set()))
    throw new StorageContractError(StorageContractErrorCode.invalidKey, {
      backend,
      key: value as IStorageKey,
      cause: new TypeError(`invalid ${label}`)
    })
}

/**
 * Validates and copies a structured key before asynchronous work can observe later input changes.
 * Strings/numbers retain their value; Dates, ArrayBuffers, and nested arrays are copied
 * recursively, then the copy is validated again. The returned copy is independently owned but not
 * frozen. Invalid keys or copy failures produce INVALID_KEY; existing contract failures pass
 * through. backend identifies the provider for diagnostics, and label defaults to key.
 */
export const snapshotStorageKey = (
  value: unknown,
  backend: IBackendKind | undefined,
  label = 'key'
): IStorageKey => {
  assertStorageKey(value, backend, label)
  const clone = (candidate: IStorageKey): IStorageKey => {
    if (typeof candidate === 'string' || typeof candidate === 'number') return candidate
    if (Array.isArray(candidate)) {
      const snapshot: IStorageKey[] = []
      for (let index = 0; index < candidate.length; index += 1)
        snapshot.push(clone(candidate[index]!))
      return snapshot
    }
    const date = dateValue(candidate)
    if (date !== undefined) return new Date(date)
    const buffer = bufferValue(candidate)
    if (buffer !== undefined) return buffer
    return candidate
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

/**
 * Compares already-valid storage keys for sorting or range work without touching a provider.
 * Returns a negative, zero, or positive number; it is not restricted to -1/0/1. Cross-type order is
 * number, Date, string, ArrayBuffer, then array. Binary values compare bytewise and arrays compare
 * componentwise, with a shorter equal prefix first. Use assertStorageKey before unknown inputs.
 */
export const compareStorageKeys = (a: IStorageKey, b: IStorageKey): number => {
  const rank = (value: IStorageKey): number => {
    if (typeof value === 'number') return 0
    if (Array.isArray(value)) return 4
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
