/**
 * Owns pure route, task, generation, step and call-option grammar shared by semantic frame
 * variants. Snapshotting validates declared facts and relative budgets without authorizing peers,
 * selecting feature instances or deciding whether a generation is current.
 */
import type { IRpcErrorWireMetadata } from '../contract/types.js'
/** Shared generation, task, group and call-option grammar for the single profile. */
import { normalizeRpcPortable } from '../portable/normalize.js'
import { RpcCallMode, RpcWireField as F } from './constants.js'
import { RpcWireLimit } from './limits.js'
import { identifier, invalid } from './record.js'
import type {
  IRpcCallOptions,
  IRpcRoute,
  IRpcTask,
  IRpcGeneration,
  IRpcStep,
  IRpcPortableProjector
} from './types.js'

/** The retained scalar-failure order checks target identity before physical receiver identity. */
const routeIdentityFields = [F.applicationVersion, F.senderId, F.targetId, F.receiverId] as const

/** Validate the original route domains before task/id/options, without changing its snapshot owner. */
export function validateRpcRouteFields(
  route: Record<string, unknown>,
  metadata?: IRpcErrorWireMetadata
): void {
  for (const field of routeIdentityFields) {
    identifier(route[field], `/route/${field}`, metadata)
  }
  if (!Number.isSafeInteger(route.sentAt) || (route.sentAt as number) < 0)
    invalid('/route/sentAt', undefined, metadata)
  if (Object.hasOwn(route, F.trace)) normalizeRpcTrace(route.trace, metadata)
  if (Object.hasOwn(route, F.forwardRoute)) {
    if (!isForwardRoute(route.forwardRoute)) invalid('/route/forwardRoute', undefined, metadata)
  }
}

/** The same three modes require methods in task admission and are allowed on call envelopes. */
export function isRpcCallMode(mode: unknown): boolean {
  return mode === RpcCallMode.request || mode === RpcCallMode.notify || mode === RpcCallMode.stream
}

/** The closed mode domain adds only atomic groups and read-only outcomes to call modes. */
export function isRpcMode(mode: unknown): mode is keyof typeof RpcCallMode {
  return isRpcCallMode(mode) || mode === RpcCallMode.group || mode === RpcCallMode.outcome
}

/** Validate the known fields of one group step, borrowing its original payload for one walk. */
function validateStep(
  value: unknown,
  pointer: string,
  portable: IRpcPortableProjector,
  metadata?: IRpcErrorWireMetadata
): IRpcStep {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(pointer, undefined, metadata)
  /** The original record is retained; unknown fields have no protocol meaning. */
  const step = value as Record<string, unknown>
  identifier(step.method, `${pointer}/method`, metadata)
  if (Object.hasOwn(step, F.payload)) portable(step.payload, metadata)
  return value as IRpcStep
}

/** Validate each original group step in order without copying the metadata list. */
export function normalizeRpcSteps(
  value: unknown,
  portable: IRpcPortableProjector = normalizeRpcPortable,
  metadata?: IRpcErrorWireMetadata
): readonly IRpcStep[] {
  if (!Array.isArray(value) || value.length === 0) invalid('/steps', undefined, metadata)
  for (let index = 0; index < value.length; index++)
    validateStep(value[index], `/steps/${index}`, portable, metadata)
  return value as readonly IRpcStep[]
}

/** Validate issuer, kind and counter directly without establishing current-generation authority. */
export function normalizeRpcGeneration(
  value: unknown,
  metadata?: IRpcErrorWireMetadata
): IRpcGeneration {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('/generation', undefined, metadata)
  /** Only these three fields belong to generation metadata. */
  const generation = value as Record<string, unknown>
  if (generation.kind === undefined) invalid('/generation/kind', undefined, metadata)
  if (generation.value === undefined) invalid('/generation/value', undefined, metadata)
  if (generation.providerId === undefined) invalid('/generation/providerId', undefined, metadata)
  if (generation.kind !== 'restart' && generation.kind !== 'session')
    invalid('/generation/kind', undefined, metadata)
  if (!Number.isSafeInteger(generation.value) || (generation.value as number) < 0)
    invalid('/generation/value', undefined, metadata)
  identifier(generation.providerId, '/generation/providerId', metadata)
  return value as IRpcGeneration
}

