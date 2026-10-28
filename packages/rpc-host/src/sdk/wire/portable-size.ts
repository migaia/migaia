/**
 * Accounts bytes for admitted portable outcomes and native binary backings against caller budgets.
 * The traversal is a rejection-size witness only; it neither copies/reorders business data nor owns
 * codec admission, retained outcomes or transport writes.
 */
import { utf8ByteLength, isArrayBuffer, isUint8Array } from '@migaia/utils/bytes'
import type { IRpcPortableValue } from '@migaia/rpc-contract/protocol'
import type { IRpcSerializedError } from '@migaia/rpc-contract/errors'
import { BinaryShape } from './binary-shape.ts'

/**
 * Count portable result data exactly unless the caller's trusted admission budget is exceeded. An
 * over-budget result is only a rejection witness; replay callers omit the budget for exact bytes.
 * Record entry snapshots preserve existing property evaluation order before recursive traversal.
 */
export function portableBytes(
  value: IRpcPortableValue | IRpcSerializedError | undefined,
  budget = Infinity
): number {
  return measurePortableBytes(value, budget, new BinaryShape())
}

/** Recurse once without cloning data; one explicit native reader preserves original backing slots. */
function measurePortableBytes(
  value: IRpcPortableValue | IRpcSerializedError | undefined,
  budget: number,
  shape: BinaryShape
): number {
  if (value === undefined) return 0
  // Every UTF-16 code unit requires at least one UTF-8 byte, so rejection needs no full scan here.
  if (typeof value === 'string') return value.length > budget ? value.length : utf8ByteLength(value)
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return 8
  if (Array.isArray(value)) {
    /** Match reduce's sparse-index semantics while stopping the recursive walk after rejection. */
    let bytes = 0
    /** Native reduce captures the initial length before visiting any element. */
    const length = value.length
    for (let index = 0; index < length; index++) {
      if (!(index in value)) continue
      bytes += measurePortableBytes(value[index], budget - bytes, shape)
      if (bytes > budget) return bytes
    }
    return bytes
  }
  /** Native results charge their accessible full backing; they cannot masquerade as empty records. */
  if (isArrayBuffer(value)) return shape.backingLength(value)
  if (isUint8Array(value)) return shape.backingLength(shape.view(value).backing)
  if (
    '$rpc' in value &&
    value.$rpc === 'bytes' &&
    'base64url' in value &&
    typeof value.base64url === 'string'
  ) {
    const length = value.base64url.length
    return Math.floor((length * 3) / 4)
  }
  /** Keep one canonical traversal for admission and exact replay accounting. */
  let bytes = 0
  for (const [key, item] of Object.entries(value)) {
    bytes += measurePortableBytes(key, budget - bytes, shape)
    if (bytes > budget) return bytes
    bytes += measurePortableBytes(item, budget - bytes, shape)
    if (bytes > budget) return bytes
  }
  return bytes
}
