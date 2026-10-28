/** HTTP owns transport and wire failures independently of host delivery policy. */
export const ERROR_SOURCE = 'logging.http'

/** Codes preserve the moved HTTP failure scenarios and their original cause chains. */
export const LogHttpErrorCode = {
  /** No injected or host fetch capability exists; inject a fetcher before creating this output. */
  transportUnavailable: 'TRANSPORT_UNAVAILABLE',
  /** JSON projection failed before any POST; inspect the original payload through cause. */
  serializeFailed: 'SERIALIZE_FAILED',
  /** A POST rejected or returned a failed status; retry only according to the transport hint. */
  deliveryFailed: 'DELIVERY_FAILED',
  /** Retry-After's admitted bound is negative or nonfinite; correct the factory option. */
  invalidOption: 'INVALID_OPTION'
} as const

/** The domain and code together identify a stable HTTP package failure. */
export type ILogHttpErrorCode = (typeof LogHttpErrorCode)[keyof typeof LogHttpErrorCode]
