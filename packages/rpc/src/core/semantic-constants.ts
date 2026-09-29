/**
 * Compatibility discriminants used by the legacy endpoint adapters while their readers are routed
 * through the canonical contract composition boundary.
 *
 * These values remain stable for existing WebRPC peers; new contract endpoints use the
 * runtime-neutral `@migaia/rpc/contract` envelope directly.
 */
export const RpcMessageKind = {
  discoveryQuery: 'discovery-query',
  discoveryResponse: 'discovery-response',
  request: 'request',
  response: 'response',
  variation: 'variation',
  chunk: 'chunk'
} as const

/** Structured failure kind carried by schema validation diagnostics. */
export const RpcContractFailureKind = { schemaValidation: 'schema-validation' } as const

/** Test-only endpoint lifecycle snapshot phases. */
export const RpcDebugPhase = { active: 'active', disposed: 'disposed' } as const

/** Legacy message discriminant value used by adapter internals. */
export type IRpcMessageKind = (typeof RpcMessageKind)[keyof typeof RpcMessageKind]
