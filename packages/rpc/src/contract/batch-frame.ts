import { createContractError } from './contract-error.js'
import { RpcContractErrorCode } from './error-code.js'
import { RpcBatchPhysical } from './wire-constants.js'
import type { IRpcEnvelope } from './v1/types.js'
import { isUint8Array, utf8ByteLength } from '@migaia/utils/bytes'

/** Physical grouping is independent of protocol 1.1's semantic envelope union. */
export type IRpcBatchFrame = Readonly<{
  kind: typeof RpcBatchPhysical.kind
  envelopes: readonly IRpcEnvelope[]
}>

/** Reads a codec-decoded physical wrapper; semantic members remain independently untrusted. */
export function readRpcBatchMembers(value: unknown): readonly unknown[] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  /** Qualified codecs have already admitted portable own-data records. */
  const record = value as Record<string, unknown>
  if (record.kind !== RpcBatchPhysical.kind) return undefined
  /** Snapshot the physical member list before callbacks can mutate a borrowed frame. */
  const members = record[RpcBatchPhysical.members]
  if (
    !Array.isArray(members) ||
    members.length === 0 ||
    Object.keys(record).some((key) => key !== 'kind' && key !== RpcBatchPhysical.members)
  )
    throw createContractError(RpcContractErrorCode.invalidFrame)
  return Object.freeze([...members])
}

/** Encoded byte carriers reuse actual bytes; objects encode one complete physical representation. */
export function measureRpcPhysicalFrame(value: unknown): number {
  if (typeof value === 'string') return utf8ByteLength(value)
  if (isUint8Array(value)) return value.byteLength
  return utf8ByteLength(JSON.stringify(value))
}

/** Enforces the whole physical byte limit with the contract owner's native coded error. */
export function assertRpcPhysicalFrameSize(value: unknown, limit: number): void {
  if (measureRpcPhysicalFrame(value) > limit) rejectRpcPhysicalFrameSize()
}

/** A singleton cannot be split; the physical contract owns its native RangeError identity. */
export function rejectRpcPhysicalFrameSize(): never {
  throw createContractError(RpcContractErrorCode.frameLimitExceeded)
}
