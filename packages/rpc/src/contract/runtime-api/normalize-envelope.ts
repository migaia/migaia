import {
  invalid,
  record,
  array,
  identifier,
  task,
  options,
  normalizeRuntimeSteps,
  normalizeRuntimeGeneration
} from './metadata.js'
export { normalizeRuntimeSteps, normalizeRuntimeGeneration } from './metadata.js'
import { normalizeRpcSerializedError } from '../error.js'
import { isRouteFieldValid } from '../v1/route.js'
import type { IRpcStreamPayload } from '../v1/stream.js'
import { RpcRouteField } from '../wire-constants.js'
import { RpcStreamEvent } from '../stream-constants.js'
import {
  RpcRuntimeProfile,
  RpcRuntimeKind,
  RpcRuntimeMode,
  RpcRuntimeOperation,
  RpcRuntimeStepState,
  RpcRuntimeOutcomeState,
  RpcRuntimeStoreKind,
  RpcRuntimeStoreContinuity,
  RpcRuntimeFinish,
  RpcRuntimeField as F
} from './constants.js'
import type { IRpcPortableValue } from '../types.js'
import type { IRpcRuntimeEnvelope, IRpcRuntimeTask, IRpcRuntimeCompletion } from './types.js'

/** A completion preserves undefined omission and validates the existing serialized error domain. */
function completion(
  value: unknown,
  mode: IRpcRuntimeTask['mode'],
  portable: (value: unknown) => IRpcPortableValue
): IRpcRuntimeCompletion {
  const input = record(value, [F.ok], [F.result, F.error], '/completion')
  if (input.ok === false) {
    if (!Object.hasOwn(input, F.error) || Object.hasOwn(input, F.result)) invalid('/completion')
    return Object.freeze({ ok: false, error: normalizeRpcSerializedError(input.error) })
  }
  if (input.ok !== true || Object.hasOwn(input, F.error)) invalid('/completion')
  if (mode === RpcRuntimeMode.group) {
    /** No successful group terminal can omit, truncate or skip its actual step report. */
    let failed = false
    const outcomes = array(
      input.result,
      (value, pointer) => {
        const item = record(value, [F.state], [F.result, F.error], pointer)
        if (failed) {
          if (item.state !== RpcRuntimeStepState.notExecuted || Object.keys(item).length !== 1)
            invalid(pointer)
        } else if (item.state === RpcRuntimeStepState.failure) {
          if (!Object.hasOwn(item, F.error) || Object.hasOwn(item, F.result)) invalid(pointer)
          item.error = normalizeRpcSerializedError(item.error)
          failed = true
        } else if (item.state === RpcRuntimeStepState.success) {
          if (Object.hasOwn(item, F.error)) invalid(pointer)
          if (Object.hasOwn(item, F.result)) item.result = portable(item.result)
        } else invalid(pointer)
        return Object.freeze(item)
      },
      '/completion/result'
    )
    if (outcomes.length === 0) invalid('/completion/result')
    return Object.freeze({ ok: true, result: outcomes }) as IRpcRuntimeCompletion
  }
  return Object.freeze({
    ok: true,
    ...(Object.hasOwn(input, F.result) ? { result: portable(input.result) } : {})
  })
}

