/**
 * Admits the sole semantic frame union and delegates each field family to its canonical pure
 * parser. This boundary captures input and projects portable slots without allocating calls,
 * negotiating sessions, executing providers or performing IO.
 */
import type { IRpcErrorWireMetadata } from '../contract/types.ts'
/**
 * Admits the sole semantic frame union, delegating each field family to its existing or new grammar
 * owner. It never allocates calls/sessions, executes providers, resolves policy, or performs IO.
 */
import { normalizeRpcTask, normalizeRpcSteps } from './metadata.ts'

import { identifier, invalid } from './record.ts'

import { normalizeRpcPortable } from '../portable/normalize.ts'
import { isIdempotencyKey } from './metadata.ts'
import { RpcRuntimeOutcomeState } from './outcome-constants.ts'
import { normalizeRpcRoute, normalizeRpcCallOptions } from './metadata.ts'
import { normalizeRpcHandshakeRecord } from './handshake.ts'
import { normalizeRpcDirectory } from './directory.ts'
import { normalizeRpcWireError } from './errors.ts'
import { normalizeRpcStream } from './stream.ts'
import {
  normalizeRpcGroupResult,
  normalizeRpcOutcome,
  normalizeRpcOutcomeStore
} from './completion.ts'
import {
  RpcWireProfile,
  RpcWireKind as K,
  RpcCallMode as M,
  RpcWireControlOperation,
  RpcWireField as F,
  RpcWirePointer as P,
  RpcWireExtensionPattern
} from './constants.ts'
import type { IRpcSemanticFrame, IRpcEnvelope, IRpcTask, IRpcPortableProjector } from './types.ts'

/** Envelope extension metadata is portable data and cannot mint installed handler authority. */
function normalizeExtensions(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  portable: IRpcPortableProjector = normalizeRpcPortable
): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(P.extensions, undefined, metadata)
  /** Extension names form a dynamic portable table, distinct from fixed record metadata. */
  const extensions = value as Record<string, unknown>
  for (const key of Object.keys(extensions)) {
    if (!RpcWireExtensionPattern.test(key)) invalid(P.extensions, undefined, metadata)
    portable(extensions[key], metadata)
  }
  return value
}

/** Outcome lookup and result have disjoint fields and preserve the existing store facts. */
function normalizeOutcome(
  input: Record<string, unknown>,
  metadata?: IRpcErrorWireMetadata,
  portable: IRpcPortableProjector = normalizeRpcPortable
): void {
  if (input.operation === 'lookup') {
    if (!isIdempotencyKey(input.idempotencyKey)) invalid(P.outcome, undefined, metadata)
  } else if (input.operation === 'result') {
    if (
      input.state !== RpcRuntimeOutcomeState.pending &&
      input.state !== RpcRuntimeOutcomeState.done &&
      input.state !== RpcRuntimeOutcomeState.unknown
    )
      invalid(P.outcome, undefined, metadata)
    normalizeRpcOutcomeStore(input.store, metadata)
    if (input.state === RpcRuntimeOutcomeState.done)
      normalizeRpcOutcome(input.outcome, metadata, portable)
  } else invalid(P.outcome, undefined, metadata)
}

/**
 * Normalize operational payloads after the original normalizeRpcTask and new closed variant are
 * admitted.
 */
function normalizeOperation(
  input: Record<string, unknown>,
  selected: IRpcTask,
  metadata?: IRpcErrorWireMetadata,
  portable: IRpcPortableProjector = normalizeRpcPortable
): void {
  switch (input.kind) {
    case K.call:
      if (selected.mode !== M.request && selected.mode !== M.notify && selected.mode !== M.stream)
        invalid(P.task, undefined, metadata)
      normalizeRpcCallOptions(input.options, selected.mode, metadata)
      if (Object.hasOwn(input, F.payload)) portable(input.payload, metadata)
      return
    case K.group:
      if (selected.mode !== M.group) invalid(P.task, undefined, metadata)
      normalizeRpcCallOptions(input.options, selected.mode, metadata)
      normalizeRpcSteps(input.steps, portable, metadata)
      return
    case K.result:
      if (selected.mode === M.group) normalizeRpcGroupResult(input.result, metadata, portable)
      else if (Object.hasOwn(input, F.result)) portable(input.result, metadata)
      return
    case K.error:
      normalizeRpcWireError(input.error, metadata)
      return
    case K.cancel:
      if (Object.hasOwn(input, F.reason)) normalizeRpcWireError(input.reason, metadata)
      return
    case K.stream:
      if (selected.mode !== M.stream) invalid(P.task, undefined, metadata)
      normalizeRpcStream(input.stream, metadata, portable)
      return
    case K.outcome:
      if (selected.mode !== M.outcome) invalid(P.task, undefined, metadata)
      normalizeOutcome(input, metadata, portable)
      return
    default:
      invalid(P.kind, undefined, metadata)
  }
}

/** Validate only the selected protocol fields and return the original frame, including frozen input. */
export function normalizeRpcFrame(
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  portable: IRpcPortableProjector = normalizeRpcPortable
): IRpcSemanticFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(P.root, undefined, metadata)
  /** Fixed metadata reads do not enumerate unknown properties or create a frame snapshot. */
  const input = value as Record<string, unknown>
  if (input.profile === undefined) invalid('/profile', undefined, metadata)
  if (input.kind === undefined) invalid('/kind', undefined, metadata)
  if (input.profile !== RpcWireProfile) invalid(P.profile, undefined, metadata)
  if (typeof input.kind !== 'string' || !Object.hasOwn(K, input.kind))
    invalid(P.kind, undefined, metadata)
  if (input.kind === K.handshake) return normalizeRpcHandshakeRecord(input, metadata)
  if (input.id === undefined) invalid(P.id, undefined, metadata)
  if (input.route === undefined) invalid('/route', undefined, metadata)
  if (input.kind !== K.control && input.kind !== K.directory && input.task === undefined)
    invalid('/task', undefined, metadata)
  identifier(input.id, P.id, metadata)
  normalizeRpcRoute(input.route, metadata)
  if (input.kind === K.control || input.kind === K.directory) {
    if (input.kind === K.directory) normalizeRpcDirectory(input.directory, metadata)
    else {
      if (
        typeof input.operation !== 'string' ||
        !Object.hasOwn(RpcWireControlOperation, input.operation)
      )
        invalid(P.kind, undefined, metadata)
      if (Object.hasOwn(input, F.reason)) normalizeRpcWireError(input.reason, metadata)
    }
    return value as IRpcSemanticFrame
  }
  /** Task admission is shared, while only this variant's business slots invoke the projector. */
  const selected = normalizeRpcTask(input.task, metadata)
  if (Object.hasOwn(input, F.extensions)) normalizeExtensions(input.extensions, metadata, portable)
  normalizeOperation(input, selected, metadata, portable)
  return value as IRpcSemanticFrame
}

/** Classify an already-admitted frame by its actual kind, never by extra task-shaped metadata. */
export function isRpcOperationalFrame(frame: IRpcSemanticFrame): frame is IRpcEnvelope {
  return frame.kind !== K.handshake && frame.kind !== K.control && frame.kind !== K.directory
}
