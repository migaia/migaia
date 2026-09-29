import { createInvalidWireError, normalizeRpcSerializedError, sanitizeText } from './error.js'
import { normalizePortable } from './normalize.js'
import type { IRpcJsonRpcErrorObject, IRpcPortableValue, IRpcSerializedError } from './types.js'
import {
  RpcJsonRpcWireError,
  RpcWireErrorFallback,
  RpcWireErrorLimit,
  RpcWireErrorViolation
} from './wire-error-constants.js'

/** Map a validated wire error into JSON-RPC without owning the integer code table. */
export function toJsonRpcError(error: IRpcSerializedError, code: number): IRpcJsonRpcErrorObject {
  const wire = normalizeRpcSerializedError(error)
  if (!Number.isSafeInteger(code))
    throw createInvalidWireError(code, '/code', RpcWireErrorViolation.jsonRpcCode)
  return Object.freeze({
    code,
    message: wire.message,
    data: Object.freeze({ [RpcJsonRpcWireError.dataKey]: wire }) as unknown as IRpcPortableValue
  })
}

/** Recover the canonical extension or synthesize one wire node for a foreign peer. */
export function fromJsonRpcError(value: unknown): IRpcSerializedError {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw createInvalidWireError(value, '', RpcWireErrorViolation.jsonRpcShape)
  /** Read each JSON-RPC field once so a hostile getter cannot change the decision. */
  let code: unknown
  let message: unknown
  let data: unknown
  try {
    const record = value as Record<string, unknown>
    code = record.code
    message = record.message
    data = record.data
  } catch (error) {
    throw createInvalidWireError(error, '', RpcWireErrorViolation.read)
  }
  if (!Number.isSafeInteger(code) || typeof message !== 'string')
    throw createInvalidWireError(value, '', RpcWireErrorViolation.jsonRpcShape)
  /** Foreign messages are validated; only the locally synthesized stack may truncate. */
  const checkedMessage = sanitizeText(message, false)
  if (checkedMessage.changed)
    throw createInvalidWireError(value, '/message', RpcWireErrorViolation.surrogate)
  if (checkedMessage.bytes > RpcWireErrorLimit.maxStringBytes)
    throw createInvalidWireError(value, '/message', RpcWireErrorViolation.stringBytes)
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    let embedded = false
    let wire: unknown
    try {
      embedded = Object.hasOwn(data, RpcJsonRpcWireError.dataKey)
      if (embedded) wire = (data as Record<string, unknown>)[RpcJsonRpcWireError.dataKey]
    } catch (error) {
      throw createInvalidWireError(error, '/data', RpcWireErrorViolation.read)
    }
    if (embedded) return normalizeRpcSerializedError(wire, { unknownFields: 'ignore' })
  }
  /** Synthesize the stable foreign identity from the safe integer and message. */
  const stack = sanitizeText(`${RpcWireErrorFallback.name}: ${message}`)
  const result: {
    source: string
    code: string
    name: string
    message: string
    stack: string
    data?: IRpcPortableValue
    truncated?: true
  } = {
    source: RpcJsonRpcWireError.foreignSource,
    code: String(code),
    name: RpcWireErrorFallback.name,
    message,
    stack: stack.value
  }
  if (stack.changed) result.truncated = true
  if (data !== undefined) {
    try {
      result.data = normalizePortable(data, 17)
    } catch (error) {
      throw createInvalidWireError(error, '/data', RpcWireErrorViolation.dataPortable)
    }
  }
  return normalizeRpcSerializedError(result)
}
