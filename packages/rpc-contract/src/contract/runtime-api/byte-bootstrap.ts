import { RpcWireLimit } from '../wire-constants.js'
import { normalizeRuntimeGeneration } from './normalize.js'
import type { IRpcRuntimeGeneration } from './types.js'

/** Byte launch metadata stays separate from the frozen ordinary RPC hello grammar. */
const kind = 'rpc-runtime-api-bootstrap'
/** Both launch encoding and cold receive require this original closed metadata version. */
const version = 1
/** The original unauthenticated frame bound also limits complete encoded metadata. */
const maxBytes = 64 * 1024

/** Actual launch data contains a private token that consumers must keep out of diagnostics. */
export type IRpcByteRuntimeBootstrap = Readonly<{
  self: Readonly<{ name: string; instanceId: string }>
  parentInstanceId: string
  token: string
  generation?: IRpcRuntimeGeneration
}>

/** Identity labels share the bounded domain of the canonical RPC handshake. */
function identifier(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= RpcWireLimit.maxIdentifierChars
  )
}

/** Admit the original closed JSON record without retaining secret-bearing parser failures. */
function read(
  input: unknown
): Readonly<{ valid: true; value: IRpcByteRuntimeBootstrap }> | Readonly<{ valid: false }> {
  try {
    /** Received bytes are decoded strictly; local encoding validates its same original record. */
    const value =
      input instanceof Uint8Array
        ? input.byteLength > maxBytes
          ? undefined
          : JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input))
        : input
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false }
    /** Extra fields never enter the original metadata projection. */
    const record = value as Record<string, unknown>
    if (
      Object.keys(record).length !== (record.generation === undefined ? 5 : 6) ||
      record.kind !== kind ||
      record.version !== version ||
      !identifier(record.parentInstanceId) ||
      typeof record.token !== 'string' ||
      !record.token ||
      !record.self ||
      typeof record.self !== 'object' ||
      Array.isArray(record.self)
    )
      return { valid: false }
    /** Native PIDs and environment are excluded from this safe address. */
    const self = record.self as Record<string, unknown>
    if (Object.keys(self).length !== 2 || !identifier(self.name) || !identifier(self.instanceId))
      return { valid: false }
    /** Generation admission reuses the canonical metadata parser and its exact value domain. */
    const generation =
      record.generation === undefined ? undefined : normalizeRuntimeGeneration(record.generation)
    return {
      valid: true,
      value: Object.freeze({
        self: Object.freeze({ name: self.name, instanceId: self.instanceId }),
        parentInstanceId: record.parentInstanceId,
        token: record.token,
        ...(generation ? { generation } : {})
      })
    }
  } catch {
    return { valid: false }
  }
}

/** Pure protocol data/parser; Core derives provenance only from its own actual held-I/O receive. */
export const rpcByteRuntimeBootstrap = Object.freeze({ kind, version, maxBytes, read })
