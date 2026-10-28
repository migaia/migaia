/** File delivery owns capability admission and append/rotation errors. */
export const ERROR_SOURCE = 'logging.file'

/** Every value preserves the moved file plugin scenario under its new owner domain. */
export const LogFileErrorCode = {
  /** No injected or supported native writer exists; provide an explicit append capability. */
  fileSinkUnavailable: 'FILE_SINK_UNAVAILABLE',
  /** Append or rotation failed; cause retains the exact writer failure. */
  deliveryFailed: 'DELIVERY_FAILED',
  /** Path or rotation configuration is invalid; fix options before installing the output. */
  invalidOption: 'INVALID_OPTION'
} as const

/** Stable file failure values are interpreted with their owning domain. */
export type ILogFileErrorCode = (typeof LogFileErrorCode)[keyof typeof LogFileErrorCode]
