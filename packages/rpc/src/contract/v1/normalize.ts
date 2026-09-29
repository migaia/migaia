import { RpcContractErrorCode } from '../error-code.js'
import { createContractError } from '../contract-error.js'
import { normalizeRpcSerializedError } from '../error.js'
import { normalizePortable } from '../normalize.js'
import { RpcWireErrorUnknownFieldMode } from '../wire-error-constants.js'
import type { IRpcPortableValue } from '../types.js'
import type { IRpcEnvelope } from './types.js'

/** Normalize an untrusted V1 semantic envelope with exact discriminator checks. */
export function normalizeRpcEnvelope(value: unknown): IRpcEnvelope {
  const normalized = normalizePortable(value)
  if (typeof normalized !== 'object' || normalized === null || Array.isArray(normalized)) {
    throw createContractError(RpcContractErrorCode.invalidEnvelope)
  }
  const record = normalized as Record<string, IRpcPortableValue>
  const kind = record.kind
  if (typeof kind !== 'string') throw createContractError(RpcContractErrorCode.invalidEnvelope)
  const hasOnly = (required: readonly string[], optional: readonly string[] = []): boolean => {
    const allowed = new Set([...required, ...optional])
    return (
      Object.keys(record).every((key) => allowed.has(key)) && required.every((key) => key in record)
    )
  }
  if (kind === 'response') {
    if (record.ok !== true && record.ok !== false)
      throw createContractError(RpcContractErrorCode.invalidEnvelope)
    if (typeof record.id !== 'string')
      throw createContractError(RpcContractErrorCode.invalidEnvelope)
    if (record.ok === true) {
      if (!hasOnly(['kind', 'ok', 'id', 'data']) || record.data === undefined)
        throw createContractError(RpcContractErrorCode.invalidEnvelope)
    } else {
      if (!hasOnly(['kind', 'ok', 'id', 'code', 'message'], ['data', 'error']))
        throw createContractError(RpcContractErrorCode.invalidEnvelope)
      if (typeof record.code !== 'string' || typeof record.message !== 'string')
        throw createContractError(RpcContractErrorCode.invalidEnvelope)
      if (record.error !== undefined) {
        try {
          normalizeRpcSerializedError(record.error, {
            unknownFields: RpcWireErrorUnknownFieldMode.reject
          })
        } catch (cause) {
          throw createContractError(RpcContractErrorCode.invalidEnvelope, cause)
        }
      }
    }
  } else if (kind === 'request') {
    if (
      !hasOnly(['kind', 'id', 'method', 'data']) ||
      typeof record.id !== 'string' ||
      typeof record.method !== 'string'
    )
      throw createContractError(RpcContractErrorCode.invalidEnvelope)
  } else if (kind === 'discovery') {
    if (
      !hasOnly(['kind', 'id', 'version', 'acceptVersions'], ['data']) ||
      typeof record.id !== 'string' ||
      typeof record.version !== 'string' ||
      !Array.isArray(record.acceptVersions)
    )
      throw createContractError(RpcContractErrorCode.invalidEnvelope)
    if (record.acceptVersions.some((item) => typeof item !== 'string'))
      throw createContractError(RpcContractErrorCode.invalidEnvelope)
  } else if (kind === 'variation') {
    if (!hasOnly(['kind', 'id', 'data']) || typeof record.id !== 'string')
      throw createContractError(RpcContractErrorCode.invalidEnvelope)
  } else {
    throw createContractError(RpcContractErrorCode.invalidEnvelope)
  }
  return normalized as IRpcEnvelope
}
