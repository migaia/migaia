import { isArrayBuffer, utf8ByteLength } from '@migaia/utils/bytes'
import { isPlainObject } from '@migaia/utils/object'

/** Captured intrinsic Map size getter used as a cross-realm brand probe. */
const mapSizeGetter = Object.getOwnPropertyDescriptor(Map.prototype, 'size')?.get

/** Captured intrinsic Set size getter used as a cross-realm brand probe. */
const setSizeGetter = Object.getOwnPropertyDescriptor(Set.prototype, 'size')?.get

/** Isolated receiver for invoking Map's intrinsic brand getter without call/apply/bind. */
const mapBrandProbe = Object.create(null) as object

/** Isolated receiver for invoking Set's intrinsic brand getter without call/apply/bind. */
const setBrandProbe = Object.create(null) as object

if (mapSizeGetter !== undefined)
  Object.defineProperty(mapBrandProbe, 'size', { get: mapSizeGetter })
if (setSizeGetter !== undefined)
  Object.defineProperty(setBrandProbe, 'size', { get: setSizeGetter })

/** Recognizes Map values across realms without trusting constructors or mutable tags. */
const isMapValue = (value: object): boolean => {
  if (mapSizeGetter === undefined) return false
  try {
    Reflect.get(mapBrandProbe, 'size', value)
    return true
  } catch {
    return false
  }
}

/** Recognizes Set values across realms without trusting constructors or mutable tags. */
const isSetValue = (value: object): boolean => {
  if (setSizeGetter === undefined) return false
  try {
    Reflect.get(setBrandProbe, 'size', value)
    return true
  } catch {
    return false
  }
}

/** Rejects structured-clone containers that JSON would silently collapse to misleading bytes. */
const isNonJsonStructuredCloneValue = (value: unknown): boolean => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (isMapValue(value) || isSetValue(value) || isArrayBuffer(value)) return true
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(value)) return true
  return !isPlainObject(value)
}

/**
 * Measures one JSON-domain payload with the storage wire/budget boundary. Undefined serializes to
 * zero; any serialization failure returns the safe maximum so callers fail closed before writes.
 */
export const safeJsonPayloadByteLength = (value: unknown): number => {
  try {
    /** Tracks the replacer root so only nested undefined values fail closed. */
    let root = true
    const serialized = JSON.stringify(value, (_key, current) => {
      if (current === undefined && !root) throw new TypeError()
      root = false
      if (isNonJsonStructuredCloneValue(current)) throw new TypeError()
      return current
    })
    if (serialized === undefined) return 0
    return utf8ByteLength(serialized)
  } catch {
    return Number.MAX_SAFE_INTEGER
  }
}
