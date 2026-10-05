import { createContractError } from '../contract-error.js'
import { RpcContractErrorCode } from '../error-code.js'
import type { IRpcEnvelopeOptions, IRpcPortableValue } from '../types.js'
import {
  RpcRouteField,
  RpcRouteProfile,
  RpcRouteType,
  RpcWireLimit,
  type RpcRouteType as IRpcRouteType
} from '../wire-constants.js'

/** Contract-owned route metadata shared by every protocol 1.0 envelope. */
export type IRpcRouteHeader = Readonly<{
  profile: typeof RpcRouteProfile
  type: IRpcRouteType
  applicationVersion: string
  senderId: string
  targetId: string
  sentAt: number
  receiverId?: string
  dispatchOnly?: boolean
  method?: string
  manual?: boolean
  resolvedTargetId?: string
  platform?: string
  accepted?: boolean
  message?: string
  operation?: 'unregister'
  variation?: string
  timeoutMs?: number
  idempotencyKey?: string
  trace?: string
  /** Signed route contains the origin followed by at most three actual forwarding Hosts. */
  forwardRoute?: readonly string[]
}>

/** A normalized data slot with contract-owned routing and portable application data. */
export type IRpcEnvelopeData = Readonly<{
  route: IRpcRouteHeader
  payload?: IRpcPortableValue
}>

/** Control payloads stay opaque until the owning control subtype decodes them. */
export type IRpcControlData = Readonly<{
  route: IRpcRouteHeader
  payload?: unknown
}>

/** Stable field order makes first-failure selection independent of object key insertion order. */
const REQUIRED_FIELDS = [
  RpcRouteField.profile,
  RpcRouteField.type,
  RpcRouteField.applicationVersion,
  RpcRouteField.senderId,
  RpcRouteField.targetId,
  RpcRouteField.sentAt
] as const

/** Each route type admits only the fields used by that operation. */
const OPTIONAL_FIELDS: Readonly<Record<IRpcRouteType, readonly string[]>> = {
  [RpcRouteType.request]: [
    RpcRouteField.receiverId,
    RpcRouteField.dispatchOnly,
    RpcRouteField.timeoutMs,
    RpcRouteField.idempotencyKey,
    RpcRouteField.trace,
    RpcRouteField.forwardRoute
  ],
  [RpcRouteType.response]: [RpcRouteField.receiverId, RpcRouteField.method, RpcRouteField.message],
  [RpcRouteType.discoveryQuery]: [RpcRouteField.manual],
  [RpcRouteType.discoveryResponse]: [
    RpcRouteField.receiverId,
    RpcRouteField.manual,
    RpcRouteField.resolvedTargetId,
    RpcRouteField.platform,
    RpcRouteField.accepted,
    RpcRouteField.message,
    RpcRouteField.operation
  ],
  [RpcRouteType.variation]: [RpcRouteField.receiverId, RpcRouteField.variation],
  [RpcRouteType.stream]: [RpcRouteField.receiverId]
}

/** Attaches the first semantic violation and its JSON pointer without replacing the cause. */
export function invalidRpcEnvelope(violation: string, pointer: string, cause?: unknown): TypeError {
  const error = createContractError(RpcContractErrorCode.invalidEnvelope, cause) as TypeError
  Object.defineProperties(error, {
    violation: { value: violation, enumerable: true },
    pointer: { value: pointer, enumerable: true }
  })
  return error
}

/** Snapshot an ordinary record exactly once, preserving a hostile read as the original cause. */
export function snapshotRpcRecord(
  value: unknown,
  pointer: string,
  shapeViolation: 'type' | 'route'
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw invalidRpcEnvelope(shapeViolation, pointer)
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
      throw invalidRpcEnvelope(shapeViolation, pointer)
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Object.keys(value)) result[key] = (value as Record<string, unknown>)[key]
    return result
  } catch (cause) {
    if (
      cause instanceof TypeError &&
      (cause as { readonly code?: unknown }).code === RpcContractErrorCode.invalidEnvelope
    )
      throw cause
    throw invalidRpcEnvelope('read', pointer, cause)
  }
}

/** Compare Unicode scalar values so warning order is portable across languages. */
export function compareRpcFieldNames(left: string, right: string): number {
  const a = Array.from(left)
  const b = Array.from(right)
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const difference = a[index]!.codePointAt(0)! - b[index]!.codePointAt(0)!
    if (difference !== 0) return difference
  }
  return a.length - b.length
}

