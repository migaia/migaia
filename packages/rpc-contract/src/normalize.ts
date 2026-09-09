import { RpcContractErrorCode } from './error-code.js'
import { RPC_CONTRACT_SOURCE, RpcContractErrorText } from './error-text.js'
import type { IRpcPortableBytes, IRpcPortableRecord, IRpcPortableValue } from './types.js'

const RESERVED = '$rpc'
const MAX_DEPTH = 64

/** Detect a Uint8Array from this or another JavaScript realm without accepting other views. */
function isUint8Array(value: object): value is Uint8Array {
  if (value instanceof Uint8Array) return true
  try {
    return (
      ArrayBuffer.isView(value) &&
      (value as { readonly [Symbol.toStringTag]?: unknown })[Symbol.toStringTag] === 'Uint8Array'
    )
  } catch {
    return false
  }
}

/** Validate the unpadded base64url spelling, including unused-bit canonicality. */
function isCanonicalBase64url(value: string): boolean {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) return false
  if (value.length === 0) return true
  const last = value[value.length - 1]!
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const bits = alphabet.indexOf(last)
  if (bits < 0) return false
  if (value.length % 4 === 2) return (bits & 15) === 0
  if (value.length % 4 === 3) return (bits & 3) === 0
  return true
}

/** Add stable package identity while preserving native error type and cause. */
export function contractError(
  code: (typeof RpcContractErrorCode)[keyof typeof RpcContractErrorCode],
  cause?: unknown
): Error {
  const error = new TypeError(
    RpcContractErrorText[
      code === RpcContractErrorCode.invalidEnvelope ? 'invalidEnvelope' : 'invalidDescriptor'
    ],
    cause === undefined ? undefined : { cause }
  )
  Object.defineProperty(error, 'source', { value: RPC_CONTRACT_SOURCE, enumerable: true })
  Object.defineProperty(error, 'code', { value: code, enumerable: true })
  return error
}

/** Convert a byte array to canonical unpadded base64url without Node dependencies. */
function toBase64url(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    output += alphabet[first >> 2]
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]
    if (second !== undefined) output += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]
    if (third !== undefined) output += alphabet[third & 63]
  }
  return output.replaceAll('+', '-').replaceAll('/', '_')
}

/** Validate and snapshot a portable value, reading each ordinary object field once. */
export function normalizePortable(
  value: unknown,
  depth = 0,
  active = new Set<object>()
): IRpcPortableValue {
  if (depth > MAX_DEPTH) throw contractError(RpcContractErrorCode.invalidEnvelope)
  if (value === null) return null
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return value
    case 'number':
      if (!Number.isFinite(value)) throw contractError(RpcContractErrorCode.invalidEnvelope)
      return value
    case 'object':
      break
    default:
      throw contractError(RpcContractErrorCode.invalidEnvelope)
  }
  if (isUint8Array(value)) {
    return Object.freeze({
      $rpc: 'bytes',
      base64url: toBase64url(new Uint8Array(value))
    }) as IRpcPortableBytes
  }
  if (value instanceof Date || value instanceof Map || value instanceof Set)
    throw contractError(RpcContractErrorCode.invalidEnvelope)
  if (active.has(value)) throw contractError(RpcContractErrorCode.invalidEnvelope)
  active.add(value)
  if (Array.isArray(value)) {
    try {
      const result = value.map((item) => normalizePortable(item, depth + 1, active))
      return Object.freeze(result) as readonly IRpcPortableValue[]
    } catch (error) {
      if (isContractError(error)) throw error
      throw contractError(RpcContractErrorCode.invalidEnvelope, error)
    } finally {
      active.delete(value)
    }
  }
  let prototype: object | null
  try {
    prototype = Object.getPrototypeOf(value)
  } catch (error) {
    active.delete(value)
    throw contractError(RpcContractErrorCode.invalidEnvelope, error)
  }
  if (prototype !== Object.prototype && prototype !== null) {
    active.delete(value)
    throw contractError(RpcContractErrorCode.invalidEnvelope)
  }
  try {
    const source = value as Record<string, unknown>
    const keys = Object.keys(source)
    const entries = keys.map((key) => [key, source[key]] as const)
    const values = new Map(entries)
    if (
      keys.length === 2 &&
      keys.includes('$rpc') &&
      values.get('$rpc') === 'bytes' &&
      typeof values.get('base64url') === 'string' &&
      isCanonicalBase64url(values.get('base64url') as string)
    ) {
      return Object.freeze({
        $rpc: 'bytes',
        base64url: values.get('base64url') as string
      }) as IRpcPortableBytes
    }
    const output: Record<string, IRpcPortableValue> = Object.create(null) as Record<
      string,
      IRpcPortableValue
    >
    for (const [key, child] of entries) {
      if (key === RESERVED) throw contractError(RpcContractErrorCode.invalidEnvelope)
      output[key] = normalizePortable(child, depth + 1, active)
    }
    return Object.freeze(output) as IRpcPortableRecord
  } catch (error) {
    if (isContractError(error)) throw error
    throw contractError(RpcContractErrorCode.invalidEnvelope, error)
  } finally {
    active.delete(value)
  }
}

/** Detect an already-classified contract error so nested causes remain stable. */
function isContractError(value: unknown): value is Error & { readonly code: string } {
  return (
    value instanceof Error &&
    (value as { readonly source?: unknown }).source === RPC_CONTRACT_SOURCE &&
    typeof (value as { readonly code?: unknown }).code === 'string'
  )
}
