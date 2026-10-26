/** Stable stream-only diagnostics remain outside the root endpoint graph. */
export const RpcStreamErrorText = {
  /** Unknown frame delivery requires the caller to create a fresh stream. */
  resultUnknown: 'stream result unknown',
  /** Providers must return an iterable object rather than a scalar value. */
  iterableInvalid: 'stream provider must return an iterable',
  /** Finish-without-items is legal only for a call opened with before-start cancellation. */
  finishInvalid: 'stream finish requires before-start cancellation',
  /** A producer yielded data beyond the portable per-value budget. */
  valueInvalid: 'stream value invalid',
  /** A local throw remains first when cleanup also fails. */
  cleanupFailed: 'stream cleanup failed'
} as const
