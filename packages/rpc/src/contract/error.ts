import { RpcContractErrorText } from './error-text.js'
import type { IRpcSerializedError } from './types.js'

/** Fallback source for untagged values that cross the RPC boundary. */
const UNKNOWN_SOURCE = 'unknown'
/** Fallback code for untagged values that cross the RPC boundary. */
const UNKNOWN_CODE = 'UNKNOWN'

/** Projects an error graph to the portable RPC shape without replacing native errors. */
export function serializeRpcError(
  value: unknown,
  depth = 0,
  active = new Set<object>()
): IRpcSerializedError {
  /** Error-like view of the thrown value; primitives and plain objects get a local wrapper. */
  const error = isErrorLike(value) ? value : new Error(describeThrown(value))
  /** Identity fields read once through guarded accessors so hostile getters cannot throw here. */
  const identity = readIdentity(error)
  if (depth > 32 || active.has(error))
    return Object.freeze({ source: UNKNOWN_SOURCE, code: UNKNOWN_CODE, ...identity })
  active.add(error)
  const result: {
    source: string
    code: string
    name: string
    message: string
    stack: string
    cause?: IRpcSerializedError
    errors?: readonly IRpcSerializedError[]
  } = {
    source: readString(error, 'source', UNKNOWN_SOURCE),
    code: readString(error, 'code', UNKNOWN_CODE),
    ...identity
  }
  const cause = readUnknown(error, 'cause')
  if (cause !== undefined) result.cause = serializeRpcError(cause, depth + 1, active)
  const children = readUnknown(error, 'errors')
  if (Array.isArray(children))
    result.errors = children.map((child) => serializeRpcError(child, depth + 1, active))
  active.delete(error)
  return Object.freeze(result)
}

/** Rebuilds a native error graph while restoring the remote stack rather than generating one. */
export function deserializeRpcError(value: IRpcSerializedError, depth = 0): Error {
  const children =
    depth <= 32 && value.errors
      ? value.errors.map((child) => deserializeRpcError(child, depth + 1))
      : []
  const DomException = (
    globalThis as unknown as {
      DOMException?: new (message?: string, name?: string) => Error
    }
  ).DOMException
  const error =
    value.name === 'AggregateError'
      ? new AggregateError(children, value.message)
      : value.name === 'AbortError' && typeof DomException === 'function'
        ? new DomException(value.message, 'AbortError')
        : value.name === 'TypeError'
          ? new TypeError(value.message)
          : value.name === 'RangeError'
            ? new RangeError(value.message)
            : new Error(value.message)
  if (error.name !== value.name)
    Object.defineProperty(error, 'name', { value: value.name, configurable: true })
  Object.defineProperty(error, 'stack', {
    value: value.stack || `${value.name}: ${value.message}`,
    configurable: true,
    writable: true
  })
  Object.defineProperty(error, 'source', { value: value.source, enumerable: true })
  Object.defineProperty(error, 'code', { value: value.code, enumerable: true })
  if (depth <= 32 && value.cause)
    Object.defineProperty(error, 'cause', { value: deserializeRpcError(value.cause, depth + 1) })
  if (depth <= 32 && value.errors && value.name !== 'AggregateError')
    Object.defineProperty(error, 'errors', {
      value: children
    })
  return error
}

/**
 * Reads name/message/stack without trusting accessors. Preserves a source stack when present and
 * provides a non-empty local fallback, so the wire shape always satisfies the stack contract.
 */
function readIdentity(error: Error): { name: string; message: string; stack: string } {
  /** Error name; foreign objects without one serialize as a plain `Error`. */
  const name = readString(error, 'name', 'Error')
  /** Raw message; an empty string is a legitimate message and is kept. */
  const rawMessage = readUnknown(error, 'message')
  /** Normalized message text. */
  const message = typeof rawMessage === 'string' ? rawMessage : ''
  return { name, message, stack: readString(error, 'stack', `${name}: ${message}`) }
}

/** Converts a thrown non-Error value to message text; hostile conversions fall back to fixed text. */
function describeThrown(value: unknown): string {
  try {
    return String(value)
  } catch {
    return RpcContractErrorText.unstringifiableThrown
  }
}

/** Accept native and foreign-realm error objects while preserving their public identity fields. */
function isErrorLike(value: unknown): value is Error {
  if (value instanceof Error) return true
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  try {
    return (
      typeof candidate.name === 'string' &&
      typeof candidate.message === 'string' &&
      typeof candidate.stack === 'string'
    )
  } catch {
    return false
  }
}

/** Safely reads an error property across hostile or cross-realm objects. */
function readUnknown(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

/** Reads a non-empty string field, returning the caller's canonical fallback when absent or hostile. */
function readString(value: object, key: string, fallback: string): string {
  /** Guarded raw property value. */
  const candidate = readUnknown(value, key)
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : fallback
}
