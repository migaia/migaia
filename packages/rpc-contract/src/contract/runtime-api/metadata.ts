import { normalizeRuntimePortable } from '../normalize.js'
import { RpcContractErrorCode } from '../error-code.js'
import { invalidRpcEnvelope, isIdentifier, isRouteFieldValid } from '../v1/route.js'
import { RpcRouteField, RpcEnvelopeViolation } from '../wire-constants.js'
import {
  RpcRuntimeGenerationKind,
  RpcRuntimeProfile,
  RpcRuntimeKind,
  RpcRuntimeMode,
  RpcRuntimeCancel,
  RpcRuntimeField as F
} from './constants.js'
import type { IRpcPortableValue } from '../types.js'
import type {
  IRpcRuntimeGeneration,
  IRpcRuntimeEnvelope,
  IRpcRuntimeRoute,
  IRpcRuntimeOptions,
  IRpcRuntimeTask,
  IRpcRuntimeStep
} from './types.js'

/** Typed call fields supplied by Core's existing owned input and held generation resources. */
export type IRpcRuntimeCallHeader = Readonly<{
  id: string
  route: IRpcRuntimeRoute
  task: IRpcRuntimeTask
  options: IRpcRuntimeOptions
}>

/** One closed record shape preserves the original required-field failure order. */
export type IRuntimeRecordSchema = Readonly<{
  required: readonly string[]
  optional: readonly string[]
  allows(key: string): boolean
}>

/** Only the internal union parser chooses a record reader; public normalizers remain strict. */
export type IRuntimeRecordReader = (
  value: unknown,
  schema: IRuntimeRecordSchema,
  pointer: string
) => Record<string, unknown>

