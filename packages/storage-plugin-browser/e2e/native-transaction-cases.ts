/** These browser cases distinguish actual native activity from same-task microtask continuation. */
export const NativeTransactionActivity = {
  /** An operation after a timer rejects and its original failure escapes the callback. */
  timerWrite: 'timerWrite',
  /** Catching the same inactive operation cannot make the original transaction commit. */
  caughtTimerWrite: 'caughtTimerWrite',
  /** Returning after a timer still requires the same native activity check before commit. */
  timerReturn: 'timerReturn',
  /** A same-task microtask is the successful native activity control. */
  microtask: 'microtask'
} as const

/** Case names and values intentionally share one finite test input domain. */
export type NativeTransactionActivity = keyof typeof NativeTransactionActivity
