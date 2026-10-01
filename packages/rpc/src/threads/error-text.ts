/** Stable configuration diagnostics shared by facade and launcher admission. */
export const ThreadErrorText = {
  invalidData: 'Thread spec.data must be a portable RPC value',
  invalidEntry: 'Thread spec.entry must be an absolute runtime entry',
  bootstrapFailed: 'Thread data bootstrap was not acknowledged',
  invalidServe: 'Thread serve configuration is invalid'
} as const
