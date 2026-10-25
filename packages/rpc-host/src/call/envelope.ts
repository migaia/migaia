/** Pure per-attempt construction preserves the single admitted task and shrinking link budget. */
import {
  RpcWireKind,
  RpcWireProfile,
  RpcCallMode,
  type IRpcEnvelope,
  type IRpcRoute,
  type IRpcTask,
  type IRpcGeneration
} from '@migaia/rpc-contract/protocol'
import type {
  ICallPreparationCommand,
  ICallLocalOptions,
  ICallSelf,
  ICallTargetRef
} from './types.js'

/** Compare admitted scalar identity rather than object identity or serialized field ordering. */
export function sameGeneration(left: IRpcGeneration, right: IRpcGeneration): boolean {
  return (
    left.kind === right.kind && left.value === right.value && left.providerId === right.providerId
  )
}

/** A result must echo every selected task field, including the exact generation and method. */
export function sameTask(left: IRpcTask, right: IRpcTask): boolean {
  return (
    left.mode === right.mode &&
    left.method === right.method &&
    left.callerId === right.callerId &&
    sameGeneration(left.callerGeneration, right.callerGeneration) &&
    sameGeneration(left.targetGeneration, right.targetGeneration)
  )
}

/** Create one new envelope; the long-lived record receives only its compact identity fields. */
export function callEnvelope(
  id: string,
  target: ICallTargetRef,
  self: ICallSelf,
  command: ICallPreparationCommand,
  options: ICallLocalOptions,
  sentAt: number,
  remainingMs?: number
): IRpcEnvelope {
  /** Route strings and the bounded forward route are metadata, never a Session reference. */
  const route: IRpcRoute = {
    applicationVersion: self.applicationVersion,
    senderId: self.instanceId,
    receiverId: target.peerId,
    targetId: target.peerId,
    sentAt,
    ...(options.trace === undefined ? {} : { trace: options.trace }),
    ...(options.forwardRoute === undefined ? {} : { forwardRoute: options.forwardRoute }),
    ...(remainingMs === undefined ? {} : { remainingMs })
  }
  /** The immutable tuple fences replies independently from public mutable diagnostic fields. */
  const task: IRpcTask = {
    mode: command.mode,
    callerId: self.instanceId,
    callerGeneration: { ...self.generation },
    targetGeneration: { ...target.generation },
    ...('method' in command ? { method: command.method } : {})
  }
  /** Only these three fields belong to the serialized options grammar. */
  const wireOptions = {
    ...(options.orderKey === undefined ? {} : { orderKey: options.orderKey }),
    ...(options.cancel === undefined ? {} : { cancel: options.cancel }),
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey })
  }
  /** Shared fixed metadata is operation-local and is discarded after physical handoff. */
  const common = { profile: RpcWireProfile, id, route, task } as const
  if (command.mode === RpcCallMode.group)
    return { ...common, kind: RpcWireKind.group, options: wireOptions, steps: command.steps }
  if (command.mode === RpcCallMode.outcome)
    return {
      ...common,
      kind: RpcWireKind.outcome,
      operation: 'lookup',
      idempotencyKey: command.idempotencyKey
    }
  return {
    ...common,
    kind: RpcWireKind.call,
    options: wireOptions,
    ...(command.payload === undefined ? {} : { payload: command.payload })
  }
}
