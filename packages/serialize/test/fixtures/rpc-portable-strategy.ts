import { createPortableWalker, type IPortableWalkerStrategy } from '../../src/codec.js'

/** Copied RPC contract identity is fixture policy; serialize production code owns no RPC rule. */
const RpcPortableOracle = {
  source: '@migaia/rpc/contract',
  code: 'INVALID_ENVELOPE',
  message: 'rpc envelope is invalid',
  invalid: 'rpc portable input is invalid',
  /** The original wire normalizer leaves root byte-copy failures outside its container catch. */
  binaryCopy: 'rpc portable byte copy failed'
} as const

/**
 * RPC's wire-policy oracle contains no recursion. The serialize factory owns depth, ancestor
 * tracking, fused byte bounds and binary propagation; these callbacks only select node policy.
 */
export const rpcPortableStrategy: IPortableWalkerStrategy = {
  maxDepth: 64,
  scalar(value, context) {
    if (
      !(
        value === null ||
        typeof value === 'string' ||
        typeof value === 'boolean' ||
        (typeof value === 'number' && Number.isFinite(value))
      )
    )
      context.reject(RpcPortableOracle.invalid)
    return { value }
  },
  binary(value, context) {
    if (context.isUint8Array(value)) {
      try {
        return context.bytesToBase64url(new Uint8Array(value as Uint8Array))
      } catch (cause) {
        return context.reject(RpcPortableOracle.binaryCopy, cause)
      }
    }
    if (value instanceof Date || value instanceof Map || value instanceof Set)
      context.reject(RpcPortableOracle.invalid)
    return undefined
  },
  record(value, context) {
    if (Array.isArray(value)) return undefined
    /** Only plain records and null-prototype records belong to the RPC wire policy. */
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
      context.reject(RpcPortableOracle.invalid)
    /** Parent keys and values are captured before the kernel visits any child node. */
    const keys = Object.keys(value)
    /** Every own string field is read once, including tag accessor fields. */
    const entries = keys.map((key) => [key, (value as Record<string, unknown>)[key]] as const)
    /** Captured tag values are checked without any second caller-field read. */
    const tag = entries.find(([key]) => key === '$rpc')?.[1]
    /** The payload is still untrusted until spelling and unused bits are canonical. */
    const base64url = entries.find(([key]) => key === 'base64url')?.[1]
    if (
      keys.length === 2 &&
      keys.includes('$rpc') &&
      tag === 'bytes' &&
      typeof base64url === 'string' &&
      context.isCanonicalBase64url(base64url)
    )
      return { entries, tag: base64url }
    return { entries, output: Object.create(null) as Record<string, unknown> }
  },
  key(key, context) {
    if (key === '$rpc') context.reject(RpcPortableOracle.invalid)
  },
  finish(value) {
    return Object.freeze(value)
  },
  violation(reason, cause) {
    // Root copy errors stay raw; an enclosing record/array supplies the original RPC boundary.
    if (reason === RpcPortableOracle.binaryCopy) throw cause
    // Existing classified Contract failures keep their exact instance across getter boundaries.
    if (
      cause instanceof Error &&
      (cause as { source?: unknown }).source === RpcPortableOracle.source &&
      typeof (cause as { code?: unknown }).code === 'string'
    )
      throw cause
    /** Native class, text and source/code match RPC; a trapped application error stays on cause. */
    const error = new TypeError(
      RpcPortableOracle.message,
      cause === undefined ? undefined : { cause }
    )
    Object.defineProperty(error, 'source', { value: RpcPortableOracle.source, enumerable: true })
    Object.defineProperty(error, 'code', { value: RpcPortableOracle.code, enumerable: true })
    throw error
  }
}

/** Public factory specializes one kernel with the test-owned RPC wire policy. */
export const rpcPortableWalker = createPortableWalker(rpcPortableStrategy)
