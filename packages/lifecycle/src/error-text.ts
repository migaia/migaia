/** Stable lifecycle diagnostics shared by scheduler and cancellation boundaries. */
export const LifecycleErrorText = {
  /** Fallback for a delay admission or cleanup failure that cannot retain native Error identity. */
  delayFailed: '[lifecycle] abortable delay failed',
  /** Rejects a malformed optional wait-cleanup channel before any resource admission. */
  waitCleanupReporterInvalid: '[lifecycle] wait cleanup reporter must be a function',
  /** Fallback message for a provisional registration/cleanup wrapper around a non-Error throw. */
  provisionalCleanupFailed: '[lifecycle] provisional cleanup failed',
  /** Stable finalization message for transaction-level failures. */
  disposeTransactionFailed: '[lifecycle] dispose transaction failed',
  /** Explains that a disposer attempted to join the scope disposal that is waiting for it. */
  scopeReentrantDispose: '[lifecycle] cannot join the same scope disposal from its disposer',
  /** Stable message for a descriptor that cannot be admitted into a release transaction. */
  disposeDescriptorInvalid: '[lifecycle] release descriptor admission failed',
  /** Shared cleanup observation admission requires the error array used by the merge helper. */
  cleanupResultInvalid: '[lifecycle] cleanup result must provide a cleanupErrors array',
  /**
   * Diagnostic reported through `context.report` when a synchronous `graceful` returned after its
   * budget. The release still counts as successful and `force` does not run; consumed by
   * dispose-transaction's graceful race.
   */
  syncGracefulOverBudget: '[lifecycle] synchronous graceful completed after its deadline',
  /** Fallback message for a queue timeout wrapper around a non-Error primary. */
  mutationAdmissionTimedOut: '[lifecycle] mutation admission timed out',
  /** Stable diagnostic for failed generation cancellation or complete timer/parent cleanup. */
  generationCancellationFailed: '[lifecycle] generation cancellation failed',
  /** Explains that a disposal ledger no longer accepts new item callbacks. */
  disposalLedgerClosed: '[lifecycle] disposal ledger is sealed',
  /** Explains that a disposal ledger operation re-entered its active item boundary. */
  disposalLedgerReentrant: '[lifecycle] disposal ledger operation is reentrant',
  /** Explains that the host lacks a usable native AbortController capability. */
  envUnsupported: '[lifecycle] required host capability is unavailable',
  /** Explains that an observed cancellation source lacks its required listener methods. */
  abortSignalInvalid: '[lifecycle] abort signal is invalid',
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
  /**
   * Explains that the `report`/`firstError` error policy was chosen without a `report` callback.
   * Thrown at creation by `createDisposeTransaction`, `createLifecycleScope` and
   * `createSyncLifecycleScope` (X2=a) instead of silently dropping the failures later.
   */
  errorPolicyReporterMissing:
    '[lifecycle] errorPolicy "report" and "firstError" require a report callback',
  /** `signal.reason` message for a generation aborted by a newer `begin()` (GENERATION_SUPERSEDED). */
  generationSupersededReason: '[lifecycle] superseded by a new generation',
  /**
   * `signal.reason` message for a generation whose `timeoutMs` budget elapsed
   * (GENERATION_TIMED_OUT).
   */
  generationTimedOutReason: '[lifecycle] generation timed out',
  /**
   * `signal.reason` message for a lifecycle unit's generation aborted by `dispose()`
   * (GENERATION_DISPOSED).
   */
  unitDisposedReason: '[lifecycle] unit disposed',
  /**
   * `signal.reason` message for a scope's closing signal aborted by `close()`/`dispose()`
   * (SCOPE_CLOSED).
   */
  scopeClosedReason: '[lifecycle] scope closed',
  /** `signal.reason` message for a provisional scope aborted by `rollback()` (PROVISIONAL_SETTLED). */
  provisionalRolledBackReason: '[lifecycle] provisional scope rolled back',
  /** `signal.reason` message for a provisional scope aborted by `commitTo()` (PROVISIONAL_SETTLED). */
  provisionalCommittedReason: '[lifecycle] provisional scope committed',
  /**
   * Explains that `retain()` hit a sealed quiescence key (QUIESCENCE_SEALED); thrown by the
   * quiescence tracker.
   */
  quiescenceSealed: '[lifecycle] cannot retain a sealed quiescence key',
  /**
   * Explains that strict `whenZero()` ran before `seal()` (QUIESCENCE_UNSEALED_WAIT); thrown by the
   * quiescence tracker.
   */
  quiescenceUnsealedWait:
    '[lifecycle] whenZero() requires seal() first — use whenZeroOnce() for a non-exclusive wait',
  /** Explains that a provisional scope was used after commit or rollback (PROVISIONAL_SETTLED). */
  provisionalSettled: '[lifecycle] provisional scope has already committed or rolled back',
  /** Explains that `commitTo()` found its parent closing or terminal (PROVISIONAL_PARENT_CLOSED). */
  provisionalParentClosed: '[lifecycle] commitTo() target is already closing or terminal',
  /** Wrapper message for a `LifecycleUnit` start failure (UNIT_START_FAILED). */
  unitStartFailed: '[lifecycle] start() failed',
  /** Explains that a terminal `LifecycleUnit` refused new work (SCOPE_TERMINAL). */
  unitTerminal: '[lifecycle] unit is terminal',
  /** Explains that a closing `LifecycleUnit` refused new work (SCOPE_CLOSED). */
  unitClosing: '[lifecycle] unit is closing',
  /** Explains that `begin()` ran on a disposed `GenerationController` (GENERATION_DISPOSED). */
  generationDisposed:
    '[lifecycle] cannot begin a new generation on a disposed GenerationController',
  /** Diagnostic carried to `onSuperseded` when `adopt()` sees a stale token (GENERATION_SUPERSEDED). */
  generationSupersededBeforeAdopt:
    '[lifecycle] generation superseded before its result could be adopted',
  /** Diagnostic reported when a graceful phase starts after the shared deadline (DEADLINE_EXCEEDED). */
  sharedDeadlinePassed:
    '[lifecycle] shared deadline already passed before this graceful phase could start',
  /** Diagnostic wrapper reported when a descriptor's `force` fails (RELEASE_FORCE_FAILED). */
  releaseForceFailed: '[lifecycle] force() failed',
  /**
   * Explains that a `syncSafe` callback returned a thenable to `SyncLifecycleScope`
   * (SCOPE_SYNC_VIOLATION).
   */
  syncCallbackReturnedThenable:
    '[lifecycle] a syncSafe descriptor callback returned a thenable — SyncLifecycleScope never awaits',
  /** Explains that a terminal scope refused `own()` (SCOPE_TERMINAL); shared by both scope kinds. */
  scopeTerminal: '[lifecycle] scope is terminal',
  /** Explains that a closing scope refused `own()` (SCOPE_CLOSED); shared by both scope kinds. */
  scopeClosing: '[lifecycle] scope is closing',
  /** Explains that a disposer called its own scope's `own()` (SCOPE_REENTRANT_OWN). */
  scopeReentrantOwn: '[lifecycle] cannot call own() from within this scope’s own dispose()',
  /**
   * Explains that `SyncLifecycleScope.own()` got a descriptor without `syncSafe: true`
   * (SCOPE_SYNC_VIOLATION).
   */
  syncScopeRequiresSyncSafe:
    '[lifecycle] SyncLifecycleScope requires an explicit `syncSafe: true` descriptor',
  /** Explains that `SyncLifecycleScope.own()` got an async owner as resource (SCOPE_SYNC_VIOLATION). */
  syncScopeOwnsAsyncOwner:
    '[lifecycle] SyncLifecycleScope cannot own a LifecycleScope or ProvisionalScope instance',
  /** Aggregate message for multiple `SyncLifecycleScope` release failures (SCOPE_DISPOSAL_FAILED). */
  syncScopeDisposalFailed: '[lifecycle] sync lifecycle scope disposal failed',
  /** Explains that a generation timeout option could not be read at its admission boundary. */
  generationTimeoutAccessorFailed: '[lifecycle] generation timeout option getter failed'
} as const

export type ILifecycleErrorText = (typeof LifecycleErrorText)[keyof typeof LifecycleErrorText]

/**
 * Message factories for lifecycle texts that embed a runtime value. Kept apart from
 * `LifecycleErrorText` so the public `ILifecycleErrorText` union stays string-only. Consumed by
 * mutation-queue; the output text is part of the queue's error contract.
 */
export const LifecycleErrorTextFactory = {
  /** QUEUE_ADMISSION_TIMEOUT message naming the configured admission budget. */
  mutationAdmissionTimeout: (timeoutMs: number): string =>
    `[lifecycle] mutation waited in the queue for more than ${timeoutMs}ms`,
  /** QUEUE_SELF_DEPENDENCY message naming the owner that enqueued behind itself. */
  mutationSelfDependency: (owner: string): string =>
    `[lifecycle] mutation with owner "${owner}" was enqueued while a mutation with the same owner is running`
} as const
