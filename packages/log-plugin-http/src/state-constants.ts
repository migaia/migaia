/** The HTTP output registration is stable across installation and removal. */
export const HTTP_PLUGIN_NAME = 'http'

/** Request constants preserve the existing POST wire contract. */
export const HttpRequest = {
  /** Every delivery is one POST attempt; host features own repetition. */
  method: 'POST',
  /** The old content type remains the default, with caller headers applied afterward. */
  contentType: 'Content-Type',
  /** Every body is the established JSON entries envelope. */
  json: 'application/json',
  /** A configured bearer token overrides a caller-supplied authorization header. */
  authorization: 'Authorization',
  /** Server-advised delay is read only for a retryable failed response. */
  retryAfter: 'Retry-After'
} as const