/** Validate correlated task identity and the mode-owned method on the original record. */
export function normalizeRpcTask(value: unknown, metadata?: IRpcErrorWireMetadata): IRpcTask {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('/task', undefined, metadata)
  /** Metadata validation does not create an alternate task or invoke a provider. */
  const input = value as Record<string, unknown>
  if (input.mode === undefined) invalid('/task/mode', undefined, metadata)
  if (input.callerId === undefined) invalid('/task/callerId', undefined, metadata)
  if (input.callerGeneration === undefined) invalid('/task/callerGeneration', undefined, metadata)
  if (input.targetGeneration === undefined) invalid('/task/targetGeneration', undefined, metadata)
  if (!isRpcMode(input.mode)) invalid('/task/mode', undefined, metadata)
  /** Only call modes own a method; other modes ignore additional fields. */
  const callsMethod = isRpcCallMode(input.mode)
  if (callsMethod && input.method === undefined) invalid('/task/method', undefined, metadata)
  identifier(input.callerId, '/task/callerId', metadata)
  normalizeRpcGeneration(input.callerGeneration, metadata)
  normalizeRpcGeneration(input.targetGeneration, metadata)
  if (callsMethod) identifier(input.method, '/task/method', metadata)
  return value as IRpcTask
}

/** Accept only bounded direct-hop routing and a finite nonnegative remaining budget. */
export function normalizeRpcRoute(value: unknown, metadata?: IRpcErrorWireMetadata): IRpcRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('/route', undefined, metadata)
  /** Direct reads preserve the caller's record, including frozen input. */
  const route = value as Record<string, unknown>
  for (const field of routeIdentityFields)
    if (route[field] === undefined) invalid(`/route/${field}`, undefined, metadata)
  if (route.sentAt === undefined) invalid('/route/sentAt', undefined, metadata)
  validateRpcRouteFields(route, metadata)
  if (Object.hasOwn(route, F.remainingMs)) normalizeRpcRemainingMs(route.remainingMs, metadata)
  return value as IRpcRoute
}

/** Admit one relative wire budget before a native drain can allocate its deadline or barrier. */
export function normalizeRpcRemainingMs(value: unknown, metadata?: IRpcErrorWireMetadata): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > RpcWireLimit.maxDurationMs
  )
    invalid('/route/remainingMs', undefined, metadata)
  return value
}
/** This existing route proof admits the bounded ordered native node identities. */
export function isForwardRoute(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length <= RpcWireLimit.maxForwardRouteNodes &&
    value.every((node) => typeof node === 'string' && /^[0-9a-f]{32}$/u.test(node))
  )
}
/** An actual idempotency key is a bounded safe token, never a source capability. */
export function isIdempotencyKey(value: unknown): boolean {
  return typeof value === 'string' && /^[A-Za-z0-9._:~-]{1,128}$/u.test(value)
}
/** Validate common call-option fields on a record whose exact variant shape was already read. */
export function validateRpcCallOptions(
  input: Record<string, unknown>,
  mode: IRpcTask['mode'],
  metadata?: IRpcErrorWireMetadata
): IRpcCallOptions {
  if (Object.hasOwn(input, F.orderKey)) identifier(input.orderKey, '/options/orderKey', metadata)
  if (Object.hasOwn(input, F.cancel) && input.cancel !== 'before-start')
    invalid('/options/cancel', undefined, metadata)
  if (Object.hasOwn(input, F.idempotencyKey)) {
    if (!isIdempotencyKey(input.idempotencyKey))
      invalid('/options/idempotencyKey', undefined, metadata)
    if (
      (mode === RpcCallMode.notify || mode === RpcCallMode.stream) &&
      input.cancel !== 'before-start'
    )
      invalid('/options/cancel', undefined, metadata)
  }
  return input as IRpcCallOptions
}
/** Admit the known wire options; local feature fields remain opaque and have no wire effect. */
export function normalizeRpcCallOptions(
  value: unknown,
  mode: IRpcTask['mode'],
  metadata?: IRpcErrorWireMetadata
): IRpcCallOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('/options', undefined, metadata)
  return validateRpcCallOptions(value as Record<string, unknown>, mode, metadata)
}
export { normalizeRpcPortable }

/** Preserve the original explicit 1..256 printable-ASCII trace without interpreting its contents. */
export function normalizeRpcTrace(value: unknown, metadata?: IRpcErrorWireMetadata): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > RpcWireLimit.maxTraceChars ||
    !/^[\x20-\x7e]+$/u.test(value)
  )
    invalid('/route/trace', undefined, metadata)
  return value
}
