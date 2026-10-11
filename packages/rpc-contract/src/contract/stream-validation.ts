import { invalidRpcStream } from './stream-error.js'
import { RpcStreamViolation } from './stream-constants.js'
import { RpcRuntimeCancel, RpcRuntimeFinish } from './runtime-api/constants.js'
import type { IRpcRuntimeOptions, IRpcRuntimeStream } from './runtime-api/types.js'

/** Stable locations distinguish legacy payload and runtime-envelope stream diagnostics. */
export const RpcStreamPointer = {
  seq: '/seq',
  runtimeSeq: '/stream/seq',
  runtimeEvent: '/stream/event'
} as const

/** These are the caller's actual protocol fields, not admission or transport authority. */
export type IRpcStreamSequence = Readonly<{ seq: number }>
/** A consumer's held credit is read only after its sequence matches. */
export type IRpcStreamConsumerCredit = Readonly<{ seq: number; pending?: unknown }>
/** A producer's held busy state is read only after its sequence matches. */
export type IRpcStreamProducerCredit = Readonly<{ seq: number; busy: boolean }>

/** Check the actual received open frame against the protocol's initial sequence. */
export function checkRpcStreamInitialSequence(
  payload: IRpcStreamSequence,
  pointer: string = RpcStreamPointer.seq
): Error | undefined {
  if (payload.seq !== 0) return invalidRpcStream(RpcStreamViolation.seq, pointer)
  return undefined
}

/** Check a frame against held sequence state; an absent exchange cannot acknowledge a cancellation. */
export function checkRpcStreamSequence(
  payload: IRpcStreamSequence,
  expected: IRpcStreamSequence | undefined,
  pointer: string = RpcStreamPointer.seq
): Error | undefined {
  if (payload.seq !== expected?.seq) return invalidRpcStream(RpcStreamViolation.seq, pointer)
  return undefined
}

/** A terminal runtime notification may advance beyond discarded items, but cannot go backwards. */
export function checkRpcStreamProgress(
  payload: IRpcStreamSequence,
  state: IRpcStreamSequence,
  pointer: string = RpcStreamPointer.seq
): Error | undefined {
  if (payload.seq < state.seq) return invalidRpcStream(RpcStreamViolation.seq, pointer)
  return undefined
}

/** Check one consumer response against its actual pending credit, retaining short-circuit reads. */
export function checkRpcStreamConsumerCredit(
  payload: IRpcStreamSequence,
  state: IRpcStreamConsumerCredit,
  pointer: string = RpcStreamPointer.seq
): Error | undefined {
  if (payload.seq !== state.seq || !state.pending)
    return invalidRpcStream(RpcStreamViolation.seq, pointer)
  return undefined
}

/**
 * Check one producer pull against its held sequence and in-flight pull, retaining short-circuit
 * reads.
 */
export function checkRpcStreamProducerCredit(
  payload: IRpcStreamSequence,
  state: IRpcStreamProducerCredit,
  pointer: string = RpcStreamPointer.seq
): Error | undefined {
  if (payload.seq !== state.seq || state.busy)
    return invalidRpcStream(RpcStreamViolation.seq, pointer)
  return undefined
}

/**
 * Validate an actual finish control against the start options; other controls do not consume this
 * rule.
 */
export function checkRpcRuntimeStreamTransition(
  control: Pick<IRpcRuntimeStream, 'event'>,
  options: Pick<IRpcRuntimeOptions, 'cancel'>
): Error | undefined {
  if (control.event === RpcRuntimeFinish && options.cancel !== RpcRuntimeCancel)
    return invalidRpcStream(RpcStreamViolation.event, RpcStreamPointer.runtimeEvent)
  return undefined
}

/** Validate a held early-control intent whose owner retained the actual finish discriminator. */
export function checkRpcRuntimeStreamIntent(
  intent: Readonly<{ finish?: boolean }>,
  options: Pick<IRpcRuntimeOptions, 'cancel'>
): Error | undefined {
  if (intent.finish && options.cancel !== RpcRuntimeCancel)
    return invalidRpcStream(RpcStreamViolation.event, RpcStreamPointer.runtimeEvent)
  return undefined
}

/**
 * Check the actual admitted call options after a protocol implementer has received a finish
 * control.
 */
export function checkRpcRuntimeStreamFinish(
  options: Pick<IRpcRuntimeOptions, 'cancel'>
): Error | undefined {
  if (options.cancel !== RpcRuntimeCancel)
    return invalidRpcStream(RpcStreamViolation.event, RpcStreamPointer.runtimeEvent)
  return undefined
}
