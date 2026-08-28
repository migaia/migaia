/** Stable semantic codes emitted by the utils package boundary. */
export const UtilsErrorCode = {
  invalidArgument: 'INVALID_ARGUMENT',
  nonErrorValue: 'NON_ERROR_VALUE',
  envUnsupported: 'ENV_UNSUPPORTED',
  aborted: 'ABORTED',
  deadlineExceeded: 'DEADLINE_EXCEEDED',
  schedulerRunaway: 'SCHEDULER_RUNAWAY',
  errorIdentityConflict: 'ERROR_IDENTITY_CONFLICT',
  cloneUnsupported: 'CLONE_UNSUPPORTED',
  invalidEncoding: 'INVALID_ENCODING',
  limiterClosed: 'LIMITER_CLOSED',
  reentrantCall: 'REENTRANT_CALL',
  configUnsupported: 'CONFIG_UNSUPPORTED',
  configReadonly: 'CONFIG_READONLY',
  configConflict: 'CONFIG_CONFLICT',
  configLimitExceeded: 'CONFIG_LIMIT_EXCEEDED',
  configPathInvalid: 'CONFIG_PATH_INVALID',
  /** The supplied string or tuple cannot safely identify an object path. */
  objectPathInvalid: 'OBJECT_PATH_INVALID',
  /** Template syntax, placeholder boundaries, or a resolved value cannot be formatted safely. */
  formatInvalid: 'FORMAT_INVALID',
  /** Strict template formatting could not resolve one requested placeholder path. */
  formatValueMissing: 'FORMAT_VALUE_MISSING',
  /** Intl rejected a locale, number-format option, currency, or numeric value. */
  numberFormatInvalid: 'NUMBER_FORMAT_INVALID'
} as const

export type IUtilsErrorCode = (typeof UtilsErrorCode)[keyof typeof UtilsErrorCode]
