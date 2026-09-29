/** Stable stream-only diagnostics remain outside the root endpoint graph. */
export const RpcStreamErrorText = {
  /** Unknown frame delivery requires the caller to create a fresh stream. */
  resultUnknown: 'stream result unknown',
  /** A peer lacking stream@1 cannot exchange stream frames. */
  capabilityMissing: 'stream capability unavailable',
  /** Providers must return an iterable object rather than a scalar value. */
  iterableInvalid: 'stream provider must return an iterable',
  /** A producer cannot exceed the peer's admitted active-stream budget. */
  peerOverloaded: 'stream peer overloaded',
  /** A producer yielded data beyond the portable per-value budget. */
  valueInvalid: 'stream value invalid',
  /** A local throw remains first when cleanup also fails. */
  cleanupFailed: 'stream cleanup failed'
} as const
