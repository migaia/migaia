import { RpcContractErrorCode } from '../error-code.js'
import { contractError, normalizePortable } from '../normalize.js'
import type { IRpcPortableValue } from '../types.js'
import type { IRpcEnvelope } from './types.js'

/** Normalize an untrusted V1 semantic envelope with exact discriminator checks. */
export function normalizeRpcEnvelope(value: unknown): IRpcEnvelope {
  const normalized = normalizePortable(value)
  if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)) {
    throw contractError(RpcContractErrorCode.invalidEnvelope)
  }
  const record = normalized as Record<string, IRpcPortableValue>
  const kind = record.kind
  if (typeof kind !== 'string') throw contractError(RpcContractErrorCode.invalidEnvelope)
  const hasOnly = (required: readonly string[], optional: readonly string[] = []): boolean => {
    const allowed = new Set([...required, ...optional])
    return (
      Object.keys(record).every((key) => allowed.has(key)) && required.every((key) => key in record)
    )
  }
  if (kind === 'response') {
    if (record.ok !== true && record.ok !== false)
      throw contractError(RpcContractErrorCode.invalidEnvelope)
    if (typeof record.id !== 'string') throw contractError(RpcContractErrorCode.invalidEnvelope)
    if (record.ok === true) {
      if (!hasOnly(['kind', 'ok', 'id', 'data']) || record.data === undefined)
        throw contractError(RpcContractErrorCode.invalidEnvelope)
    } else {
      if (!hasOnly(['kind', 'ok', 'id', 'code', 'message'], ['data', 'error']))
        throw contractError(RpcContractErrorCode.invalidEnvelope)
      if (typeof record.code !== 'string' || typeof record.message !== 'string')
        throw contractError(RpcContractErrorCode.invalidEnvelope)
      if (record.error !== undefined && !isSerializedError(record.error))
        throw contractError(RpcContractErrorCode.invalidEnvelope)
    }
  } else if (kind === 'request') {
    if (
      !hasOnly(['kind', 'id', 'method', 'data']) ||
      typeof record.id !== 'string' ||
      typeof record.method !== 'string'
    )
      throw contractError(RpcContractErrorCode.invalidEnvelope)
  } else if (kind === 'discovery') {
    if (
      !hasOnly(['kind', 'id', 'version', 'acceptVersions'], ['data']) ||
      typeof record.id !== 'string' ||
      typeof record.version !== 'string' ||
      !Array.isArray(record.acceptVersions)
    )
      throw contractError(RpcContractErrorCode.invalidEnvelope)
    if (record.acceptVersions.some((item) => typeof item !== 'string'))
      throw contractError(RpcContractErrorCode.invalidEnvelope)
  } else if (kind === 'variation') {
    if (!hasOnly(['kind', 'id', 'data']) || typeof record.id !== 'string')
      throw contractError(RpcContractErrorCode.invalidEnvelope)
  } else {
    throw contractError(RpcContractErrorCode.invalidEnvelope)
  }
  return normalized as IRpcEnvelope
}

/** Validate the bounded portable error graph carried by a V1 response failure. */
function isSerializedError(value: IRpcPortableValue, depth = 0): boolean {
  if (depth > 32 || typeof value !== 'object' || value === null || Array.isArray(value))
    return false
  const record = value as Record<string, IRpcPortableValue>
  const required = ['source', 'code', 'name', 'message', 'stack']
  if (!required.every((key) => typeof record[key] === 'string')) return false
  if (record.cause !== undefined && !isSerializedError(record.cause, depth + 1)) return false
  if (
    record.errors !== undefined &&
    (!Array.isArray(record.errors) ||
      !record.errors.every((child) => isSerializedError(child, depth + 1)))
  )
    return false
  return Object.keys(record).every(
    (key) => required.includes(key) || key === 'cause' || key === 'errors'
  )
}
