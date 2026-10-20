/**
 * Owns the error-code declarations for `@migaia/lifecycle`. Under `docs/contracts/error-codes.md`,
 * `(source, code)` uniquely identifies an error. The `source` is always `'@migaia/lifecycle'`.
 * Throw sites reference these constants instead of inline literals. Code values are public API.
 * Renaming a code is a breaking change.
 */
export const LifecycleErrorCode = {
  /**
   * An abortable delay cannot register, schedule, or clean up its owned wait resources. Enforces
   * Retain the original failure while the owner decides whether to retry or stop. Cancellation
   * itself resolves the wait and does not use this code.
   */
  delayFailed: 'DELAY_FAILED',
  /**
   * Reports `own()` after `close()`, or `retain()` on a closed registry. The container no longer
   * accepts work. Create a new scope instead of reusing it. Enforces the two-phase contract:
   * `close()` changes state synchronously, cannot fail, and does not call user code. Also tags the
   * `signal.reason` of a `LifecycleScope`/`SyncLifecycleScope` aborted by `close()` or `dispose()`,
   * so cancelled work observes a coded Error with a stack instead of a string.
   */
  scopeClosed: 'SCOPE_CLOSED',

  /**
   * Rejects registration or activation after `dispose()` reaches `terminal`. This is stronger than
   * `SCOPE_CLOSED` because `terminal` is irreversible. Create a new container instead of retrying.
   */
  scopeTerminal: 'SCOPE_TERMINAL',

  /**
   * Reports a disposer reentering its own scope's `dispose()`. The error propagates through the
   * triggering disposer's normal error path. Other resources still finish releasing. Move this
   * cleanup outside the disposer so a resource does not dispose the scope releasing it.
   */
  scopeReentrantDispose: 'SCOPE_REENTRANT_DISPOSE',

  /**
   * Reports a disposer synchronously calling its own scope's `own()`. The error belongs to the
   * triggering disposer, as with reentrant disposal. The container is already `closing`. It cannot
   * take ownership of new resources during release. Outside that synchronous callback frame, a
   * caller observes `SCOPE_CLOSED` while teardown is pending.
   */
  scopeReentrantOwn: 'SCOPE_REENTRANT_OWN',

  /**
   * Rejects a descriptor without `syncSafe: true` at registration in `SyncLifecycleScope`. Also
   * rejects a `LifecycleScope` or `ProvisionalScope` instance as an owned resource. The check runs
   * at registration, before release. Use an asynchronous `LifecycleScope`, or explicitly mark a
   * suitable descriptor `syncSafe: true`. Its `force` and `graceful` callbacks must never return a
   * thenable.
   */
  scopeSyncViolation: 'SCOPE_SYNC_VIOLATION',

  /**
   * Classifies untagged release failures in every error policy and aggregates multiple failures
   * under the throw policy. Native single failures retain identity; primitives retain cause.
   * Existing foreign semantic identities remain unchanged. Inspect cause/errors for originals.
   */
  scopeDisposalFailed: 'SCOPE_DISPOSAL_FAILED',

  /**
   * Reports a start failure when `LifecycleUnit` enters `failed`. The failure can be a synchronous
   * throw or a rejected thenable. Call `start()` or `restart()` to retry with a new generation.
   * Call `close()` to stop new work and `dispose()` to reach `terminal`. The `failed` state still
   * permits these transitions.
   */
  unitStartFailed: 'UNIT_START_FAILED',

  /**
   * Identifies a result discarded at commit because a newer generation supersedes it. This is
   * normal race handling rather than an operation failure. Callers usually ignore it unless
   * diagnostics need to observe the event. Also tags the `signal.reason` of a generation aborted
   * because `begin()` started a newer one, so cancelled work observes a coded Error with a stack.
   */
  generationSuperseded: 'GENERATION_SUPERSEDED',

  /**
   * Reports timer, parent-listener, or signal cleanup failure during generation cancellation or
   * completion. Invalidation first converges state, then preserves cleanup failures in registration
   * order. Enforces generation supersession. Handle the error and use a new generation. Do not
   * revive the old generation.
   */
  generationCancellationFailed: 'GENERATION_CANCELLATION_FAILED',

  /**
   * Rejects `begin()` on a disposed `GenerationController`. The controller cannot be reused. Create
   * a new controller. Also tags the `signal.reason` of the active generation aborted when a
   * `LifecycleUnit` is disposed; the work it carried must stop and is not retried.
   */
  generationDisposed: 'GENERATION_DISPOSED',

  /**
   * Tags the `signal.reason` of a generation aborted because its `begin({ timeoutMs })` budget
   * elapsed. The generation is no longer current; start a new generation to retry, or raise the
   * budget. Not thrown by the controller itself; consumers see it through the aborted signal.
   */
  generationTimedOut: 'GENERATION_TIMED_OUT',

  /**
   * Rejects `retain()` after `seal()`. Sealing stops new leases. Finish retaining before sealing,
   * or use the nonexclusive `whenZeroOnce()` path.
   */
  quiescenceSealed: 'QUIESCENCE_SEALED',

  /**
   * Rejects strict `whenZero(key)` synchronously when `seal(key)` has not run. It does not return a
   * rejected Promise. Strict zero-lease waiting first stops new leases so its guarantee holds. Call
   * `seal()` first, or use `whenZeroOnce()` and perform the second check yourself.
   */
  quiescenceUnsealedWait: 'QUIESCENCE_UNSEALED_WAIT',

  /**
   * Rejects `own()` or `commitTo()` after a provisional scope commits or rolls back. Also rejects
   * `rollback()` after a successful commit. Repeated rollback reuses the same Promise, including
   * rollback after failed-commit compensation. Commit and rollback are alternative terminal
   * actions. Check callers that try to register or commit again. Also tags the provisional
   * `signal.reason` aborted by `commitTo()` or `rollback()`; the message names which one.
   */
  provisionalSettled: 'PROVISIONAL_SETTLED',

  /**
   * Reports `commitTo()` when the target parent is `closing` or `terminal` and refuses ownership.
   * Resources already transferred remain owned by the parent. This call releases the remaining
   * resources automatically. The caller does not need to call `rollback()` manually.
   */
  provisionalParentClosed: 'PROVISIONAL_PARENT_CLOSED',

  /**
   * Rejects and removes a mutation that waits longer than `queueAdmissionTimeoutMs`. This admission
   * timeout is configurable and does not apply when omitted. Check for an earlier task blocking the
   * queue, or increase the threshold.
   */
  queueAdmissionTimeout: 'QUEUE_ADMISSION_TIMEOUT',

  /**
   * Rejects a submission whose owner label matches the currently running mutation's owner. The
   * check does not depend on whether the caller awaits the submitted task. Awaiting a successor
   * inside that mutation would deadlock the FIFO queue. Avoid waiting for another queued task with
   * the same owner. Split the work into separate top-level calls when needed.
   */
  queueSelfDependency: 'QUEUE_SELF_DEPENDENCY',

  /**
   * Reports a throw or rejection from a descriptor's `force` callback. The contract requires
   * `force` to finish unconditionally. The current error policy collects or reports the failure,
   * and release still reaches `terminal`. Treat it as an unrecoverable resource-leak risk rather
   * than a transient failure to retry.
   */
  releaseForceFailed: 'RELEASE_FORCE_FAILED',

  /**
   * Identifies a new graceful phase requested after the shared absolute deadline passes, or a
   * synchronous `graceful` that returned only after its budget (that release still succeeds and
   * `force` does not run). Both are reported through `context.report` as diagnostics, never thrown.
   * Normal graceful-timeout fallback to `force` is a degradation path and does not use this code.
   */
  deadlineExceeded: 'DEADLINE_EXCEEDED',

  /**
   * Reports a missing or noncompliant host `AbortController` through the abort factory. Scope,
   * generation, and disposal paths fail immediately when they need that capability. Missing
   * scheduler capabilities are reported by `@migaia/utils/scheduler` as utils `ENV_UNSUPPORTED`.
   * Use an environment with `AbortController`, or an API that does not require it.
   */
  envUnsupported: 'ENV_UNSUPPORTED',

  /**
   * Rejects invalid scheduler/task options and failures of admitted scheduler methods (including
   * task cancel/unref) at the lifecycle boundary. Native failures retain identity when annotatable.
   * Examples include throwing accessors, missing `now`, `schedule`, or `cancel`, and a nonfunction
   * `unref`. Also rejects nonfinite time values, nonfinite or negative delays, addition that
   * overflows, or cleanup observations without the error array required by `mergeCleanupResults`.
   * Enforces scheduler admission and finite nonnegative delays. Correct the scheduler or delay
   * instead of retrying the same invalid input.
   */
  invalidOption: 'INVALID_OPTION'
} as const

export type ILifecycleErrorCode = (typeof LifecycleErrorCode)[keyof typeof LifecycleErrorCode]
