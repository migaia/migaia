/** Owns the utils signal-admission literals consumed by structural subscription helpers. */
import type { IAbortSignalAdmission, IAbortSignalRejection } from '@migaia/utils/promise'

/**
 * The rejected branch of utils IAbortSignalAdmission; subscribeUntil retains boundary-error
 * ownership.
 */
export const INVALID_SIGNAL_ADMISSION = 'invalid' satisfies IAbortSignalAdmission['kind']

/**
 * Utils IAbortSignalRejection distinguishes an original getter failure whose Error identity must
 * survive.
 */
export const ABORTED_SIGNAL_GETTER_FAILURE = 'aborted-threw' satisfies IAbortSignalRejection

/**
 * IAbortSignal.reason is captured once after cancellation, separately from admission's aborted
 * read.
 */
export const SIGNAL_REASON_PROPERTY = 'reason' satisfies keyof Extract<
  IAbortSignalAdmission,
  { readonly signal: unknown }
>['signal']
