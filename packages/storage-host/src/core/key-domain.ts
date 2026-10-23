import { base64ToBytes, bytesToBase64 } from '@migaia/utils/bytes'
import {
  KEY_DOMAIN_LIMITS,
  StorageContractError,
  StorageContractErrorCode,
  assertStorageKey,
  compareStorageKeys,
  snapshotStorageKey,
  type IBackendKind,
  type IKeyRange,
  type IStorageKey
} from '@migaia/storage-contract'

import { STORAGE_MEMORY_BACKEND } from '../state-constants.js'
import { isArrayBuffer } from '@migaia/utils/bytes'
import { StorageErrorText } from '../error-text.js'
import { StorageErrorCode, createStorageRangeError, createStorageTypeError } from '../errors.js'

/** Neutral typing borrows the original structured clone without importing a platform library. */
const keyCloneHost = globalThis as unknown as { structuredClone?: <T>(value: T) => T }
/** Persisted flat-key tags and range labels are stable across every backend consumer. */
const FlatStorageKeyWire = {
  prefix: 'k:',
  text: 's',
  number: 'n',
  date: 'd',
  binary: 'b',
  array: 'a',
  lower: 'range.lower',
  upper: 'range.upper'
} as const

/** Read a real date value while preserving the original cross-realm clone behavior. */
const dateValue = (value: unknown): number | undefined => {
  try {
    /** Borrow the original host function once without changing its invocation behavior. */
    const clone = keyCloneHost.structuredClone
    /** Native cloning retains cross-realm date recognition before reading its timestamp. */
    const cloned = typeof clone === 'function' ? clone(value) : value
    return cloned instanceof Date ? cloned.getTime() : undefined
  } catch {
    return undefined
  }
}

/** Read a detached real binary key using the existing buffer brand helper. */
const bufferValue = (value: unknown): ArrayBuffer | undefined => {
  if (!isArrayBuffer(value)) return undefined
  try {
    /** The original host function is captured once for this binary brand check. */
    const clone = keyCloneHost.structuredClone
    /** Cloning isolates the returned bytes from caller mutation. */
    const cloned = typeof clone === 'function' ? clone(value) : value
    if (!isArrayBuffer(cloned)) return undefined
    /** Return independent storage-key bytes rather than a shared native buffer view. */
    const bytes = new Uint8Array(cloned as ArrayBuffer)
    return bytes.slice().buffer
  } catch {
    return undefined
  }
}

/** Preserve the existing reversible flat-key wire tags and shape. */
const toWire = (value: IStorageKey): unknown => {
  if (typeof value === 'string') return [FlatStorageKeyWire.text, value]
  if (typeof value === 'number') return [FlatStorageKeyWire.number, value]
  /** Dates and binary keys retain the original flat-wire domain recognition. */
  const date = dateValue(value)
  if (date !== undefined) return [FlatStorageKeyWire.date, date]
  /** Binary wire payloads reuse the canonical bytes/base64 owner. */
  const buffer = bufferValue(value)
  if (buffer !== undefined)
    return [FlatStorageKeyWire.binary, bytesToBase64(new Uint8Array(buffer))]
  /** Indexed access deliberately ignores user-overridden Array map methods. */
  const source = value as readonly IStorageKey[]
  /** Retain one canonical child list for this nested key only. */
  const entries: unknown[] = []
  for (let index = 0; index < source.length; index += 1) entries.push(toWire(source[index]!))
  return [FlatStorageKeyWire.array, entries]
}

/** Encode a validated key reversibly for flat backends. */
export const encodeFlatStorageKey = (value: IStorageKey): string =>
  `${FlatStorageKeyWire.prefix}${encodeURIComponent(JSON.stringify(toWire(value)))}`