/** Reject invalid known route values and silently drop only unknown or illegal optional keys. */
export function normalizeRpcRoute(
  value: unknown,
  expectedTypes: readonly IRpcRouteType[],
  options?: IRpcEnvelopeOptions
): IRpcRouteHeader {
  const record = snapshotRpcRecord(value, '/data/route', 'route')
  for (const field of REQUIRED_FIELDS) {
    if (!Object.hasOwn(record, field)) throw invalidRpcEnvelope('required', `/data/route/${field}`)
  }
  const type = record.type
  if (record.profile !== RpcRouteProfile) throw invalidRpcEnvelope('route', '/data/route/profile')
  if (typeof type !== 'string' || !expectedTypes.includes(type as IRpcRouteType))
    throw invalidRpcEnvelope('route', '/data/route/type')
  const routeType = type as IRpcRouteType
  if (!Object.hasOwn(OPTIONAL_FIELDS, routeType))
    throw invalidRpcEnvelope('route', '/data/route/type')
  for (const field of [
    RpcRouteField.applicationVersion,
    RpcRouteField.senderId,
    RpcRouteField.targetId
  ]) {
    if (!isIdentifier(record[field])) throw invalidRpcEnvelope('route', `/data/route/${field}`)
  }
  if (!Number.isSafeInteger(record.sentAt) || (record.sentAt as number) < 0)
    throw invalidRpcEnvelope('route', '/data/route/sentAt')
  const normalized: Record<string, unknown> = {
    profile: RpcRouteProfile,
    type: routeType,
    applicationVersion: record.applicationVersion,
    senderId: record.senderId,
    targetId: record.targetId,
    sentAt: record.sentAt
  }
  const optional = OPTIONAL_FIELDS[routeType]
  for (const field of optional) {
    if (!Object.hasOwn(record, field)) continue
    const current = record[field]
    if (!isRouteFieldValid(field, current))
      throw invalidRpcEnvelope('route', `/data/route/${field}`)
    normalized[field] =
      field === RpcRouteField.forwardRoute ? Object.freeze([...(current as string[])]) : current
  }
  const requiredOptional =
    routeType === RpcRouteType.response
      ? RpcRouteField.method
      : routeType === RpcRouteType.discoveryResponse
        ? RpcRouteField.resolvedTargetId
        : routeType === RpcRouteType.variation
          ? RpcRouteField.variation
          : undefined
  if (requiredOptional && !Object.hasOwn(normalized, requiredOptional))
    throw invalidRpcEnvelope('required', `/data/route/${requiredOptional}`)
  const known = new Set<string>([...REQUIRED_FIELDS, ...optional])
  for (const field of Object.keys(record)
    .filter((key) => !known.has(key))
    .sort(compareRpcFieldNames))
    options?.onUnknownField?.('/data/route', field)
  return Object.freeze(normalized) as IRpcRouteHeader
}

/** A bounded nonempty identifier is the common routing identity domain. */
export function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length > 0 && value.length <= RpcWireLimit.maxIdentifierChars
  )
}

/** Validate each optional field according to its declared wire domain. */
export function isRouteFieldValid(field: string, value: unknown): boolean {
  if (field === RpcRouteField.forwardRoute)
    return (
      Array.isArray(value) &&
      value.length >= 2 &&
      value.length <= 4 &&
      value.every((node) => typeof node === 'string' && /^[0-9a-f]{32}$/u.test(node))
    )
  if (
    field === RpcRouteField.receiverId ||
    field === RpcRouteField.method ||
    field === RpcRouteField.resolvedTargetId ||
    field === RpcRouteField.platform
  )
    return isIdentifier(value)
  if (field === RpcRouteField.message) return typeof value === 'string'
  if (
    field === RpcRouteField.dispatchOnly ||
    field === RpcRouteField.manual ||
    field === RpcRouteField.accepted
  )
    return typeof value === 'boolean'
  if (field === RpcRouteField.operation) return value === 'unregister'
  if (field === RpcRouteField.variation)
    return typeof value === 'string' && /^[a-z][a-z0-9-]{0,31}$/u.test(value)
  if (field === RpcRouteField.timeoutMs)
    return (
      Number.isInteger(value) &&
      (value as number) >= 0 &&
      (value as number) <= RpcWireLimit.maxDurationMs
    )
  if (field === RpcRouteField.idempotencyKey)
    return typeof value === 'string' && /^[A-Za-z0-9._:~-]{1,128}$/u.test(value)
  if (field === RpcRouteField.trace)
    return (
      typeof value === 'string' &&
      value.length >= 1 &&
      value.length <= RpcWireLimit.maxTraceChars &&
      /^[\x20-\x7E]+$/u.test(value)
    )
  return false
}