/** Validate the entire independent union before canonical identity, replay or provider mutation. */
export function normalizeRuntimeEnvelope(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue,
  normalizeStreamPayload: (
    value: unknown,
    portable: (value: unknown) => IRpcPortableValue
  ) => IRpcStreamPayload | Promise<IRpcStreamPayload>
): IRpcRuntimeEnvelope | Promise<IRpcRuntimeEnvelope> {
  /**
   * First snapshot establishes the discriminator while retaining every field for its closed
   * variant.
   */
  const input = record(
    value,
    [F.profile, F.kind, F.id, F.route, F.task],
    [
      F.payload,
      F.options,
      F.steps,
      F.operation,
      F.reason,
      F.stream,
      F.completion,
      F.idempotencyKey,
      F.state,
      F.store,
      F.outcome
    ],
    ''
  )
  if (
    input.profile !== RpcRuntimeProfile ||
    !Object.values(RpcRuntimeKind).includes(input.kind as never)
  )
    invalid('')
  /** The original route validator owns all reused domains, including optional signed forward routes. */
  const route = record(
    input.route,
    [
      RpcRouteField.applicationVersion,
      RpcRouteField.senderId,
      RpcRouteField.targetId,
      RpcRouteField.receiverId,
      RpcRouteField.sentAt
    ],
    [RpcRouteField.forwardRoute],
    '/route'
  )
  for (const field of [
    RpcRouteField.applicationVersion,
    RpcRouteField.senderId,
    RpcRouteField.targetId,
    RpcRouteField.receiverId
  ])
    identifier(route[field], `/route/${field}`)
  if (!Number.isSafeInteger(route.sentAt) || (route.sentAt as number) < 0) invalid('/route/sentAt')
  if (Object.hasOwn(route, RpcRouteField.forwardRoute)) {
    if (!isRouteFieldValid(RpcRouteField.forwardRoute, route.forwardRoute))
      invalid('/route/forwardRoute')
    route.forwardRoute = Object.freeze([...(route.forwardRoute as string[])])
  }
  /** This selected task is the one tuple carried by every normalized result. */
  const selected = task(input.task)
  /** The common prefix is rebuilt from admitted data only. */
  const result: Record<string, unknown> = {
    profile: RpcRuntimeProfile,
    kind: input.kind,
    id: identifier(input.id, '/id'),
    route: Object.freeze(route),
    task: selected
  }
  /** Only this variant's extra properties may survive the common snapshot. */
  let fields: readonly string[]
  if (input.kind === RpcRuntimeKind.call || input.kind === RpcRuntimeKind.group) {
    const group = input.kind === RpcRuntimeKind.group
    if (
      group
        ? selected.mode !== RpcRuntimeMode.group
        : ![RpcRuntimeMode.request, RpcRuntimeMode.notify, RpcRuntimeMode.stream].includes(
            selected.mode as never
          )
    )
      invalid('/task/mode')
    fields = group ? [F.options, F.steps] : [F.options, F.payload]
    result.options = options(input.options, selected.mode)
    if (group) {
      result.steps = normalizeRuntimeSteps(input.steps, portable)
    } else if (Object.hasOwn(input, F.payload)) result.payload = portable(input.payload)
  } else if (input.kind === RpcRuntimeKind.control) {
    if (
      selected.mode === RpcRuntimeMode.outcome &&
      input.operation !== RpcRuntimeOperation.terminal
    )
      invalid('/task/mode')
    result.operation = input.operation
    if (input.operation === RpcRuntimeOperation.cancel) {
      fields = [F.operation, F.reason]
      if (Object.hasOwn(input, F.reason)) result.reason = normalizeRpcSerializedError(input.reason)
    } else if (input.operation === RpcRuntimeOperation.terminal) {
      if (selected.mode === RpcRuntimeMode.stream) invalid('/operation')
      fields = [F.operation, F.completion]
      result.completion = completion(input.completion, selected.mode, portable)
      /**
       * A failed query carries the exact error; successful queries require the outcome result
       * union.
       */
      if (
        selected.mode === RpcRuntimeMode.outcome &&
        (result.completion as IRpcRuntimeCompletion).ok
      )
        invalid('/completion/ok')
    } else if (input.operation === RpcRuntimeOperation.stream) {
      if (selected.mode !== RpcRuntimeMode.stream) invalid('/task/mode')
      fields = [F.operation, F.stream]
      const stream = record(input.stream, [F.event, F.seq], [F.value, F.error, F.reason], '/stream')
      if (stream.event === RpcStreamEvent.cancel) invalid('/stream/event')
      if (stream.event === RpcRuntimeFinish) {
        if (
          !Number.isSafeInteger(stream.seq) ||
          (stream.seq as number) < 0 ||
          Object.hasOwn(stream, F.value) ||
          Object.hasOwn(stream, F.error)
        )
          invalid('/stream')
        if (Object.hasOwn(stream, F.reason))
          stream.reason = normalizeRpcSerializedError(stream.reason)
        result.stream = Object.freeze(stream)
      } else {
        /** Only an actual stream branch can load its parser; scalar validation stays synchronous. */
        const normalized = normalizeStreamPayload(stream, portable)
        if (normalized instanceof Promise)
          return normalized.then((payload) => {
            result.stream = payload
            if (stream.event === RpcStreamEvent.open && stream.seq !== 0) invalid('/stream/seq')
            return finishRuntimeEnvelope(input, result, fields)
          })
        result.stream = normalized
        if (stream.event === RpcStreamEvent.open && stream.seq !== 0) invalid('/stream/seq')
      }
    } else invalid('/operation')
  } else {
    if (selected.mode !== RpcRuntimeMode.outcome) invalid('/task/mode')
    result.operation = input.operation
    if (input.operation === RpcRuntimeOperation.lookup) {
      fields = [F.operation, F.idempotencyKey]
      if (!isRouteFieldValid(RpcRouteField.idempotencyKey, input.idempotencyKey))
        invalid('/idempotencyKey')
      result.idempotencyKey = input.idempotencyKey
    } else if (input.operation === RpcRuntimeOperation.result) {
      fields = [F.operation, F.state, F.store, F.outcome]
      if (!Object.values(RpcRuntimeOutcomeState).includes(input.state as never)) invalid('/state')
      const store = record(input.store, [F.kind, F.continuity], [F.epoch], '/store')
      if (
        !Object.values(RpcRuntimeStoreKind).includes(store.kind as never) ||
        !Object.values(RpcRuntimeStoreContinuity).includes(store.continuity as never)
      )
        invalid('/store')
      if (store.kind === RpcRuntimeStoreKind.unavailable) {
        if (
          store.continuity !== RpcRuntimeStoreContinuity.unavailable ||
          Object.hasOwn(store, F.epoch)
        )
          invalid('/store')
      } else identifier(store.epoch, '/store/epoch')
      result.state = input.state
      result.store = Object.freeze(store)
      if (input.state === RpcRuntimeOutcomeState.done) {
        const outcome = record(
          input.outcome,
          [F.mode, F.targetGeneration, F.completion],
          [],
          '/outcome'
        )
        if (
          outcome.mode === RpcRuntimeMode.outcome ||
          !Object.values(RpcRuntimeMode).includes(outcome.mode as never)
        )
          invalid('/outcome/mode')
        result.outcome = Object.freeze({
          mode: outcome.mode,
          targetGeneration: normalizeRuntimeGeneration(outcome.targetGeneration),
          completion: completion(
            outcome.completion,
            outcome.mode as IRpcRuntimeTask['mode'],
            portable
          )
        })
      } else if (Object.hasOwn(input, F.outcome)) invalid('/outcome')
    } else invalid('/operation')
  }
  return finishRuntimeEnvelope(input, result, fields)
}

/**
 * Apply the original variant field fence and publish the same frozen envelope after stream
 * validation.
 */
function finishRuntimeEnvelope(
  input: Record<string, unknown>,
  result: Record<string, unknown>,
  fields: readonly string[]
): IRpcRuntimeEnvelope {
  for (const field of Object.keys(input))
    if (
      ![F.profile, F.kind, F.id, F.route, F.task].includes(field as never) &&
      !fields.includes(field)
    )
      invalid(`/${field}`)
  return Object.freeze(result) as IRpcRuntimeEnvelope
}
