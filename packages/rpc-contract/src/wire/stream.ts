/**
 * Admits stream-event shapes, portable item budgets and flat terminal errors, and exposes stateless
 * sequence and credit checks. Stream execution, queued pulls, cancellation and resource cleanup
 * remain with the Host stream owner.
 */
import type { IRpcPortableProjector } from './types.js'
import type { IRpcErrorWireMetadata } from '../contract/types.js'
/**
 * Admits stream event data for the single profile and flat wire errors. The existing sequence and
 * credit checks remain shared; no stream queue, pending pull, timer, or listener is held here.
 */
import { invalid, invalidRpcEnvelope } from './record.js'

import { normalizeRpcPortable } from '../portable/normalize.js'
import {
  RpcStreamEvent,
  RpcStreamLimit,
  RpcStreamViolation,
  measurePortableStreamValue
} from './stream-constants.js'
import { normalizeRpcWireError } from './errors.js'
import { RpcWireField as F, RpcWirePointer as P, RpcWireStreamFinish } from './constants.js'
import type { IRpcStreamEvent } from './types.js'

/** Reuse established producer/consumer credit checks with caller-supplied held state. */
export {
  checkRpcStreamInitialSequence,
  checkRpcStreamSequence,
  checkRpcStreamProgress,
  checkRpcStreamConsumerCredit,
  checkRpcStreamProducerCredit
} from './stream-validation.js'

/** Normalize one stream event in linear value size, preserving existing item/end/fail spelling. */
export function normalizeRpcStream(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  portable: IRpcPortableProjector = normalizeRpcPortable
): IRpcStreamEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(P.stream, undefined, metadata)
  /** Event metadata stays in the original record; only the selected event owns a business slot. */
  const input = value as Record<string, unknown>
  if (input.event === undefined) invalid(`${P.stream}/event`, undefined, metadata)
  if (input.seq === undefined) invalid(`${P.stream}/seq`, undefined, metadata)
  if (!Number.isSafeInteger(input.seq) || (input.seq as number) < 0)
    invalid(`${P.stream}/seq`, undefined, metadata)
  /** Cancellation has its own correlated envelope; the existing terminal cancelled event remains. */
  const event = input.event
  if (
    typeof event !== 'string' ||
    (event !== RpcWireStreamFinish &&
      (!Object.hasOwn(RpcStreamEvent, event) || event === RpcStreamEvent.cancel))
  )
    invalid(`${P.stream}/event`, undefined, metadata)
  if (event === RpcStreamEvent.open && input.seq !== 0)
    invalid(`${P.stream}/seq`, undefined, metadata)
  /** Only the field owned by this closed event may appear alongside event/seq. */
  const field =
    event === RpcStreamEvent.item || event === RpcStreamEvent.end
      ? F.value
      : event === RpcStreamEvent.fail || event === RpcStreamEvent.cancelled
        ? F.error
        : event === RpcWireStreamFinish
          ? F.reason
          : undefined
  if (event === RpcStreamEvent.item && input.value === undefined)
    invalid(`${P.stream}/value`, undefined, metadata)
  if (event === RpcStreamEvent.fail && input.error === undefined)
    invalid(`${P.stream}/error`, undefined, metadata)
  if (field === F.value && Object.hasOwn(input, F.value)) {
    /** Portable validation owns its one value walk; only the pure fallback measures separately. */
    const projected = portable(input.value, metadata, RpcStreamLimit.maxItemValueBytes)
    if (
      portable === normalizeRpcPortable &&
      measurePortableStreamValue(projected) > RpcStreamLimit.maxItemValueBytes
    )
      throw invalidRpcEnvelope(RpcStreamViolation.budget, P.stream, undefined, metadata)
  }
  if (field === F.error && Object.hasOwn(input, F.error))
    normalizeRpcWireError(input.error, metadata)
  if (field === F.reason && Object.hasOwn(input, F.reason))
    normalizeRpcWireError(input.reason, metadata)
  return value as IRpcStreamEvent
}
