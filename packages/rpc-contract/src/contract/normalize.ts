import { createPortableWalker } from '@migaia/serialize'
import { rpcWirePortableStrategy, rpcNativePortableStrategy } from './portable-strategy.js'
import type { IRpcPortableValue, IRpcWirePortableValue } from './types.js'

export { RPC_PORTABLE_MAX_DEPTH } from './portable-strategy.js'
export {
  markRpcPortableBinary,
  hasRpcPortableBinary,
  rpcPortableBackingLength,
  rpcPortableViewLength
} from './portable-binary.js'

/** Capture wire policy once; the sole serialize kernel owns every request's portable traversal. */
const wirePortableWalker = createPortableWalker(rpcWirePortableStrategy)
/** Capture native policy once without creating another recursive owner or per-call strategy. */
const nativePortableWalker = createPortableWalker(rpcNativePortableStrategy)

/** Preserve negotiated native values using the same canonical graph owner as ordinary wire data. */
export function normalizeRuntimePortable(value: unknown): IRpcPortableValue {
  return normalizePortable(value, 0, new Set<object>(), true)
}

/**
 * Validate and snapshot wire business data with a default starting depth of zero and a maximum
 * traversal depth of 64. Object fields are read once in own-key order into frozen null-prototype
 * records; arrays are copied/frozen and Uint8Array becomes a canonical bytes record. Nonfinite
 * numbers, cycles, unsupported values and malformed bytes tags throw a Contract-coded error. Native
 * ArrayBuffer values require the explicit negotiated-native overload, not this default wire path.
 */
export function normalizePortable(
  value: unknown,
  depth?: number,
  active?: Set<object>
): IRpcWirePortableValue
/**
 * The negotiated runtime branch can preserve original genuine ArrayBuffer/Uint8Array identities
 * instead of encoding bytes; those native values are not frozen or copied. The supplied active
 * ancestor set and starting depth belong to the current traversal. A guard function can reject
 * native values at the original admission point without granting a transport capability.
 */
export function normalizePortable(
  value: unknown,
  depth: number,
  active: Set<object>,
  nativeBinary: boolean | (() => never)
): IRpcPortableValue
/** Keep wire and native return domains distinct while retaining the original depth and ancestors. */
export function normalizePortable(
  value: unknown,
  depth = 0,
  active?: Set<object>,
  nativeBinary: boolean | (() => never) = false
): IRpcPortableValue {
  return (nativeBinary === true ? nativePortableWalker : wirePortableWalker).value(
    value,
    active,
    depth,
    typeof nativeBinary === 'function' ? nativeBinary : undefined
  ) as IRpcPortableValue
}
