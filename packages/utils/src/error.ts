/** Public error entry aggregates the native primitives, identified errors and bounded wire codec. */
export {
  UTILS_SOURCE,
  UtilsError,
  UtilsAbortError,
  UtilsTimeoutError,
  UtilsErrorCode,
  tryReadProperty,
  isNativeErrorValue,
  attachErrorIdentity,
  attachSecondaryErrors,
  safeErrorReason,
  toError,
  walkErrorCauses,
  combineErrors,
  isUtilsError,
  isUtilsAbortError,
  isUtilsTimeoutError
} from './internal/error-primitives.ts'
export type {
  IPropertyRead,
  IErrorIdentity,
  IErrorIdentityHooks,
  IUtilsErrorCode
} from './internal/error-primitives.ts'

export { IdentifyError } from './identify-error.ts'
export type {
  IErrorIdentityComparison,
  IErrorIdentityMatch,
  IIdentifiedError,
  IIdentifyErrorCases,
  IIdentifyErrorFactory,
  IIdentifyErrorFactoryOptions,
  IIdentifyErrorIdentity,
  IIdentifyErrorOptions,
  IMutableErrorIdentity
} from './identify-error.ts'

export {
  serializeErrorChain,
  deserializeErrorChain,
  normalizeSerializedErrorChain,
  reachErrorChain,
  sanitizeErrorText,
  countErrorDataText
} from './error-chain.ts'
export type {
  IErrorChainStrategy,
  ISerializedErrorChain,
  IErrorChainData
} from './error-chain-types.ts'
