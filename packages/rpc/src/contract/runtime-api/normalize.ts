import { normalizePortable } from '../normalize.js'
import { RpcContractErrorCode } from '../error-code.js'
import { normalizeRpcSerializedError } from '../error.js'
import { invalidRpcEnvelope, isIdentifier, isRouteFieldValid } from '../v1/route.js'
import { normalizeStreamPayload } from '../v1/stream.js'
import { RpcRouteField, RpcEnvelopeViolation } from '../wire-constants.js'
import { RpcStreamEvent } from '../stream-constants.js'
import {
  RpcRuntimeProfile,
  RpcRuntimeKind,
  RpcRuntimeMode,
  RpcRuntimeGenerationKind,
  RpcRuntimeOperation,
  RpcRuntimeCancel,
  RpcRuntimeStepState,
  RpcRuntimeOutcomeState,
  RpcRuntimeStoreKind,
  RpcRuntimeStoreContinuity,
  RpcRuntimeFinish,
  RpcRuntimeField as F
} from './constants.js'
import type {
  IRpcRuntimeEnvelope,
  IRpcRuntimeGeneration,
  IRpcRuntimeOptions,
  IRpcRuntimeTask,
  IRpcRuntimeStep,
  IRpcRuntimeCompletion
} from './types.js'

/** Reject closed-profile input with the existing native contract error, preserving its cause. */
function invalid(pointer: string, cause?: unknown): never {
  throw invalidRpcEnvelope(RpcEnvelopeViolation.payload, pointer, cause)
}

/** Local factories and wire admission share this exact closed, request-only group step snapshot. */
export function normalizeRuntimeSteps(value: unknown): readonly IRpcRuntimeStep[] {
  const steps = array(
    value,
    (item, pointer) => {
      const step = record(item, [F.method], [F.payload], pointer)
      return Object.freeze({
        method: identifier(step.method, `${pointer}/method`),
        ...(Object.hasOwn(step, F.payload) ? { payload: normalizePortable(step.payload) } : {})
      })
    },
    '/steps'
  )
  if (steps.length === 0) invalid('/steps')
  return steps
}

/** Snapshot own data fields once; accessors and unknown fields never reach authentication metadata. */
function record(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  pointer: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(pointer)
  try {
    /** Only portable ordinary records can be metadata, never arbitrary owner objects. */
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) invalid(pointer)
    /** Descriptor reads reject getters without invoking them. */
    const descriptors = Object.getOwnPropertyDescriptors(value)
    /** Each admitted field is copied into a fresh null-prototype data record. */
    const result: Record<string, unknown> = Object.create(null)
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string' || (!required.includes(key) && !optional.includes(key)))
        invalid(pointer)
      /** Non-enumerable and accessor properties cannot disappear during the wire round trip. */
      const descriptor = descriptors[key]!
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        invalid(`${pointer}/${key}`)
      result[key] = descriptor.value
    }
    for (const key of required) if (!Object.hasOwn(result, key)) invalid(`${pointer}/${key}`)
    return { ...result }
  } catch (cause) {
    if (
      cause instanceof TypeError &&
      Reflect.get(cause, 'code') === RpcContractErrorCode.invalidEnvelope
    )
      throw cause
    invalid(pointer, cause)
  }
}

/** Dense arrays contain only own data indexes; sparse or extra-field shapes are not wire grammar. */
function array<T>(
  value: unknown,
  normalize: (value: unknown, pointer: string) => T,
  pointer: string
): readonly T[] {
  if (!Array.isArray(value)) invalid(pointer)
  /** The input's index descriptors are read once without executing index accessors. */
  const descriptors: Record<string, PropertyDescriptor> = Object.getOwnPropertyDescriptors(value)
  /** Array length is taken from its own data descriptor, not a proxy's property getter. */
  const length = descriptors.length?.value
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    Reflect.ownKeys(descriptors).length !== length + 1
  )
    invalid(pointer)
  /** Only a canonical dense result is exposed to the next owner. */
  const result: T[] = []
  for (let index = 0; index < length; index++) {
    const descriptor = descriptors[String(index)]
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
      invalid(`${pointer}/${index}`)
    result.push(normalize(descriptor.value, `${pointer}/${index}`))
  }
  return Object.freeze(result)
}

/** Preserve the original identifier domain instead of adding a second task/key grammar. */
function identifier(value: unknown, pointer: string): string {
  if (!isIdentifier(value)) invalid(pointer)
  return value
}

