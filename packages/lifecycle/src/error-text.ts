/** Stable lifecycle diagnostics shared by scheduler and cancellation boundaries. */
export const LifecycleErrorText = {
  /** Explains that every abort listener ran but at least one listener failed. */
  abortListenerDispatchFailed: '[lifecycle] abort listener dispatch failed',
  /** Fallback message for a provisional registration/cleanup wrapper around a non-Error throw. */
  provisionalCleanupFailed: '[lifecycle] provisional cleanup failed',
  /** Stable finalization message for transaction-level failures. */
  disposeTransactionFailed: '[lifecycle] dispose transaction failed',
  /** Stable message for a descriptor that cannot be admitted into a release transaction. */
  disposeDescriptorInvalid: '[lifecycle] release descriptor admission failed',
  /** Fallback message for a queue timeout wrapper around a non-Error primary. */
  mutationAdmissionTimedOut: '[lifecycle] mutation admission timed out',
  /** Explains that generation cancellation had multiple cleanup failures. */
  generationCancellationFailed: '[lifecycle] generation cancellation failed',
  /** Explains that a scheduled task's cancel accessor threw during admission. */
  schedulerTaskCancelGetterFailed: '[lifecycle] scheduler task cancel getter failed',
  /** Explains that a scheduler returned a task without the required cancel function. */
  schedulerTaskInvalid:
    '[lifecycle] scheduler.schedule must return an object with a cancel() function',
  /** Explains that reading a scheduler's methods failed at an injection boundary. */
  schedulerAccessorFailed: '[lifecycle] scheduler accessor failed',
  /** Explains that an injected value is not a valid lifecycle scheduler. */
  schedulerInvalid: '[lifecycle] scheduler must provide now() and schedule() functions',
  /** Stable message for scheduler values whose runtime type is not numeric. */
  schedulerNumberType: '[lifecycle] scheduler time value must be a number',
  /** Stable message for scheduler values outside the finite numeric domain. */
  schedulerNumberRange: '[lifecycle] scheduler time value must be finite',
  /** Stable message for scheduler delays that are finite but negative. */
  schedulerDelayRange: '[lifecycle] scheduler delay must be non-negative',
  /** Stable message for scheduler arithmetic whose finite operands produce an infinite target. */
  schedulerTimeOverflow: '[lifecycle] scheduler time arithmetic must remain finite',
  /** Explains that a generation timeout option could not be read at its admission boundary. */
  generationTimeoutAccessorFailed: '[lifecycle] generation timeout option getter failed'
} as const;

export type ILifecycleErrorText = (typeof LifecycleErrorText)[keyof typeof LifecycleErrorText];