/** Cold schemas share key admission between decoded records and the original strict reader. */
export const RuntimeRecordSchema = {
  /** The envelope prefix is required before selecting any semantic variant. */
  envelope: {
    required: [F.profile, F.kind, F.id, F.route, F.task],
    optional: [
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
    /** The shared union later rejects fields belonging to another variant. */
    allows(key: string): boolean {
      switch (key) {
        case F.profile:
        case F.kind:
        case F.id:
        case F.route:
        case F.task:
        case F.payload:
        case F.options:
        case F.steps:
        case F.operation:
        case F.reason:
        case F.stream:
        case F.completion:
        case F.idempotencyKey:
        case F.state:
        case F.store:
        case F.outcome:
          return true
        default:
          return false
      }
    }
  },
  /** Route identity and timestamps retain their original missing-field order. */
  route: {
    required: [
      RpcRouteField.applicationVersion,
      RpcRouteField.senderId,
      RpcRouteField.targetId,
      RpcRouteField.receiverId,
      RpcRouteField.sentAt
    ],
    optional: [RpcRouteField.forwardRoute],
    /** Only the existing signed route vocabulary enters semantic route validation. */
    allows(key: string): boolean {
      switch (key) {
        case RpcRouteField.applicationVersion:
        case RpcRouteField.senderId:
        case RpcRouteField.targetId:
        case RpcRouteField.receiverId:
        case RpcRouteField.sentAt:
        case RpcRouteField.forwardRoute:
          return true
        default:
          return false
      }
    }
  },
  /** Both generation kinds use the same closed numeric-counter shape. */
  generation: {
    required: [F.kind, F.value, F.providerId],
    optional: [],
    /** Generation domain checks run after all structural required-field checks. */
    allows(key: string): boolean {
      switch (key) {
        case F.kind:
        case F.value:
        case F.providerId:
          return true
        default:
          return false
      }
    }
  },
  /** Task method presence is decided by the existing mode parser after shape admission. */
  task: {
    required: [F.mode, F.callerId, F.callerGeneration, F.targetGeneration],
    optional: [F.method],
    /** The exact caller/target generation tuple remains the only task identity grammar. */
    allows(key: string): boolean {
      switch (key) {
        case F.mode:
        case F.callerId:
        case F.callerGeneration:
        case F.targetGeneration:
        case F.method:
          return true
        default:
          return false
      }
    }
  },
  /** A group step carries one required method and an optional portable payload. */
  step: {
    required: [F.method],
    optional: [F.payload],
    /** Step payload admission stays in the selected portable-value owner. */
    allows(key: string): boolean {
      switch (key) {
        case F.method:
        case F.payload:
          return true
        default:
          return false
      }
    }
  },
  /** Wire options exclude local signals and false deadlines before policy validation. */
  options: {
    required: [],
    optional: [F.orderKey, F.cancel, F.timeoutMs, F.idempotencyKey],
    /** Existing option validators retain cancellation and idempotency ordering. */
    allows(key: string): boolean {
      switch (key) {
        case F.orderKey:
        case F.cancel:
        case F.timeoutMs:
        case F.idempotencyKey:
          return true
        default:
          return false
      }
    }
  },
  /** Completion success/error exclusivity remains a semantic decision. */
  completion: {
    required: [F.ok],
    optional: [F.result, F.error],
    /** Only the original terminal data fields enter completion projection. */
    allows(key: string): boolean {
      switch (key) {
        case F.ok:
        case F.result:
        case F.error:
          return true
        default:
          return false
      }
    }
  },
  /** A group member's state is required before validating its result/error combination. */
  stepOutcome: {
    required: [F.state],
    optional: [F.result, F.error],
    /** The group parser still owns failed/not-executed suffix ordering. */
    allows(key: string): boolean {
      switch (key) {
        case F.state:
        case F.result:
        case F.error:
          return true
        default:
          return false
      }
    }
  },
  /** Stream event and sequence retain their original required-field ordering. */
  stream: {
    required: [F.event, F.seq],
    optional: [F.value, F.error, F.reason],
    /** Stream values/errors remain subject to their existing parser. */
    allows(key: string): boolean {
      switch (key) {
        case F.event:
        case F.seq:
        case F.value:
        case F.error:
        case F.reason:
          return true
        default:
          return false
      }
    }
  },
  /** Store availability/continuity describes admitted state rather than new authority. */
  store: {
    required: [F.kind, F.continuity],
    optional: [F.epoch],
    /** Epoch requirements are decided only after the original store domain checks. */
    allows(key: string): boolean {
      switch (key) {
        case F.kind:
        case F.continuity:
        case F.epoch:
          return true
        default:
          return false
      }
    }
  },
  /** A retained outcome carries its original mode, target generation and completion. */
  outcome: {
    required: [F.mode, F.targetGeneration, F.completion],
    optional: [],
    /** Cached wire data receives the same outcome semantic validation as live terminals. */
    allows(key: string): boolean {
      switch (key) {
        case F.mode:
        case F.targetGeneration:
        case F.completion:
          return true
        default:
          return false
      }
    }
  }
} as const satisfies Readonly<Record<string, IRuntimeRecordSchema>>

/** Delegate live values to the unchanged descriptor reader and its original native error boundary. */
export function readStrictRecord(
  value: unknown,
  schema: IRuntimeRecordSchema,
  pointer: string
): Record<string, unknown> {
  return record(value, schema.required, schema.optional, pointer)
}

/**
 * Read a trusted codec result once. The decoding owner supplies provenance; this operation mints
 * none. Domain validation remains in the shared parser after original required-field checks.
 */
export function readDecodedRecord(
  value: unknown,
  schema: IRuntimeRecordSchema,
  pointer: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(pointer)
  /** Structured clone retains Date/Map/Set, which are never valid metadata records. */
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) invalid(pointer)
  /** Null-prototype writes preserve own data even when the ordinary prototype has a setter. */
  const result: Record<string, unknown> = Object.create(null)
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue
    if (!schema.allows(key)) invalid(pointer)
    result[key] = (value as Record<string, unknown>)[key]
  }
  for (const key of schema.required) if (!Object.hasOwn(result, key)) invalid(`${pointer}/${key}`)
  Object.setPrototypeOf(result, Object.prototype)
  return result
}

/** The typed constructor reuses semantic validators on its own fields, without copying metadata. */
const readConstructedRecord: IRuntimeRecordReader = (value) => value as Record<string, unknown>

/** Validate the original route domains before task/id/options, without changing its snapshot owner. */
export function validateRuntimeRouteFields(route: Record<string, unknown>): void {
  for (const field of RuntimeRecordSchema.route.required) {
    if (field === RpcRouteField.sentAt) break
    identifier(route[field], `/route/${field}`)
  }
  if (!Number.isSafeInteger(route.sentAt) || (route.sentAt as number) < 0) invalid('/route/sentAt')
  if (Object.hasOwn(route, RpcRouteField.forwardRoute)) {
    if (!isRouteFieldValid(RpcRouteField.forwardRoute, route.forwardRoute))
      invalid('/route/forwardRoute')
    route.forwardRoute = Object.freeze([...(route.forwardRoute as string[])])
  }
}