/** Decode a flat key with bounded recursion and final domain validation. */
export const decodeFlatStorageKey = (
  encoded: string,
  backend: IBackendKind = STORAGE_MEMORY_BACKEND
): IStorageKey | undefined => {
  try {
    if (!encoded.startsWith(FlatStorageKeyWire.prefix)) return undefined
    /** Native parsing errors retain the original malformed-wire result of undefined. */
    const root = JSON.parse(
      decodeURIComponent(encoded.slice(FlatStorageKeyWire.prefix.length))
    ) as unknown
    /** Count only this key's decoded nodes against the original contract budget. */
    let nodes = 0
    /** Decode one original two-field tag tuple before the final canonical domain check. */
    const decode = (wire: unknown, depth: number): IStorageKey => {
      nodes += 1
      if (nodes > KEY_DOMAIN_LIMITS.maxNodes || depth > KEY_DOMAIN_LIMITS.maxDepth)
        throw createStorageRangeError(
          StorageErrorCode.deserializeFailed,
          StorageErrorText.storageKeyDecodeLimitExceeded
        )
      if (!Array.isArray(wire) || wire.length !== 2 || typeof wire[0] !== 'string')
        throw createStorageTypeError(
          StorageErrorCode.deserializeFailed,
          StorageErrorText.storageKeyWireInvalid
        )
      const [tag, payload] = wire
      if (tag === FlatStorageKeyWire.text && typeof payload === 'string') return payload
      if (
        tag === FlatStorageKeyWire.number &&
        typeof payload === 'number' &&
        Number.isFinite(payload)
      )
        return payload
      if (tag === FlatStorageKeyWire.date && typeof payload === 'number') return new Date(payload)
      if (tag === FlatStorageKeyWire.binary && typeof payload === 'string') {
        /** Decode bytes through the original utility before checking the shared key budget. */
        const bytes = base64ToBytes(payload)
        if (bytes.byteLength > KEY_DOMAIN_LIMITS.maxBinaryBytes)
          throw createStorageRangeError(
            StorageErrorCode.deserializeFailed,
            StorageErrorText.storageKeyBinaryTooLarge
          )
        return bytes.slice().buffer as ArrayBuffer
      }
      if (tag === FlatStorageKeyWire.array && Array.isArray(payload) && payload.length > 0)
        return payload.map((item) => decode(item, depth + 1))
      throw createStorageTypeError(
        StorageErrorCode.deserializeFailed,
        StorageErrorText.storageKeyWireTagInvalid
      )
    }
    /** A structurally decodable key still must satisfy the canonical domain validator. */
    const result = decode(root, 0)
    assertStorageKey(result, backend)
    return result
  } catch (error) {
    // 线材畸形（JSON 解析失败 / 形状非法）→ undefined，由调用方把损坏记录过滤掉。
    // 但「线材合法、域校验失败」的 `assertStorageKey` → StorageContractError(invalidKey) 必须冒泡，
    // 不得被静默吞掉（解码结果走同一 validator，违规键必须可观测而非隐形孤儿记录）。
    if (error instanceof StorageContractError) throw error
    return undefined
  }
}

/** Read and validate a range once so getter-backed inputs cannot change after validation. */
export const snapshotKeyRange = (
  range: IKeyRange | undefined,
  backend: IBackendKind
): IKeyRange | undefined => {
  if (range === undefined) return
  if (typeof range !== 'object' || range === null || Array.isArray(range))
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend,
      cause: new TypeError(StorageErrorText.keyRangeObject)
    })
  /** Each caller option is read once before any bound is cloned or compared. */
  let snapshot: IKeyRange
  try {
    snapshot = {
      lower: range.lower,
      lowerOpen: range.lowerOpen,
      upper: range.upper,
      upperOpen: range.upperOpen
    }
  } catch (cause) {
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, { backend, cause })
  }
  if (
    (snapshot.lowerOpen !== undefined && typeof snapshot.lowerOpen !== 'boolean') ||
    (snapshot.upperOpen !== undefined && typeof snapshot.upperOpen !== 'boolean')
  )
    throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
      backend,
      cause: new TypeError(StorageErrorText.keyRangeFlags)
    })
  /** Clone one range bound before validation so later caller mutation cannot alter the operation. */
  const snapshotBound = (value: IStorageKey, label: string): IStorageKey => {
    try {
      return snapshotStorageKey(value, backend, label)
    } catch (cause) {
      if (cause instanceof StorageContractError) throw cause
      throw new StorageContractError(StorageContractErrorCode.invalidKey, {
        backend,
        key: value,
        cause: new TypeError(StorageErrorText.keyRangeBound(label), { cause })
      })
    }
  }
  /** Fully detached range used by every downstream comparison and backend adapter. */
  const normalized: IKeyRange = {
    lower:
      snapshot.lower === undefined
        ? undefined
        : snapshotBound(snapshot.lower, FlatStorageKeyWire.lower),
    lowerOpen: snapshot.lowerOpen,
    upper:
      snapshot.upper === undefined
        ? undefined
        : snapshotBound(snapshot.upper, FlatStorageKeyWire.upper),
    upperOpen: snapshot.upperOpen
  }
  if (normalized.lower !== undefined && normalized.upper !== undefined) {
    /** Only the canonical key comparator decides ordering and empty-open intervals. */
    const comparison = compareStorageKeys(normalized.lower, normalized.upper)
    if (comparison > 0 || (comparison === 0 && (normalized.lowerOpen || normalized.upperOpen)))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend,
        cause: new RangeError(StorageErrorText.keyRangeInvalid)
      })
  }
  return normalized
}

/** Validate a range when no caller needs to retain the stable snapshot. */
export const assertKeyRange = (range: IKeyRange | undefined, backend: IBackendKind): void => {
  snapshotKeyRange(range, backend)
}
