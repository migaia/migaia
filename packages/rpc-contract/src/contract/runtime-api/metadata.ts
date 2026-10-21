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
  /** Bounded original operation correlation identity. */
  id: string
  /** Core-owned protected hop routing data, copied into the returned envelope. */
  route: IRpcRuntimeRoute
  /** Held caller/target generation tuple with a request, notify or stream mode. */
  task: IRpcRuntimeTask
  /** Explicit operation options, independently copied and validated. */
  options: IRpcRuntimeOptions
}>

/** One closed record shape preserves the original required-field failure order. */
export type IRuntimeRecordSchema = Readonly<{
  required: readonly string[]
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

/** Snapshot live own data once, retaining descriptor rejection and the original native error cause. */
export function readStrictRecord(
  value: unknown,
  schema: IRuntimeRecordSchema,
  pointer: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(pointer)
  try {
    /** Only portable ordinary records can be metadata, never arbitrary owner objects. */
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) invalid(pointer)
    /** Descriptor reads reject getters without invoking them. */
    const descriptors = Object.getOwnPropertyDescriptors(value)
    /** Define own data directly on the ordinary result, bypassing inherited setters. */
    const result: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(descriptors)) {
      if (typeof key !== 'string' || !schema.allows(key)) invalid(pointer)
      /** Non-enumerable and accessor properties cannot disappear during the wire round trip. */
      const descriptor = descriptors[key]!
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
        invalid(`${pointer}/${key}`)
      descriptor.writable = true
      descriptor.configurable = true
      Object.defineProperty(result, key, descriptor)
    }
    for (const key of schema.required) if (!Object.hasOwn(result, key)) invalid(`${pointer}/${key}`)
    return result
  } catch (cause) {
    if (
      cause instanceof TypeError &&
      Reflect.get(cause, 'code') === RpcContractErrorCode.invalidEnvelope
    )
      throw cause
    invalid(pointer, cause)
  }
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

/** The closed mode domain adds only atomic groups and read-only outcomes to call modes. */
export function isRuntimeMode(mode: unknown): mode is RpcRuntimeMode {
  return isRuntimeCallMode(mode) || mode === RpcRuntimeMode.group || mode === RpcRuntimeMode.outcome
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

/**
 * Validate a nonempty dense own-data step list and return fresh frozen steps/list. Payloads use the
 * supplied portable operation, defaulting to runtime-native admission. Invalid structure or method
 * values throw INVALID_ENVELOPE with the failing pointer; this performs no provider execution.
 */
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

/** Dense arrays contain only own data indexes; sparse or extra-field shapes are not wire grammar. */
export function array<T>(
  value: unknown,
  normalize: (value: unknown, pointer: string) => T,
  pointer: string
): readonly T[] {
  if (!Array.isArray(value)) invalid(pointer)
  /** The input's index descriptors are read once without executing index accessors. */
  let descriptors: Record<string, PropertyDescriptor>
  try {
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch (cause) {
    invalid(pointer, cause)
  }
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

/**
 * Validate a closed generation record and return a frozen snapshot of its issuer, kind and
 * nonnegative safe-integer counter. Invalid fields throw INVALID_ENVELOPE; this parser does not
 * establish that a remote generation is current or authorized.
 */
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
    (generation.kind !== RpcRuntimeGenerationKind.restart &&
      generation.kind !== RpcRuntimeGenerationKind.session) ||
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
  if (!isRuntimeMode(input.mode)) invalid('/task/mode')
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
