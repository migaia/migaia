import {
  RpcRouteProfile,
  RpcRouteType,
  type IRpcRouteHeader,
  type IRpcRequestEnvelope,
  type IRpcResponseSuccess,
  type IRpcResponseFailure,
  type IRpcDiscoveryEnvelope,
  type IRpcVariationEnvelope
} from '../../src/contract/index.js'

/** Supply the smallest valid route for each envelope kind before a test changes one field. */
export function minimalRpcRoute(
  type: RpcRouteType,
  extra: Partial<IRpcRouteHeader> = {}
): IRpcRouteHeader {
  return {
    profile: RpcRouteProfile,
    type,
    applicationVersion: '1.0',
    senderId: 'sender',
    targetId: 'target',
    sentAt: 0,
    ...(type === RpcRouteType.response ? { method: 'm' } : {}),
    ...(type === RpcRouteType.discoveryResponse ? { resolvedTargetId: 'target' } : {}),
    ...(type === RpcRouteType.variation ? { variation: 'ping' } : {}),
    ...extra
  }
}

/** A request fixture carries contract-owned routing without an application payload. */
export function minimalRequestEnvelope(): IRpcRequestEnvelope {
  return {
    kind: 'request',
    id: 'request-1',
    method: 'm',
    data: { route: minimalRpcRoute(RpcRouteType.request) }
  }
}

/** A successful response fixture uses the mandatory response method route field. */
export function minimalResponseSuccessEnvelope(): IRpcResponseSuccess {
  return {
    kind: 'response',
    ok: true,
    id: 'request-1',
    data: { route: minimalRpcRoute(RpcRouteType.response) }
  }
}

/** A failed response fixture leaves the optional serialized error absent. */
export function minimalResponseFailureEnvelope(): IRpcResponseFailure {
  return {
    kind: 'response',
    ok: false,
    id: 'request-1',
    code: 'FAILED',
    message: 'failed',
    data: { route: minimalRpcRoute(RpcRouteType.response) }
  }
}

/** A discovery fixture uses the query route form; responses add resolvedTargetId. */
export function minimalDiscoveryEnvelope(): IRpcDiscoveryEnvelope {
  return {
    kind: 'discovery',
    id: 'request-1',
    version: '1',
    acceptVersions: ['1'],
    data: { route: minimalRpcRoute(RpcRouteType.discoveryQuery) }
  }
}

/** A variation fixture leaves its subtype payload absent for owner-specific decoding. */
export function minimalVariationEnvelope(): IRpcVariationEnvelope {
  return {
    kind: 'variation',
    id: 'request-1',
    data: { route: minimalRpcRoute(RpcRouteType.variation) }
  }
}
