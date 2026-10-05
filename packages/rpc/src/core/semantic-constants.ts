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
  /** Waiting plus running ordered work exhausted the original provider quota. */
  orderedQueueFull: 'orderedQueueFull',
  /** The complete group could not reserve every member's original provider lease. */
  groupConcurrency: 'groupConcurrency',
  /** The complete group could not reserve every member's original replay entry. */
  groupReplayFull: 'groupReplayFull',
  /** Existing global or verified-peer concurrency capacity refused a provider lease. */
  concurrency: 'concurrency',
  /** The endpoint's bounded request replay ledger could not retain another identity. */
  replayLedgerFull: 'replayLedgerFull',
  /** The caller's active identifiers and retained tombstones consumed its replay capacity. */
  outboundReplayFull: 'outboundReplayFull',
  /** The previously verified peer binding expired before provider execution. */
  bindingExpired: 'bindingExpired'
} as const

/** One canonical local rejection domain, shared by runtime and typed notification consumers. */
export type RpcProviderRejectionReason = keyof typeof RpcProviderRejectionReason

/** Local replay-capacity namespaces; diagnostic detail never carries request identities. */
export const RpcReplayCapacityNamespace = {
  /** Accepted inbound request tombstones, including the verified-peer quota. */
  inbound: 'inbound',
  /** Active outbound identifiers and settled request tombstones. */
  outbound: 'outbound'
} as const

/** One shared local diagnostic namespace domain. */
export type RpcReplayCapacityNamespace = keyof typeof RpcReplayCapacityNamespace

/** One endpoint reports replay exhaustion at most once per second across both namespaces. */
export const RPC_REPLAY_CAPACITY_REPORT_INTERVAL_MS = 1_000
