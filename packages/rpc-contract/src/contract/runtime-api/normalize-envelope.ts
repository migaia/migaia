import {
  invalid,
  readStrictRecord,
  RuntimeRecordSchema,
  validateRuntimeRouteFields,
  isRuntimeCallMode,
  isRuntimeMode,
  array,
  identifier,
  task,
  options,
  steps,
  generation,
  type IRuntimeRecordReader
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
  portable: (value: unknown) => IRpcPortableValue,
  readRecord: IRuntimeRecordReader
): IRpcRuntimeCompletion {
  const input = readRecord(value, RuntimeRecordSchema.completion, '/completion')
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
        const item = readRecord(value, RuntimeRecordSchema.stepOutcome, pointer)
        if (failed) {
          if (
            item.state !== RpcRuntimeStepState.notExecuted ||
            Object.hasOwn(item, F.result) ||
            Object.hasOwn(item, F.error)
          )
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
  ) => IRpcStreamPayload | Promise<IRpcStreamPayload>,
  readRecord: IRuntimeRecordReader = readStrictRecord
): IRpcRuntimeEnvelope | Promise<IRpcRuntimeEnvelope> {
  /**
   * First snapshot establishes the discriminator while retaining every field for its closed
   * variant.
   */
  const input = readRecord(value, RuntimeRecordSchema.envelope, '')
  if (
    input.profile !== RpcRuntimeProfile ||
    (input.kind !== RpcRuntimeKind.call &&
      input.kind !== RpcRuntimeKind.group &&
      input.kind !== RpcRuntimeKind.control &&
      input.kind !== RpcRuntimeKind.outcome)
  )
    invalid('')
  /** The original route validator owns all reused domains, including optional signed forward routes. */
  const route = readRecord(input.route, RuntimeRecordSchema.route, '/route')
  validateRuntimeRouteFields(route)
  /** This selected task is the one tuple carried by every normalized result. */
  const selected = task(input.task, readRecord)
  /** The common prefix is rebuilt from admitted data only. */
  const result: Record<string, unknown> = {
    profile: RpcRuntimeProfile,
    kind: input.kind,
    id: identifier(input.id, '/id'),
    route: Object.freeze(route),
    task: selected
  }
  if (input.kind === RpcRuntimeKind.call || input.kind === RpcRuntimeKind.group) {
    const group = input.kind === RpcRuntimeKind.group
    if (group ? selected.mode !== RpcRuntimeMode.group : !isRuntimeCallMode(selected.mode))
      invalid('/task/mode')
    result.options = options(input.options, selected.mode, readRecord)
    if (group) {
      result.steps = steps(input.steps, portable, readRecord)
    } else if (Object.hasOwn(input, F.payload)) result.payload = portable(input.payload)
  } else if (input.kind === RpcRuntimeKind.control) {
    if (
      selected.mode === RpcRuntimeMode.outcome &&
      input.operation !== RpcRuntimeOperation.terminal
    )
      invalid('/task/mode')
    result.operation = input.operation
    if (input.operation === RpcRuntimeOperation.cancel) {
      if (Object.hasOwn(input, F.reason)) result.reason = normalizeRpcSerializedError(input.reason)
    } else if (input.operation === RpcRuntimeOperation.terminal) {
      if (selected.mode === RpcRuntimeMode.stream) invalid('/operation')
      result.completion = completion(input.completion, selected.mode, portable, readRecord)
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
      const stream = readRecord(input.stream, RuntimeRecordSchema.stream, '/stream')
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
            return finishRuntimeEnvelope(input, result)
          })
        result.stream = normalized
        if (stream.event === RpcStreamEvent.open && stream.seq !== 0) invalid('/stream/seq')
      }
    } else invalid('/operation')
  } else {
    if (selected.mode !== RpcRuntimeMode.outcome) invalid('/task/mode')
    result.operation = input.operation
    if (input.operation === RpcRuntimeOperation.lookup) {
      if (!isRouteFieldValid(RpcRouteField.idempotencyKey, input.idempotencyKey))
        invalid('/idempotencyKey')
      result.idempotencyKey = input.idempotencyKey
    } else if (input.operation === RpcRuntimeOperation.result) {
      if (
        input.state !== RpcRuntimeOutcomeState.pending &&
        input.state !== RpcRuntimeOutcomeState.done &&
        input.state !== RpcRuntimeOutcomeState.unknown
      )
        invalid('/state')
      const store = readRecord(input.store, RuntimeRecordSchema.store, '/store')
      if (
        (store.kind !== RpcRuntimeStoreKind.memory &&
          store.kind !== RpcRuntimeStoreKind.external &&
          store.kind !== RpcRuntimeStoreKind.unavailable) ||
        (store.continuity !== RpcRuntimeStoreContinuity.retained &&
          store.continuity !== RpcRuntimeStoreContinuity.lost &&
          store.continuity !== RpcRuntimeStoreContinuity.unavailable)
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
        const outcome = readRecord(input.outcome, RuntimeRecordSchema.outcome, '/outcome')
        if (outcome.mode === RpcRuntimeMode.outcome || !isRuntimeMode(outcome.mode))
          invalid('/outcome/mode')
        result.outcome = Object.freeze({
          mode: outcome.mode,
          targetGeneration: generation(outcome.targetGeneration, readRecord),
          completion: completion(
            outcome.completion,
            outcome.mode as IRpcRuntimeTask['mode'],
            portable,
            readRecord
          )
        })
      } else if (Object.hasOwn(input, F.outcome)) invalid('/outcome')
    } else invalid('/operation')
  }
  return finishRuntimeEnvelope(input, result)
}

/**
 * Apply the original variant field fence and publish the same frozen envelope after stream
 * validation.
 */
function finishRuntimeEnvelope(
  input: Record<string, unknown>,
  result: Record<string, unknown>
): IRpcRuntimeEnvelope {
  for (const field in input) {
    if (!Object.hasOwn(input, field)) continue
    switch (field) {
      case F.profile:
      case F.kind:
      case F.id:
      case F.route:
      case F.task:
        continue
      case F.options:
        if (input.kind === RpcRuntimeKind.call || input.kind === RpcRuntimeKind.group) continue
        break
      case F.payload:
        if (input.kind === RpcRuntimeKind.call) continue
        break
      case F.steps:
        if (input.kind === RpcRuntimeKind.group) continue
        break
      case F.operation:
        if (input.kind === RpcRuntimeKind.control || input.kind === RpcRuntimeKind.outcome) continue
        break
      case F.reason:
        if (input.kind === RpcRuntimeKind.control && input.operation === RpcRuntimeOperation.cancel)
          continue
        break
      case F.completion:
        if (
          input.kind === RpcRuntimeKind.control &&
          input.operation === RpcRuntimeOperation.terminal
        )
          continue
        break
      case F.stream:
        if (input.kind === RpcRuntimeKind.control && input.operation === RpcRuntimeOperation.stream)
          continue
        break
      case F.idempotencyKey:
        if (input.kind === RpcRuntimeKind.outcome && input.operation === RpcRuntimeOperation.lookup)
          continue
        break
      case F.state:
      case F.store:
      case F.outcome:
        if (input.kind === RpcRuntimeKind.outcome && input.operation === RpcRuntimeOperation.result)
          continue
        break
    }
    invalid(`/${field}`)
  }
  return Object.freeze(result) as IRpcRuntimeEnvelope
}
