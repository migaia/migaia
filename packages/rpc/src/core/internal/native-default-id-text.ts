/** Canonical private allocator text enforces replay-window r12 BC2 without new public codes. */
export const NativeDefaultIdText = {
  /** Resource key names the endpoint's retirement callback, not another physical owner. */
  terminalSubscription: 'native replay terminal subscription',
  /** Provider retirement owns a separate cleanup registration from outbound pending settlement. */
  providerTerminalSubscription: 'provider native replay retirement',
  /** Construction fails with the original entropy error as cause; no L claim can survive rollback. */
  nonceFailed: 'Endpoint replay nonce generation failed',
  /** The last uint64 allocation succeeds; the next must report and reject rather than reuse an ID. */
  counterExhausted: 'Endpoint replay counter is exhausted'
} as const
