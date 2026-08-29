import { WebRpcMessageKind, WebRpcVariation } from './protocol-constants.js'
import type { ISerializedError } from './error-serialization.js'
import { WebRpcError, WebRpcErrorCode } from './errors.js'
import { WebRpcErrorText } from './error-text.js'

export type IWebRpcVariation = (typeof WebRpcVariation)[keyof typeof WebRpcVariation]
export type IWebRpcDiscoveryQuery = {
  readonly kind: typeof WebRpcMessageKind.discoveryQuery
  readonly taskId: string
  readonly senderId: string
  readonly targetId: string
  readonly sentAt: number
  readonly data?: unknown
  readonly manual?: boolean
}
export type IWebRpcDiscoveryResponse = {
  readonly kind: typeof WebRpcMessageKind.discoveryResponse
  readonly taskId: string
  readonly senderId: string
  readonly targetId: string
  readonly resolvedTargetId: string
  readonly sentAt: number
  readonly platform?: string
  readonly data?: unknown
  readonly receiverId?: string
  readonly manual?: boolean
  readonly accepted?: boolean
  readonly message?: string
  readonly operation?: 'unregister'
}
/**
 * Chunk frames intentionally omit an independent timestamp: freshness is inherited from the
 * request/response task that owns the chunk stream, so accepting a late chunk cannot revive a
 * completed task.
 */
export type IWebRpcChunkFrame = {
  readonly kind: typeof WebRpcMessageKind.chunk
  readonly messageId: string
  readonly index: number
  readonly total: number
  readonly data: string
  readonly senderId: string
  readonly targetId: string
  readonly receiverId?: string
}
export type IWebRpcRequest = {
  readonly kind: typeof WebRpcMessageKind.request
  readonly version: string
  readonly taskId: string
  readonly senderId: string
  readonly targetId: string
  readonly receiverId?: string
  readonly method: string
  readonly data: unknown
  readonly dispatchOnly?: boolean
  readonly sentAt: number
}
export type IWebRpcResponse = {
  readonly kind: typeof WebRpcMessageKind.response
  readonly version: string
  readonly taskId: string
  readonly senderId: string
  readonly targetId: string
  readonly receiverId?: string
  readonly method: string
  readonly ok: boolean
  readonly data?: unknown
  readonly message?: string
  readonly code?: string
  /** Sanitized public error graph; omitted for unexpected internal failures. */
  readonly serializedError?: ISerializedError
  readonly sentAt: number
}
export type IWebRpcEnvelope =
  | IWebRpcRequest
  | IWebRpcResponse
  | IWebRpcDiscoveryQuery
  | IWebRpcDiscoveryResponse
  | {
      readonly kind: typeof WebRpcMessageKind.variation
      readonly variation: IWebRpcVariation
      readonly taskId: string
      readonly senderId: string
      readonly targetId: string
      readonly receiverId?: string
      readonly sentAt: number
    }
  | IWebRpcChunkFrame
import { safeRead } from './internal/safe-value.js'

