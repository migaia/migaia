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

/** Admitted local identity and refusal reason are shared by auth replay and provider limits. */
export type IRpcProviderRejection = Readonly<{
  verifiedPeerKey: string
  controllerKey: string
  method: string
  reason: RpcProviderRejectionReason
}>
