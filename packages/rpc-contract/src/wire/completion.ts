/**
 * Admits fail-stop group reports, retained completions and outcome-store facts for the sole
 * profile. These pure snapshots preserve execution order and flat errors without running providers
 * or owning an idempotency store.
 */
import type { IRpcPortableProjector } from './types.js'
import type { IRpcErrorWireMetadata } from '../contract/types.js'
/**
 * Validates fail-stop group reports and retained outcome facts under the existing runtime rules. It
 * never executes providers, reserves work, or owns an idempotency result store.
 */
import { normalizeRpcGeneration, isRpcMode } from './metadata.js'

import { invalid } from './record.js'

import { normalizeRpcPortable } from '../portable/normalize.js'
import {
  RpcRuntimeStoreKind,
  RpcRuntimeStoreContinuity,
  RpcRuntimeOutcomeState
} from './outcome-constants.js'
import { normalizeRpcWireError } from './errors.js'
import {
  RpcCallMode,
  RpcWireField as F,
  RpcWirePointer as P,
  RpcWireStepState as S
} from './constants.js'
import type {
  IRpcStepOutcome,
  IRpcTask,
  IRpcCompletion,
  IRpcOutcomeStore,
  IRpcOutcome
} from './types.js'

/** Validate one original group outcome under its preceding fail-stop state. */
function validateStepOutcome(
  value: unknown,
  pointer: string,
  failed: boolean,
  metadata: IRpcErrorWireMetadata | undefined,
  portable: IRpcPortableProjector
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(pointer, undefined, metadata)
  /** Only the selected state owns error/result fields; unrelated metadata is ignored. */
  const item = value as Record<string, unknown>
  if (failed) {
    if (item.state !== S.notExecuted) invalid(`${pointer}/state`, undefined, metadata)
    return true
  }
  if (item.state === S.failure) {
    normalizeRpcWireError(item.error, metadata)
    return true
  }
  if (item.state !== S.success) invalid(`${pointer}/state`, undefined, metadata)
  if (Object.hasOwn(item, F.result)) portable(item.result, metadata)
  return false
}

/** Preserve the first-failure/not-executed suffix rule without copying the outcome list. */
export function normalizeRpcGroupResult(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  portable: IRpcPortableProjector = normalizeRpcPortable
): readonly IRpcStepOutcome[] {
  if (!Array.isArray(value) || value.length === 0) invalid(P.result, undefined, metadata)
  /** This scalar tracks only the preceding item in this actual result list. */
  let failed = false
  for (let index = 0; index < value.length; index++)
    failed = validateStepOutcome(value[index], `${P.result}/${index}`, failed, metadata, portable)
  return value as readonly IRpcStepOutcome[]
}

/** Successful groups require a complete report; other actual undefined results stay omitted. */
export function normalizeRpcCompletion(
  value: unknown,
  mode: IRpcTask['mode'],
  metadata?: IRpcErrorWireMetadata,
  portable: IRpcPortableProjector = normalizeRpcPortable
): IRpcCompletion {
  /** Captured fields remain separate from the source object or external result-store owner. */
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(P.outcome, undefined, metadata)
  /** Only ok/result/error have completion meaning. */
  const input = value as Record<string, unknown>
  if (input.ok === undefined) invalid(`${P.outcome}/ok`, undefined, metadata)
  if (input.ok === false) {
    if (input.error === undefined) invalid(`${P.outcome}/error`, undefined, metadata)
    normalizeRpcWireError(input.error, metadata)
    return value as IRpcCompletion
  }
  if (input.ok !== true) invalid(`${P.outcome}/ok`, undefined, metadata)
  if (mode === RpcCallMode.group) normalizeRpcGroupResult(input.result, metadata, portable)
  else if (Object.hasOwn(input, F.result)) portable(input.result, metadata)
  return value as IRpcCompletion
}

/** Store availability is a descriptive fact with the original epoch/continuity semantics. */
export function normalizeRpcOutcomeStore(
  value: unknown,
  metadata?: IRpcErrorWireMetadata
): IRpcOutcomeStore {
  /** The snapshot cannot install a result store or turn unknown into proof of nonexecution. */
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(P.store, undefined, metadata)
  /** Store metadata describes availability without acquiring a store. */
  const input = value as Record<string, unknown>
  if (input.kind === undefined) invalid(`${P.store}/kind`, undefined, metadata)
  if (input.continuity === undefined) invalid(`${P.store}/continuity`, undefined, metadata)
  if (input.kind === RpcRuntimeStoreKind.unavailable) {
    if (input.continuity !== RpcRuntimeStoreContinuity.unavailable)
      invalid(`${P.store}/continuity`, undefined, metadata)
  } else {
    if (input.kind !== RpcRuntimeStoreKind.memory && input.kind !== RpcRuntimeStoreKind.external)
      invalid(`${P.store}/kind`, undefined, metadata)
    if (
      input.continuity !== RpcRuntimeStoreContinuity.retained &&
      input.continuity !== RpcRuntimeStoreContinuity.lost
    )
      invalid(`${P.store}/continuity`, undefined, metadata)
    if (typeof input.epoch !== 'string' || input.epoch.length === 0)
      invalid(`${P.store}/epoch`, undefined, metadata)
  }
  return value as IRpcOutcomeStore
}

/**
 * A sealed outcome retains its original mode and producing readRpcGeneration, not this query's
 * normalizeRpcTask.
 */
export function normalizeRpcOutcome(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  portable: IRpcPortableProjector = normalizeRpcPortable
): IRpcOutcome {
  /** All fields are admitted before any result-store consumer can see this record. */
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(P.outcome, undefined, metadata)
  /** A retained result borrows its original task and completion records. */
  const input = value as Record<string, unknown>
  if (input.mode === undefined) invalid(`${P.outcome}/mode`, undefined, metadata)
  if (input.targetGeneration === undefined)
    invalid(`${P.outcome}/targetGeneration`, undefined, metadata)
  if (input.completion === undefined) invalid(`${P.outcome}/completion`, undefined, metadata)
  if (!isRpcMode(input.mode) || input.mode === RpcCallMode.outcome)
    invalid(`${P.outcome}/mode`, undefined, metadata)
  normalizeRpcGeneration(input.targetGeneration, metadata)
  normalizeRpcCompletion(input.completion, input.mode, metadata, portable)
  return value as IRpcOutcome
}

/** The existing state vocabulary is shared with the optional idempotency plugin. */
export { RpcRuntimeOutcomeState }
