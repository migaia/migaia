import type { IRpcPortableValue } from '@migaia/rpc-contract'
import { WebRpcVariation } from '../semantic-constants.js'
import { safeRead } from './safe-value.js'

/** Stable discriminator for the WebRPC-owned route profile carried by canonical RPC envelopes. */
export const WebRpcRoutingProfile = 'web-rpc.route.v1'

/** Route tags selected by WebRPC after the generic RPC envelope has normalized. */
export const WebRpcRoutingType = {
  request: 'request',
  response: 'response',
  discoveryQuery: 'discovery-query',
  discoveryResponse: 'discovery-response',
  variation: 'variation'
} as const

/** One validated WebRPC routing record. Its payload stays owned by the caller's RPC contract. */
export type IWebRpcRoutingData = {
  readonly webRpc: {
    readonly profile: typeof WebRpcRoutingProfile
    readonly type: (typeof WebRpcRoutingType)[keyof typeof WebRpcRoutingType]
    readonly applicationVersion: string
    readonly senderId: string
    readonly targetId: string
    readonly receiverId?: string
    readonly sentAt: number
    readonly dispatchOnly?: boolean
    readonly method?: string
    readonly manual?: boolean
    readonly resolvedTargetId?: string
    readonly platform?: string
    readonly accepted?: boolean
    readonly message?: string
    readonly operation?: 'unregister'
    readonly variation?: (typeof WebRpcVariation)[keyof typeof WebRpcVariation]
  }
  readonly payload?: IRpcPortableValue
}

/** Reads one untrusted canonical data value once and returns only a legal route-tag field set. */
export function normalizeWebRpcRoutingData(value: unknown): IWebRpcRoutingData | undefined {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  try {
    if (Object.keys(value).some((key) => key !== 'webRpc' && key !== 'payload')) return undefined
  } catch {
    return undefined
  }
  const webRpc = safeRead<unknown>(value, 'webRpc')
  if (!webRpc || (typeof webRpc !== 'object' && typeof webRpc !== 'function')) return undefined
  try {
    const allowed = new Set([
      'profile',
      'type',
      'applicationVersion',
      'senderId',
      'targetId',
      'receiverId',
      'sentAt',
      'dispatchOnly',
      'method',
      'manual',
      'resolvedTargetId',
      'platform',
      'accepted',
      'message',
      'operation',
      'variation'
    ])
    if (Object.keys(webRpc).some((key) => !allowed.has(key))) return undefined
  } catch {
    return undefined
  }
  const profile = safeRead<unknown>(webRpc, 'profile')
  const type = safeRead<unknown>(webRpc, 'type')
  const applicationVersion = safeRead<unknown>(webRpc, 'applicationVersion')
  const senderId = safeRead<unknown>(webRpc, 'senderId')
  const targetId = safeRead<unknown>(webRpc, 'targetId')
  const sentAt = safeRead<unknown>(webRpc, 'sentAt')
  const payload = safeRead<unknown>(value, 'payload')
  if (
    profile !== WebRpcRoutingProfile ||
    !Object.values(WebRpcRoutingType).includes(type as never) ||
    typeof applicationVersion !== 'string' ||
    typeof senderId !== 'string' ||
    typeof targetId !== 'string' ||
    !Number.isSafeInteger(sentAt) ||
    (sentAt as number) < 0
  )
    return undefined
  const optional = readOptionalRouteFields(webRpc)
  if (!optional || !isLegalRouteFields(type, optional)) return undefined
  return Object.freeze({
    webRpc: Object.freeze({
      profile: WebRpcRoutingProfile,
      type: type as IWebRpcRoutingData['webRpc']['type'],
      applicationVersion,
      senderId,
      targetId,
      sentAt: sentAt as number,
      ...optional
    }),
    ...(payload === undefined ? {} : { payload: payload as IRpcPortableValue })
  })
}

/** Snapshots optional route fields once before their tag-specific legality check. */
function readOptionalRouteFields(value: object): Record<string, unknown> | undefined {
  const fields = [
    'receiverId',
    'dispatchOnly',
    'method',
    'manual',
    'resolvedTargetId',
    'platform',
    'accepted',
    'message',
    'operation',
    'variation'
  ] as const
  const result: Record<string, unknown> = {}
  for (const field of fields) {
    const current = safeRead<unknown>(value, field)
    if (current !== undefined) result[field] = current
  }
  if (
    (result.receiverId !== undefined && typeof result.receiverId !== 'string') ||
    (result.dispatchOnly !== undefined && typeof result.dispatchOnly !== 'boolean') ||
    (result.method !== undefined && typeof result.method !== 'string') ||
    (result.manual !== undefined && typeof result.manual !== 'boolean') ||
    (result.resolvedTargetId !== undefined && typeof result.resolvedTargetId !== 'string') ||
    (result.platform !== undefined && typeof result.platform !== 'string') ||
    (result.accepted !== undefined && typeof result.accepted !== 'boolean') ||
    (result.message !== undefined && typeof result.message !== 'string') ||
    (result.operation !== undefined && result.operation !== 'unregister') ||
    (result.variation !== undefined &&
      !Object.values(WebRpcVariation).includes(result.variation as never))
  )
    return undefined
  return result
}

/** Ensures a route tag cannot smuggle metadata owned by another WebRPC operation. */
function isLegalRouteFields(type: unknown, fields: Record<string, unknown>): boolean {
  const legal: Readonly<Record<string, readonly string[]>> = {
    request: ['receiverId', 'dispatchOnly'],
    response: ['receiverId', 'method', 'message'],
    'discovery-query': ['manual'],
    'discovery-response': [
      'receiverId',
      'manual',
      'resolvedTargetId',
      'platform',
      'accepted',
      'message',
      'operation'
    ],
    variation: ['receiverId', 'variation']
  }
  const allowed = legal[type as string]
  if (!allowed || Object.keys(fields).some((field) => !allowed.includes(field))) return false
  if (type === WebRpcRoutingType.response) return typeof fields.method === 'string'
  if (type === WebRpcRoutingType.discoveryResponse)
    return typeof fields.resolvedTargetId === 'string'
  if (type === WebRpcRoutingType.variation) return typeof fields.variation === 'string'
  return true
}
