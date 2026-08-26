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
import { isStorageErrorFamily } from './error-family.js'
import { StorageBackend } from '../constants.js'
import { isArrayBuffer } from '@migaia/utils/bytes'

// key 域纯校验（`KEY_DOMAIN_LIMITS`/`assertStorageKey`/`assertStringStorageKey`/`compareStorageKeys`）
// 已迁往 `@migaia/storage-contract`；re-export 保持既有 import 路径不变。
export {
  KEY_DOMAIN_LIMITS,
  assertStorageKey,
  snapshotStorageKey,
  assertStringStorageKey,
  compareStorageKeys
} from '@migaia/storage-contract'

const dateValue = (value: unknown): number | undefined => {
  try {
    const clone = globalThis.structuredClone
    const cloned = typeof clone === 'function' ? clone(value) : value
    return cloned instanceof Date ? cloned.getTime() : undefined
  } catch {
    return undefined
  }
}

const bufferValue = (value: unknown): ArrayBuffer | undefined => {
  if (!isArrayBuffer(value)) return undefined
  try {
    const clone = globalThis.structuredClone
    const cloned = typeof clone === 'function' ? clone(value) : value
    if (!isArrayBuffer(cloned)) return undefined
    const bytes = new Uint8Array(cloned as ArrayBuffer)
    return bytes.slice().buffer
  } catch {
    return undefined
  }
}

const toWire = (value: IStorageKey): unknown => {
  if (typeof value === 'string') return ['s', value]
  if (typeof value === 'number') return ['n', value]
  const date = dateValue(value)
  if (date !== undefined) return ['d', date]
  const buffer = bufferValue(value)
  if (buffer !== undefined) return ['b', bytesToBase64(new Uint8Array(buffer))]
  const source = value as readonly IStorageKey[]
  const entries: unknown[] = []
  for (let index = 0; index < source.length; index += 1) entries.push(toWire(source[index]!))
  return ['a', entries]
}

/** Encode a validated key reversibly for flat backends. */
export const encodeFlatStorageKey = (value: IStorageKey): string =>
  `k:${encodeURIComponent(JSON.stringify(toWire(value)))}`

/** Decode a flat key with bounded iterative recursion and final domain validation. */
export const decodeFlatStorageKey = (
  encoded: string,
  backend: IBackendKind = StorageBackend.memory
): IStorageKey | undefined => {
  try {
    if (!encoded.startsWith('k:')) return undefined
    const root = JSON.parse(decodeURIComponent(encoded.slice(2))) as unknown
    let nodes = 0
    const decode = (wire: unknown, depth: number): IStorageKey => {
      nodes += 1
      if (nodes > KEY_DOMAIN_LIMITS.maxNodes || depth > KEY_DOMAIN_LIMITS.maxDepth)
        throw new RangeError('storage key exceeds decode limits')
      if (!Array.isArray(wire) || wire.length !== 2 || typeof wire[0] !== 'string')
        throw new TypeError('invalid storage key wire')
      const [tag, payload] = wire
      if (tag === 's' && typeof payload === 'string') return payload
      if (tag === 'n' && typeof payload === 'number' && Number.isFinite(payload)) return payload
      if (tag === 'd' && typeof payload === 'number') return new Date(payload)
      if (tag === 'b' && typeof payload === 'string') {
        const bytes = base64ToBytes(payload)
        if (bytes.byteLength > KEY_DOMAIN_LIMITS.maxBinaryBytes)
          throw new RangeError('key too large')
        return bytes.slice().buffer as ArrayBuffer
      }
      if (tag === 'a' && Array.isArray(payload) && payload.length > 0)
        return payload.map((item) => decode(item, depth + 1))
      throw new TypeError('invalid storage key wire tag')
    }
    const result = decode(root, 0)
    assertStorageKey(result, backend)
    return result
  } catch (error) {
    // 线材畸形（JSON 解析失败 / 形状非法）→ undefined，由调用方把损坏记录过滤掉。
    // 但「线材合法、域校验失败」的 `assertStorageKey` → StorageContractError(invalidKey) 必须冒泡，
    // 不得被静默吞掉（SW-A11「解码结果走同一 validator」，违规键必须可观测而非隐形孤儿记录）。
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
      cause: new TypeError('key range must be an object')
    })
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
      cause: new TypeError('key range open flags must be boolean')
    })
  /** Clone one range bound before validation so later caller mutation cannot alter the operation. */
  const snapshotBound = (value: IStorageKey, label: string): IStorageKey => {
    try {
      return snapshotStorageKey(value, backend, label)
    } catch (cause) {
      if (isStorageErrorFamily(cause)) throw cause
      throw new StorageContractError(StorageContractErrorCode.invalidKey, {
        backend,
        key: value,
        cause: new TypeError(`invalid ${label}`, { cause })
      })
    }
  }
  /** Fully detached range used by every downstream comparison and backend adapter. */
  const normalized: IKeyRange = {
    lower: snapshot.lower === undefined ? undefined : snapshotBound(snapshot.lower, 'range.lower'),
    lowerOpen: snapshot.lowerOpen,
    upper: snapshot.upper === undefined ? undefined : snapshotBound(snapshot.upper, 'range.upper'),
    upperOpen: snapshot.upperOpen
  }
  if (normalized.lower !== undefined && normalized.upper !== undefined) {
    const comparison = compareStorageKeys(normalized.lower, normalized.upper)
    if (comparison > 0 || (comparison === 0 && (normalized.lowerOpen || normalized.upperOpen)))
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        backend,
        cause: new RangeError('invalid key range')
      })
  }
  return normalized
}

/** Validate a range when no caller needs to retain the stable snapshot. */
export const assertKeyRange = (range: IKeyRange | undefined, backend: IBackendKind): void => {
  snapshotKeyRange(range, backend)
}