/** Generation counters are separate nonnegative safe-integer facts issued by their existing owners. */
export function normalizeRuntimeGeneration(value: unknown): IRpcRuntimeGeneration {
  const generation = record(value, [F.kind, F.value, F.providerId], [], '/generation')
  if (
    !Object.values(RpcRuntimeGenerationKind).includes(generation.kind as never) ||
    !Number.isSafeInteger(generation.value) ||
    (generation.value as number) < 0
  )
    invalid('/generation')
  return Object.freeze({
    kind: generation.kind,
    value: generation.value,
    providerId: identifier(generation.providerId, '/generation/providerId')
  }) as IRpcRuntimeGeneration
}

/**
 * The mode determines whether the logical method is required or forbidden on every correlated
 * frame.
 */
function task(value: unknown): IRpcRuntimeTask {
  const input = record(
    value,
    [F.mode, F.callerId, F.callerGeneration, F.targetGeneration],
    [F.method],
    '/task'
  )
  if (!Object.values(RpcRuntimeMode).includes(input.mode as never)) invalid('/task/mode')
  const callsMethod =
    input.mode === RpcRuntimeMode.request ||
    input.mode === RpcRuntimeMode.notify ||
    input.mode === RpcRuntimeMode.stream
  if (callsMethod !== Object.hasOwn(input, F.method)) invalid('/task/method')
  return Object.freeze({
    mode: input.mode,
    callerId: identifier(input.callerId, '/task/callerId'),
    callerGeneration: normalizeRuntimeGeneration(input.callerGeneration),
    targetGeneration: normalizeRuntimeGeneration(input.targetGeneration),
    ...(callsMethod ? { method: identifier(input.method, '/task/method') } : {})
  }) as IRpcRuntimeTask
}

/** All options are protected fields; AbortSignal and false stay at the local public boundary. */
function options(value: unknown, mode: IRpcRuntimeTask['mode']): IRpcRuntimeOptions {
  const input = record(value, [], [F.orderKey, F.cancel, F.timeoutMs, F.idempotencyKey], '/options')
  if (Object.hasOwn(input, F.orderKey)) identifier(input.orderKey, '/options/orderKey')
  if (Object.hasOwn(input, F.cancel) && input.cancel !== RpcRuntimeCancel)
    invalid('/options/cancel')
  if (
    Object.hasOwn(input, F.timeoutMs) &&
    !isRouteFieldValid(RpcRouteField.timeoutMs, input.timeoutMs)
  )
    invalid('/options/timeoutMs')
  if (Object.hasOwn(input, F.idempotencyKey)) {
    if (!isRouteFieldValid(RpcRouteField.idempotencyKey, input.idempotencyKey))
      invalid('/options/idempotencyKey')
    if (
      (mode === RpcRuntimeMode.notify || mode === RpcRuntimeMode.stream) &&
      input.cancel !== RpcRuntimeCancel
    )
      invalid('/options/cancel')
  }
  return Object.freeze(input) as IRpcRuntimeOptions
}

/** A completion preserves undefined omission and validates the existing serialized error domain. */
function completion(value: unknown, mode: IRpcRuntimeTask['mode']): IRpcRuntimeCompletion {
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
          if (Object.hasOwn(item, F.result)) item.result = normalizePortable(item.result)
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
    ...(Object.hasOwn(input, F.result) ? { result: normalizePortable(input.result) } : {})
  })
}

/** Validate the entire independent union before canonical identity, replay or provider mutation. */
export function normalizeRuntimeEnvelope(value: unknown): IRpcRuntimeEnvelope {
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
      result.steps = normalizeRuntimeSteps(input.steps)
    } else if (Object.hasOwn(input, F.payload)) result.payload = normalizePortable(input.payload)
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
      result.completion = completion(input.completion, selected.mode)
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
        result.stream = normalizeStreamPayload(stream)
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
          completion: completion(outcome.completion, outcome.mode as IRpcRuntimeTask['mode'])
        })
      } else if (Object.hasOwn(input, F.outcome)) invalid('/outcome')
    } else invalid('/operation')
  }
  for (const field of Object.keys(input))
    if (
      ![F.profile, F.kind, F.id, F.route, F.task].includes(field as never) &&
      !fields.includes(field)
    )
      invalid(`/${field}`)
  return Object.freeze(result) as IRpcRuntimeEnvelope
}
