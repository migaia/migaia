import { StorageContractError, StorageContractErrorCode } from './errors.js'
import type { ICodec } from './codec.js'
import { COLLECTIONS_CODEC_STRING_PAYLOAD, COLLECTIONS_CODEC_UNDEFINED_ROOT } from './error-text.js'

/** Stable wire identity for the only collection-preserving persistence format. */
export const COLLECTIONS_JSON_CODEC_NAME = 'migaia-collections-json-v1'

/** Exact tuple discriminator for Map values in the versioned wire format. */
const MAP_KIND = 'map'
/** Exact tuple discriminator for Set values in the versioned wire format. */
const SET_KIND = 'set'

/** Captured receiver-aware property access used to invoke intrinsic brand accessors safely. */
const intrinsicReflectGet = Reflect.get
/** Captured intrinsic Map size accessor, which validates the Map internal slot. */
const intrinsicMapSize = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get
/** Captured intrinsic Set size accessor, which validates the Set internal slot. */
const intrinsicSetSize = Object.getOwnPropertyDescriptor(Set.prototype, 'size')?.get
/** Isolated holder for the captured Map size accessor and its receiver-aware brand probe. */
const mapSizeProbe = Object.create(null)
/** Isolated holder for the captured Set size accessor and its receiver-aware brand probe. */
const setSizeProbe = Object.create(null)
if (intrinsicMapSize !== undefined)
  Object.defineProperty(mapSizeProbe, 'size', { configurable: false, get: intrinsicMapSize })
if (intrinsicSetSize !== undefined)
  Object.defineProperty(setSizeProbe, 'size', { configurable: false, get: intrinsicSetSize })

/** Detect a genuine Map by its internal slot, without cloning or consulting user properties. */
const isIntrinsicMap = (value: unknown): value is Map<unknown, unknown> => {
  if (value === null || typeof value !== 'object') return false
  try {
    intrinsicReflectGet(mapSizeProbe, 'size', value)
    return true
  } catch {
    return false
  }
}

/** Detect a genuine Set by its internal slot, without cloning or consulting user properties. */
const isIntrinsicSet = (value: unknown): value is Set<unknown> => {
  if (value === null || typeof value !== 'object') return false
  try {
    intrinsicReflectGet(setSizeProbe, 'size', value)
    return true
  } catch {
    return false
  }
}

/** Encode collection instances with an exact versioned tuple reserved by this codec. */
const collectionReplacer = (_key: string, value: unknown): unknown => {
  if (isIntrinsicMap(value) || value instanceof Map)
    return [COLLECTIONS_JSON_CODEC_NAME, MAP_KIND, [...value]]
  if (isIntrinsicSet(value) || value instanceof Set)
    return [COLLECTIONS_JSON_CODEC_NAME, SET_KIND, [...value]]
  return value
}

/** Decode only the exact tuples emitted by the versioned collection codec. */
const collectionReviver = (_key: string, value: unknown): unknown => {
  if (!Array.isArray(value) || value.length !== 3 || value[0] !== COLLECTIONS_JSON_CODEC_NAME)
    return value
  if (value[1] === MAP_KIND && Array.isArray(value[2]))
    return new Map(value[2] as [unknown, unknown][])
  if (value[1] === SET_KIND && Array.isArray(value[2])) return new Set(value[2])
  return value
}

/**
 * Encodes nested Map/Set values as reserved, versioned JSON tuples instead of empty JSON objects.
 * Use for JSON-shaped persistence data that also contains collections. name is
 * migaia-collections-json-v1 and output is text; the descriptor is frozen.
 *
 * Ordinary JSON restrictions still hold: cycles, BigInt, and an undefined root fail, while values
 * omitted or transformed by JSON retain that behavior. Decode restores reserved Map/Set tuples;
 * unrelated arrays remain arrays. Encoding failure, non-string input, invalid JSON, or collection
 * reconstruction failure reject with INVALID_ARGUMENT and the original reason on cause. No timer,
 * cancellation listener, or storage operation is created here.
 */
export const collectionsJsonCodec: ICodec<unknown, string> = Object.freeze({
  /** Stable versioned identity used by encoded collection tuples. */
  name: COLLECTIONS_JSON_CODEC_NAME,
  /** Encoded collections are JSON text and can use a text-capable storage route. */
  output: 'text',
  /** Returns JSON text with explicit Map/Set tuples, or rejects with a coded format error. */
  async encode(value: unknown): Promise<string> {
    try {
      const encoded = JSON.stringify(value, collectionReplacer)
      if (encoded === undefined) throw new TypeError(COLLECTIONS_CODEC_UNDEFINED_ROOT)
      return encoded
    } catch (cause) {
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
    }
  },
  /** Parses text and restores recognized collection tuples; invalid data rejects with its cause. */
  async decode(raw: unknown): Promise<unknown> {
    if (typeof raw !== 'string')
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, {
        cause: new TypeError(COLLECTIONS_CODEC_STRING_PAYLOAD)
      })
    try {
      return JSON.parse(raw, collectionReviver)
    } catch (cause) {
      throw new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
    }
  }
})
