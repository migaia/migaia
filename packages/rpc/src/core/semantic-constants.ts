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

/** Local admission decisions; these values never become protocol errors or wire fields. */
export const RpcProviderRejectionReason = {
  /** Existing global or verified-peer concurrency capacity refused a provider lease. */
  concurrency: 'concurrency',
  /** The endpoint's bounded request replay ledger could not retain another identity. */
  replayLedgerFull: 'replayLedgerFull',
  /** The previously verified peer binding expired before provider execution. */
  bindingExpired: 'bindingExpired'
} as const

/** One canonical local rejection domain, shared by runtime and typed notification consumers. */
export type RpcProviderRejectionReason = keyof typeof RpcProviderRejectionReason
