import { StorageContractError, StorageContractErrorCode } from './errors.js'
import { isArrayBuffer } from '@migaia/utils/bytes'
import { type IBackendKind } from './capabilities.js'
import { type IStorageKey } from './context.js'
import { StorageContractErrorText } from './error-text.js'

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
      cause: new TypeError(StorageContractErrorText.stringStorageKey(label))
    })
}

/** Reads the Date internal slot across supported realms without cloning caller data. */
function dateValue(value: unknown): number | undefined {
  try {
    return Reflect.apply(Date.prototype.getTime, value, []) as number
  } catch {
    return undefined
  }
}

/** Borrows an available native buffer view; detached buffers fail without allocating a copy. */
function bufferValue(value: unknown): Uint8Array | undefined {
  if (!isArrayBuffer(value)) return undefined
  try {
    return new Uint8Array(value)
  } catch {
    return undefined
  }
}

/** One recursive admission retains only a bounded node count and active container ancestors. */
type IStorageKeyValidationContext = {
  nodes: number
  readonly active: Set<readonly unknown[]>
}

/** Checks each supported key component without copying it or reading unrelated object fields. */
function validStorageKey(
  candidate: unknown,
  depth: number,
  context: IStorageKeyValidationContext
): boolean {
  context.nodes++
  if (context.nodes > KEY_DOMAIN_LIMITS.maxNodes || depth > KEY_DOMAIN_LIMITS.maxDepth) return false
  if (typeof candidate === 'string') return true
  if (typeof candidate === 'number') return Number.isFinite(candidate)
  if (Array.isArray(candidate)) {
    if (candidate.length === 0 || context.active.has(candidate)) return false
    context.active.add(candidate)
    for (let index = 0; index < candidate.length; index++)
      if (
        !Object.hasOwn(candidate, index) ||
        !validStorageKey(candidate[index], depth + 1, context)
      ) {
        context.active.delete(candidate)
        return false
      }
    context.active.delete(candidate)
    return true
  }
  /** Date and binary classification use actual built-in slots, preserving cross-realm inputs. */
  const date = dateValue(candidate)
  if (date !== undefined) return !Number.isNaN(date)
  /** A borrowed byte view supplies the native byte length without cloning caller storage. */
  const bytes = bufferValue(candidate)
  return bytes !== undefined && bytes.byteLength <= KEY_DOMAIN_LIMITS.maxBinaryBytes
}

/**
 * Checks the shared record-key domain before an implementation accesses storage. Accepts strings,
 * finite numbers, valid Dates, available ArrayBuffers, and nonempty, dense, acyclic arrays of keys.
 * KEY_DOMAIN_LIMITS bounds recursive depth, visited nodes, and each binary component's size.
 *
 * Date/ArrayBuffer inspection uses native internal slots for cross-realm support without copying
 * input data or trusting constructor names. Invalid keys produce INVALID_KEY with backend/key
 * details. label defaults to key and affects only the message. No key is copied or frozen by this
 * assertion.
 */
export function assertStorageKey(
  value: unknown,
  backend: IBackendKind | undefined,
  label = 'key'
): asserts value is IStorageKey {
  /** State belongs to this single pure validation call, never to a backend or later operation. */
  const context: IStorageKeyValidationContext = { nodes: 0, active: new Set() }
  if (!validStorageKey(value, 0, context))
    throw new StorageContractError(StorageContractErrorCode.invalidKey, {
      backend,
      key: value as IStorageKey,
      cause: new TypeError(StorageContractErrorText.invalidStorageKey(label))
    })
}
