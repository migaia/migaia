/**
 * Admits portable values through the canonical serialize walker with distinct wire and native
 * snapshot policies. Each invocation owns only its traversal; binary execution proofs, sessions and
 * physical IO are outside this pure boundary.
 */
import type { IRpcErrorWireMetadata } from '../contract/types.js'
import { createPortableWalker } from '@migaia/serialize'
import {
  rpcWirePortableStrategy,
  rpcNativePortableStrategy,
  raiseRpcPortableViolation
} from './strategy.js'
import type { IRpcPortableValue, IRpcWirePortableValue } from '../contract/types.js'

export { RPC_PORTABLE_MAX_DEPTH } from './strategy.js'
export { rpcPortableBackingLength, rpcPortableViewLength } from './intrinsics.js'

/** Preserve negotiated native values using the same canonical graph owner as ordinary wire data. */
export function normalizeRpcPortable(
  value: unknown,
  errorMetadata?: IRpcErrorWireMetadata
): IRpcPortableValue {
  return normalizePortable(value, 0, new Set<object>(), true, errorMetadata)
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
  active?: Set<object>,
  nativeBinary?: false,
  errorMetadata?: IRpcErrorWireMetadata
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
  nativeBinary: boolean | (() => never),
  errorMetadata?: IRpcErrorWireMetadata
): IRpcPortableValue
/** Keep wire and native return domains distinct while retaining the original depth and ancestors. */
export function normalizePortable(
  value: unknown,
  depth = 0,
  active?: Set<object>,
  nativeBinary: boolean | (() => never) = false,
  errorMetadata?: IRpcErrorWireMetadata
): IRpcPortableValue {
  /** All traversal scratch belongs to this pure call; no retained walker state lives in contract. */
  const policy = nativeBinary === true ? rpcNativePortableStrategy : rpcWirePortableStrategy
  /** Error presentation belongs to the supplied caller maps, never a contract singleton registry. */
  const walker = createPortableWalker(
    errorMetadata
      ? {
          ...policy,
          violation: (reason, cause) => raiseRpcPortableViolation(reason, cause, errorMetadata)
        }
      : policy
  )
  return walker.value(
    value,
    active,
    depth,
    typeof nativeBinary === 'function' ? nativeBinary : undefined
  ) as IRpcPortableValue
}
