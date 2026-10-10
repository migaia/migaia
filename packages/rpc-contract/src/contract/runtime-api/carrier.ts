import { encodeUtf8, isUint8Array } from '@migaia/utils/bytes'
import { invalidRpcEnvelope } from '../v1/route.js'
import { RpcEnvelopeViolation } from '../wire-constants.js'
import { RpcRuntimeCarrier, RpcRuntimeField } from './constants.js'

/** The fixed byte selector is allocated once; ordinary frames never scan their whole contents. */
const prefix = encodeUtf8(RpcRuntimeCarrier.prefix)

/** Selected protection output stays opaque until the canonical authentication owner consumes it. */
export type IRpcRuntimeCarrierSelection = Readonly<{ frame: unknown }>

/** Add only the parser selector, preserving the original protection output's value category. */
export function wrapRuntimeCarrier(frame: unknown): unknown {
  if (typeof frame === 'string') return RpcRuntimeCarrier.prefix + frame
  if (isUint8Array(frame)) {
    /** Byte carriers need one complete owned physical value before their original channel writer. */
    const result = new Uint8Array(prefix.length + frame.byteLength)
    result.set(prefix)
    result.set(frame, prefix.length)
    return result
  }
  return Object.freeze({ kind: RpcRuntimeCarrier.kind, frame })
}

/** Read only the fixed selector; a selected object has two own data fields and no permission data. */
export function readRuntimeCarrier(value: unknown): IRpcRuntimeCarrierSelection | undefined {
  if (typeof value === 'string')
    return value.startsWith(RpcRuntimeCarrier.prefix)
      ? Object.freeze({ frame: value.slice(RpcRuntimeCarrier.prefix.length) })
      : undefined
  if (isUint8Array(value)) {
    if (value.byteLength < prefix.length) return undefined
    for (let index = 0; index < prefix.length; index++)
      if (value[index] !== prefix[index]) return undefined
    return Object.freeze({ frame: value.subarray(prefix.length) })
  }
  if (value === null || typeof value !== 'object') return undefined
  /** Descriptor inspection never calls an outer kind getter or trusts inner routing data. */
  const kind = Object.getOwnPropertyDescriptor(value, RpcRuntimeField.kind)
  if (!kind || !Object.hasOwn(kind, 'value') || kind.value !== RpcRuntimeCarrier.kind)
    return undefined
  /** A known selector cannot conceal accessors or extra metadata outside protection. */
  const frame = Object.getOwnPropertyDescriptor(value, RpcRuntimeCarrier.frame)
  if (
    !kind.enumerable ||
    !frame?.enumerable ||
    !Object.hasOwn(frame, 'value') ||
    Reflect.ownKeys(value).length !== 2 ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw invalidRpcEnvelope(RpcEnvelopeViolation.payload, '/carrier')
  return Object.freeze({ frame: frame.value })
}
