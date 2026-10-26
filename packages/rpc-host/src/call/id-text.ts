/** Canonical allocator text preserves replay-window diagnostics while old operation owners retire. */
export const NativeDefaultIdText = {
  /** Construction fails with the original entropy error as cause; no L claim can survive rollback. */
  nonceFailed: 'Endpoint replay nonce generation failed',
  /** The last uint64 allocation succeeds; the next must report and reject rather than reuse an ID. */
  counterExhausted: 'Endpoint replay counter is exhausted'
} as const
