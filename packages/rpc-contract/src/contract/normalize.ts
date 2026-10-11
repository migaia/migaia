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

/** Validate and snapshot a portable value, reading each ordinary object field once. */
export function normalizePortable(
  value: unknown,
  depth?: number,
  active?: Set<object>
): IRpcWirePortableValue
/** Only the negotiated runtime branch may preserve a native value in the semantic snapshot. */
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
