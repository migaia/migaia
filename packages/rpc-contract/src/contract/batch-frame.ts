import { createContractError } from './contract-error.js'
import { RpcContractErrorCode } from './error-code.js'
import { RpcBatchPhysical } from './wire-constants.js'
import type { IRpcEnvelope } from './v1/types.js'
import { isUint8Array, utf8ByteLength } from '@migaia/utils/bytes'

/** Physical grouping is independent of protocol 1.1's semantic envelope union. */
export type IRpcBatchFrame = Readonly<{
  /** Physical wrapper discriminator, separate from each member's semantic kind. */
  kind: typeof RpcBatchPhysical.kind
  /** Nonempty semantic member list; each member still requires its own admission. */
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
  /** UTF-8 needs at most three bytes per UTF-16 unit, including unpaired-surrogate replacement. */
  if (typeof value === 'string' && value.length <= Math.floor(limit / 3)) return
  if (measureRpcPhysicalFrame(value) > limit) rejectRpcPhysicalFrameSize()
}

/** A real encoded-frame measurement can partition its caller's queue without measuring it again. */
export type IRpcPhysicalFrameInspection = Readonly<{
  /** Single measured complete-frame size, using UTF-8 for strings and JSON object representations. */
  readonly bytes: number
  /** Retain an in-budget list or bisect an oversize list; an oversize singleton throws. */
  splitBatch<T>(members: T[]): readonly T[][]
}>

/** Retain only actual physical bytes and the limit selected for that encoded frame. */
class RpcPhysicalFrameInspection implements IRpcPhysicalFrameInspection {
  /** The single canonical measurement belongs to this actual encoded frame. */
  #bytes: number
  /** This frame's physical quota determines whether its semantic members need bisection. */
  #limit: number

  /** Measure the actual frame once at the caller's original exact-sizing point. */
  constructor(value: unknown, limit: number) {
    this.#bytes = measureRpcPhysicalFrame(value)
    this.#limit = limit
  }

  /** Reuse the measured bytes for the caller's original bound and split decisions. */
  get bytes(): number {
    return this.#bytes
  }

  /** Bisect an oversize batch by member count; a real oversize singleton retains its native error. */
  splitBatch<T>(members: T[]): readonly T[][] {
    if (this.#bytes <= this.#limit) return [members]
    if (members.length === 1) rejectRpcPhysicalFrameSize()
    /** Count bisection preserves semantic boundaries and never estimates individual member bytes. */
    const middle = Math.ceil(members.length / 2)
    return [members.slice(0, middle), members.slice(middle)]
  }
}

/** Inspect one complete encoded frame for a custom encoder's quota and recursive batch partitioning. */
export function inspectRpcPhysicalFrame(
  value: unknown,
  limit: number
): IRpcPhysicalFrameInspection {
  return new RpcPhysicalFrameInspection(value, limit)
}

/** A singleton cannot be split; the physical contract owns its native RangeError identity. */
export function rejectRpcPhysicalFrameSize(): never {
  throw createContractError(RpcContractErrorCode.frameLimitExceeded)
}
