import { normalizeRuntimePortable } from '../normalize.js'
import { RpcContractErrorCode } from '../error-code.js'
import { invalidRpcEnvelope, isIdentifier, isRouteFieldValid } from '../v1/route.js'
import { RpcRouteField, RpcEnvelopeViolation } from '../wire-constants.js'
import {
  RpcRuntimeGenerationKind,
  RpcRuntimeMode,
  RpcRuntimeCancel,
  RpcRuntimeField as F
} from './constants.js'
import type { IRpcPortableValue } from '../types.js'
import type {
  IRpcRuntimeGeneration,
  IRpcRuntimeOptions,
  IRpcRuntimeTask,
  IRpcRuntimeStep
} from './types.js'

/** Reject closed-profile input with the existing native contract error, preserving its cause. */
export function invalid(pointer: string, cause?: unknown): never {
  throw invalidRpcEnvelope(RpcEnvelopeViolation.payload, pointer, cause)
}

/** Local factories and wire admission share this exact closed, request-only group step snapshot. */
export function normalizeRuntimeSteps(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue = normalizeRuntimePortable
): readonly IRpcRuntimeStep[] {
  const steps = array(
    value,
    (item, pointer) => {
      const step = record(item, [F.method], [F.payload], pointer)
      return Object.freeze({
        method: identifier(step.method, `${pointer}/method`),
        ...(Object.hasOwn(step, F.payload) ? { payload: portable(step.payload) } : {})
      })
    },
    '/steps'
  )
  if (steps.length === 0) invalid('/steps')
  return steps
}

/** Snapshot own data fields once; accessors and unknown fields never reach authentication metadata. */
export function record(
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
export function array<T>(
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
export function identifier(value: unknown, pointer: string): string {
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
export function task(value: unknown): IRpcRuntimeTask {
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
export function options(value: unknown, mode: IRpcRuntimeTask['mode']): IRpcRuntimeOptions {
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
