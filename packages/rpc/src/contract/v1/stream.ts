import { createContractError } from '../contract-error.js'
import { RpcContractErrorCode } from '../error-code.js'
import { normalizeRpcSerializedError } from '../error.js'
import { normalizePortable } from '../normalize.js'
import {
  measurePortableStreamValue,
  RpcStreamEvent,
  RpcStreamLimit,
  RpcStreamViolation,
  type RpcStreamEvent as IRpcStreamEvent,
  type RpcStreamViolation as IRpcStreamViolation
} from '../stream-constants.js'
import type { IRpcPortableValue, IRpcSerializedError } from '../types.js'

/** A normalized event leaves direction and sequence credit to the core stream owner. */
export type IRpcStreamPayload = Readonly<{
  event: IRpcStreamEvent
  seq: number
  value?: IRpcPortableValue
  error?: IRpcSerializedError
  reason?: IRpcSerializedError
}>

/** Preserve the first stream violation and its payload-relative pointer on a native TypeError. */
export function invalidRpcStream(
  violation: IRpcStreamViolation,
  pointer: string,
  cause?: unknown
): TypeError {
  const error = createContractError(RpcContractErrorCode.invalidStream, cause) as TypeError
  Object.defineProperties(error, {
    violation: { value: violation, enumerable: true },
    pointer: { value: pointer, enumerable: true }
  })
  return error
}

/** Validate event shape and portable value budget before core touches stream state. */
export function normalizeStreamPayload(
  value: unknown,
  portableValue: (value: unknown) => IRpcPortableValue = normalizePortable
): IRpcStreamPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalidRpcStream(RpcStreamViolation.field, '')
  let record: Record<string, unknown>
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
      throw invalidRpcStream(RpcStreamViolation.field, '')
    record = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(value)) record[key] = (value as Record<string, unknown>)[key]
  } catch (cause) {
    if (isStreamError(cause)) throw cause
    throw invalidRpcStream(RpcStreamViolation.field, '', cause)
  }
  const event = record.event
  if (typeof event !== 'string' || !Object.hasOwn(RpcStreamEvent, event))
    throw invalidRpcStream(RpcStreamViolation.event, '/event')
  if (!Number.isSafeInteger(record.seq) || (record.seq as number) < 0)
    throw invalidRpcStream(RpcStreamViolation.field, '/seq')
  const required =
    event === RpcStreamEvent.item ? 'value' : event === RpcStreamEvent.fail ? 'error' : undefined
  if (required && !Object.hasOwn(record, required))
    throw invalidRpcStream(RpcStreamViolation.field, `/${required}`)
  const allowed =
    event === RpcStreamEvent.item || event === RpcStreamEvent.end
      ? 'value'
      : event === RpcStreamEvent.fail || event === RpcStreamEvent.cancelled
        ? 'error'
        : event === RpcStreamEvent.cancel
          ? 'reason'
          : undefined
  for (const key of Object.keys(record).sort()) {
    if (key !== 'event' && key !== 'seq' && key !== allowed)
      throw invalidRpcStream(RpcStreamViolation.field, `/${key}`)
  }
  const result: Record<string, unknown> = { event, seq: record.seq }
  if (Object.hasOwn(record, 'value')) {
    try {
      const portable = portableValue(record.value)
      if (measurePortableStreamValue(portable) > RpcStreamLimit.maxItemValueBytes)
        throw invalidRpcStream(RpcStreamViolation.budget, '/value')
      result.value = portable
    } catch (cause) {
      if (isStreamError(cause)) throw cause
      throw invalidRpcStream(RpcStreamViolation.budget, '/value', cause)
    }
  }
  for (const field of ['error', 'reason'] as const) {
    if (!Object.hasOwn(record, field)) continue
    try {
      result[field] = normalizeRpcSerializedError(record[field])
    } catch (cause) {
      throw invalidRpcStream(RpcStreamViolation.field, `/${field}`, cause)
    }
  }
  return Object.freeze(result) as IRpcStreamPayload
}

/** Recognize an already classified stream failure without masking its first pointer. */
function isStreamError(value: unknown): value is TypeError {
  return (
    value instanceof TypeError &&
    (value as { readonly code?: unknown }).code === RpcContractErrorCode.invalidStream
  )
}