/** The same three modes require methods in task admission and are allowed on call envelopes. */
export function isRuntimeCallMode(mode: unknown): boolean {
  return (
    mode === RpcRuntimeMode.request ||
    mode === RpcRuntimeMode.notify ||
    mode === RpcRuntimeMode.stream
  )
}

/**
 * Construct one typed call using the canonical field validators in their original failure order.
 * Core supplies its owned header; this operation grants no transport or private snapshot authority.
 * The portable data operation runs last and defaults to the existing full payload admission. Caller
 * input objects are never frozen by this constructor.
 */
export function createRuntimeCallEnvelope(
  header: IRpcRuntimeCallHeader,
  payload?: IRpcPortableValue,
  portable: (value: unknown) => IRpcPortableValue = normalizeRuntimePortable
): Extract<IRpcRuntimeEnvelope, { kind: typeof RpcRuntimeKind.call }> {
  /** Route copying keeps ordinary descriptors and the original Core-built field order. */
  const route: Record<string, unknown> = { ...header.route }
  validateRuntimeRouteFields(route)
  /** Held generation fields still receive their original domain checks and nested snapshots. */
  const selected = task(header.task, readConstructedRecord)
  /** Id validation stays after route/task, while options remain after the call-mode fence. */
  const result: Record<string, unknown> = {
    profile: RpcRuntimeProfile,
    kind: RpcRuntimeKind.call,
    id: identifier(header.id, '/id'),
    route: Object.freeze(route),
    task: selected
  }
  if (!isRuntimeCallMode(selected.mode)) invalid('/task/mode')
  result.options = options({ ...header.options }, selected.mode, readConstructedRecord)
  if (payload !== undefined) result.payload = portable(payload)
  return Object.freeze(result) as Extract<IRpcRuntimeEnvelope, { kind: typeof RpcRuntimeKind.call }>
}

/** Reject closed-profile input with the existing native contract error, preserving its cause. */
export function invalid(pointer: string, cause?: unknown): never {
  throw invalidRpcEnvelope(RpcEnvelopeViolation.payload, pointer, cause)
}

/** Local factories and wire admission share this exact closed, request-only group step snapshot. */
export function normalizeRuntimeSteps(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue = normalizeRuntimePortable
): readonly IRpcRuntimeStep[] {
  return steps(value, portable, readStrictRecord)
}

/** The shared step parser uses the selected internal reader without exposing it on the public API. */
export function steps(
  value: unknown,
  portable: (value: unknown) => IRpcPortableValue,
  readRecord: IRuntimeRecordReader
): readonly IRpcRuntimeStep[] {
  const steps = array(
    value,
    (item, pointer) => {
      const step = readRecord(item, RuntimeRecordSchema.step, pointer)
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
  return generation(value, readStrictRecord)
}

/** The one generation parser preserves its domains and ordering for both internal readers. */
export function generation(
  value: unknown,
  readRecord: IRuntimeRecordReader
): IRpcRuntimeGeneration {
  const generation = readRecord(value, RuntimeRecordSchema.generation, '/generation')
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
export function task(
  value: unknown,
  readRecord: IRuntimeRecordReader = readStrictRecord
): IRpcRuntimeTask {
  const input = readRecord(value, RuntimeRecordSchema.task, '/task')
  if (!Object.values(RpcRuntimeMode).includes(input.mode as never)) invalid('/task/mode')
  const callsMethod = isRuntimeCallMode(input.mode)
  if (callsMethod !== Object.hasOwn(input, F.method)) invalid('/task/method')
  return Object.freeze({
    mode: input.mode,
    callerId: identifier(input.callerId, '/task/callerId'),
    callerGeneration: generation(input.callerGeneration, readRecord),
    targetGeneration: generation(input.targetGeneration, readRecord),
    ...(callsMethod ? { method: identifier(input.method, '/task/method') } : {})
  }) as IRpcRuntimeTask
}

/** All options are protected fields; AbortSignal and false stay at the local public boundary. */
export function options(
  value: unknown,
  mode: IRpcRuntimeTask['mode'],
  readRecord: IRuntimeRecordReader = readStrictRecord
): IRpcRuntimeOptions {
  const input = readRecord(value, RuntimeRecordSchema.options, '/options')
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