/** Reads and freezes one canonical wire snapshot before protocol routing. */
export function normalizeWebRpcEnvelope(value: unknown): IWebRpcEnvelope | undefined {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  const kind = safeRead<unknown>(value, 'kind')
  if (kind === WebRpcMessageKind.discoveryQuery) {
    const taskId = safeRead<unknown>(value, 'taskId')
    const senderId = safeRead<unknown>(value, 'senderId')
    const targetId = safeRead<unknown>(value, 'targetId')
    const sentAt = safeRead<unknown>(value, 'sentAt')
    if (
      typeof taskId !== 'string' ||
      typeof senderId !== 'string' ||
      typeof targetId !== 'string' ||
      !Number.isSafeInteger(sentAt) ||
      (sentAt as number) < 0
    )
      return undefined
    const manual = safeRead<unknown>(value, 'manual')
    if (manual !== undefined && typeof manual !== 'boolean') return undefined
    return Object.freeze({
      kind,
      taskId,
      senderId,
      targetId,
      sentAt: sentAt as number,
      data: safeRead(value, 'data'),
      ...(manual === true ? { manual } : {})
    })
  }
  if (kind === WebRpcMessageKind.discoveryResponse) {
    const taskId = safeRead<unknown>(value, 'taskId')
    const senderId = safeRead<unknown>(value, 'senderId')
    const targetId = safeRead<unknown>(value, 'targetId')
    const resolvedTargetId = safeRead<unknown>(value, 'resolvedTargetId')
    const sentAt = safeRead<unknown>(value, 'sentAt')
    const platform = safeRead<unknown>(value, 'platform')
    const receiverId = safeRead<unknown>(value, 'receiverId')
    const manual = safeRead<unknown>(value, 'manual')
    const accepted = safeRead<unknown>(value, 'accepted')
    const message = safeRead<unknown>(value, 'message')
    const operation = safeRead<unknown>(value, 'operation')
    if (
      typeof taskId !== 'string' ||
      typeof senderId !== 'string' ||
      typeof targetId !== 'string' ||
      typeof resolvedTargetId !== 'string' ||
      !Number.isSafeInteger(sentAt) ||
      (sentAt as number) < 0 ||
      (platform !== undefined && typeof platform !== 'string') ||
      (receiverId !== undefined && typeof receiverId !== 'string') ||
      (manual !== undefined && typeof manual !== 'boolean') ||
      (accepted !== undefined && typeof accepted !== 'boolean') ||
      (message !== undefined && typeof message !== 'string') ||
      (operation !== undefined && operation !== 'unregister')
    )
      return undefined
    return Object.freeze({
      kind,
      taskId,
      senderId,
      targetId,
      resolvedTargetId,
      sentAt,
      ...(platform === undefined ? {} : { platform }),
      data: safeRead(value, 'data'),
      ...(receiverId === undefined ? {} : { receiverId }),
      ...(manual === true ? { manual } : {}),
      ...(accepted === undefined ? {} : { accepted }),
      ...(message === undefined ? {} : { message }),
      ...(operation === undefined ? {} : { operation })
    }) as IWebRpcDiscoveryResponse
  }
  if (kind === WebRpcMessageKind.request) {
    const version = safeRead<unknown>(value, 'version')
    const taskId = safeRead<unknown>(value, 'taskId')
    const senderId = safeRead<unknown>(value, 'senderId')
    const targetId = safeRead<unknown>(value, 'targetId')
    const receiverId = safeRead<unknown>(value, 'receiverId')
    const method = safeRead<unknown>(value, 'method')
    const sentAt = safeRead<unknown>(value, 'sentAt')
    const data = safeRead<unknown>(value, 'data')
    const dispatchOnly = safeRead<unknown>(value, 'dispatchOnly')
    if (
      typeof version !== 'string' ||
      typeof taskId !== 'string' ||
      typeof senderId !== 'string' ||
      typeof targetId !== 'string' ||
      typeof method !== 'string' ||
      !Number.isSafeInteger(sentAt) ||
      (sentAt as number) < 0 ||
      (dispatchOnly !== undefined && typeof dispatchOnly !== 'boolean') ||
      (receiverId !== undefined && typeof receiverId !== 'string')
    )
      return undefined
    return Object.freeze({
      kind,
      version,
      taskId,
      senderId,
      targetId,
      method,
      data,
      ...(dispatchOnly === undefined ? {} : { dispatchOnly }),
      sentAt,
      ...(receiverId === undefined ? {} : { receiverId })
    }) as IWebRpcRequest
  }
  if (kind === WebRpcMessageKind.response) {
    const version = safeRead<unknown>(value, 'version')
    const taskId = safeRead<unknown>(value, 'taskId')
    const senderId = safeRead<unknown>(value, 'senderId')
    const targetId = safeRead<unknown>(value, 'targetId')
    const method = safeRead<unknown>(value, 'method')
    const ok = safeRead<unknown>(value, 'ok')
    const sentAt = safeRead<unknown>(value, 'sentAt')
    const message = safeRead<unknown>(value, 'message')
    const code = safeRead<unknown>(value, 'code')
    const receiverId = safeRead<unknown>(value, 'receiverId')
    const serializedError = safeRead<unknown>(value, 'serializedError')
    if (
      typeof version !== 'string' ||
      typeof taskId !== 'string' ||
      typeof senderId !== 'string' ||
      typeof targetId !== 'string' ||
      typeof method !== 'string' ||
      typeof ok !== 'boolean' ||
      (message !== undefined && typeof message !== 'string') ||
      (code !== undefined && typeof code !== 'string') ||
      (receiverId !== undefined && typeof receiverId !== 'string') ||
      (serializedError !== undefined &&
        (!serializedError || typeof serializedError !== 'object')) ||
      !Number.isSafeInteger(sentAt) ||
      (sentAt as number) < 0
    )
      return undefined
    return Object.freeze({
      kind,
      version,
      taskId,
      senderId,
      targetId,
      method,
      ok,
      data: safeRead(value, 'data'),
      message,
      code,
      sentAt,
      ...(receiverId === undefined ? {} : { receiverId }),
      ...(serializedError === undefined
        ? {}
        : { serializedError: serializedError as ISerializedError })
    }) as IWebRpcResponse
  }
  if (kind === WebRpcMessageKind.variation) {
    const variation = safeRead<unknown>(value, 'variation')
    const taskId = safeRead<unknown>(value, 'taskId')
    const senderId = safeRead<unknown>(value, 'senderId')
    const targetId = safeRead<unknown>(value, 'targetId')
    const receiverId = safeRead<unknown>(value, 'receiverId')
    const sentAt = safeRead<unknown>(value, 'sentAt')
    if (
      (variation !== WebRpcVariation.abort &&
        variation !== WebRpcVariation.ping &&
        variation !== WebRpcVariation.pong) ||
      typeof senderId !== 'string' ||
      typeof targetId !== 'string' ||
      typeof taskId !== 'string' ||
      !Number.isSafeInteger(sentAt) ||
      (sentAt as number) < 0 ||
      (receiverId !== undefined && typeof receiverId !== 'string')
    )
      return undefined
    return Object.freeze({
      kind,
      variation: variation as IWebRpcVariation,
      taskId,
      senderId,
      targetId,
      ...(receiverId === undefined ? {} : { receiverId }),
      sentAt: sentAt as number
    })
  }
  if (kind === WebRpcMessageKind.chunk) {
    const messageId = safeRead<unknown>(value, 'messageId')
    const index = safeRead<unknown>(value, 'index')
    const total = safeRead<unknown>(value, 'total')
    const data = safeRead<unknown>(value, 'data')
    const senderId = safeRead<unknown>(value, 'senderId')
    const targetId = safeRead<unknown>(value, 'targetId')
    const receiverId = safeRead<unknown>(value, 'receiverId')
    if (
      typeof messageId !== 'string' ||
      !Number.isSafeInteger(index) ||
      !Number.isSafeInteger(total) ||
      (index as number) < 0 ||
      (total as number) <= 0 ||
      (index as number) >= (total as number) ||
      typeof data !== 'string' ||
      typeof senderId !== 'string' ||
      typeof targetId !== 'string' ||
      (receiverId !== undefined && typeof receiverId !== 'string')
    )
      return undefined
    return Object.freeze({
      kind,
      messageId,
      index: index as number,
      total: total as number,
      data,
      senderId,
      targetId,
      ...(receiverId === undefined ? {} : { receiverId })
    })
  }
  return undefined
}
const isWebRpcEnvelopeUnsafe = (value: unknown): value is IWebRpcEnvelope => {
  const normalized = normalizeWebRpcEnvelope(value)
  if (!normalized) return false
  const record = normalized as unknown as Record<string, unknown>
  const kind = record.kind
  if (kind === WebRpcMessageKind.discoveryQuery)
    return (
      typeof record.taskId === 'string' &&
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string'
    )
  if (kind === WebRpcMessageKind.discoveryResponse)
    return (
      typeof record.taskId === 'string' &&
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string' &&
      typeof record.resolvedTargetId === 'string'
    )
  if (kind === WebRpcMessageKind.request)
    return (
      typeof record.version === 'string' &&
      typeof record.taskId === 'string' &&
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string' &&
      typeof record.method === 'string' &&
      Number.isSafeInteger(record.sentAt) &&
      'data' in record
    )
  if (kind === WebRpcMessageKind.response)
    return (
      typeof record.version === 'string' &&
      typeof record.taskId === 'string' &&
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string' &&
      typeof record.method === 'string' &&
      typeof record.ok === 'boolean' &&
      Number.isSafeInteger(record.sentAt)
    )
  if (kind === WebRpcMessageKind.variation)
    return (
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string' &&
      ['abort', 'ping', 'pong'].includes(record.variation as string)
    )
  if (kind === WebRpcMessageKind.chunk)
    return (
      typeof record.messageId === 'string' &&
      Number.isSafeInteger(record.index) &&
      Number.isSafeInteger(record.total) &&
      typeof record.data === 'string' &&
      typeof record.senderId === 'string' &&
      typeof record.targetId === 'string'
    )
  return false
}
/**
 * Re-validates a normalized envelope's shape and returns a boolean. Internal-only (not exported
 * from index.ts): the TOCTOU risk this shape would have as a public "check then re-read raw" guard
 * does not apply here because nothing outside this package can reach it — see WR8 in
 * docs/review/2026-08-13-plugin-host-logger-web-rpc-hardening.sdd.md, round 2.
 */
export const isWebRpcEnvelope = (value: unknown): value is IWebRpcEnvelope => {
  try {
    return isWebRpcEnvelopeUnsafe(value)
  } catch {
    return false
  }
}

/** Validates one method or target identifier before it enters an endpoint-owned registry. */
export const assertMethod = (method: string): string => {
  if (typeof method !== 'string' || method.length === 0)
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.methodInvalid)
  return method
}
