/** Stable semantic codes emitted by the utils package boundary. */
export const UtilsErrorCode = {
  /**
   * A caller passed an argument outside its documented domain: a non-finite or negative delay or
   * timeout, a non-positive limiter concurrency, or a scheduler `delayMs`/`advance(ms)` that is not
   * a finite non-negative number or overflows the virtual clock. The native
   * `TypeError`/`RangeError` type is kept; the caller must fix the argument, retrying the same
   * value fails again.
   */
  invalidArgument: 'INVALID_ARGUMENT',
  /**
   * `toError()` wrapped a thrown value that was not an `Error`. The original value stays on
   * `cause`; callers that need the raw value read it from there instead of the message.
   */
  nonErrorValue: 'NON_ERROR_VALUE',
  /**
   * A host capability this package needs is missing or misbehaves: `structuredClone`, or for the
   * default scheduler `performance.now` (missing or returning a non-finite value) and
   * `setTimeout`/`clearTimeout`. The caller must run on a host that provides it or inject its own
   * implementation (for example a custom `IScheduler`).
   */
  envUnsupported: 'ENV_UNSUPPORTED',
  /**
   * A cooperative operation observed its abort signal (`UtilsAbortError`). The abort reason stays
   * on `cause`; callers treat it as cancellation, not as a failure to retry.
   */
  aborted: 'ABORTED',
  /**
   * `withTimeout`, `retry` total timeout or a similar deadline elapsed before the operation settled
   * (`UtilsTimeoutError`). The caller may retry with a longer budget or report the timeout.
   */
  deadlineExceeded: 'DEADLINE_EXCEEDED',
  /**
   * A manual scheduler `advance()` flushed more than 10000 callbacks, which indicates a callback
   * that keeps rescheduling itself at the current time. Thrown as a top-level `RangeError`; the
   * test or simulation must stop the self-scheduling loop.
   */
  schedulerRunaway: 'SCHEDULER_RUNAWAY',
  /**
   * `attachErrorIdentity()` found an existing `source`/`code` property with a different value and
   * no conflict hook. Identity is never overwritten; the caller must supply an `onConflict` policy
   * or leave the existing identity in place.
   */
  errorIdentityConflict: 'ERROR_IDENTITY_CONFLICT',
  /**
   * An immutable snapshot could not be produced because the host's structured clone rejected the
   * value (functions, symbols, host objects). The caller must pass cloneable data.
   */
  cloneUnsupported: 'CLONE_UNSUPPORTED',
  /**
   * Byte or text decoding met malformed input at a reported offset. The caller must supply valid
   * input for the named encoding; the message carries the failing offset.
   */
  invalidEncoding: 'INVALID_ENCODING',
  /**
   * `run()` was called on a concurrency limiter after `close()`/`dispose()`. The limiter accepts no
   * new work; the caller must create a new limiter.
   */
  limiterClosed: 'LIMITER_CLOSED',
  /**
   * A non-reentrant operation was called from inside itself: a guarded function, a collector drain,
   * or a manual scheduler `advance()` called from one of its own callbacks. The outer call
   * continues unchanged; the caller must move the nested call outside the running operation.
   */
  reentrantCall: 'REENTRANT_CALL',
  /**
   * A config value, root, patch or key has a shape the config model does not support (non-plain
   * records, symbol keys, values not owned by the config). The caller must pass plain owned data.
   */
  configUnsupported: 'CONFIG_UNSUPPORTED',
  /**
   * A mutation was attempted on a readonly config view. The caller must derive a new config through
   * the documented merge/patch API instead of mutating the view.
   */
  configReadonly: 'CONFIG_READONLY',
  /**
   * Config sources, profiles or ownership metadata disagree (different profiles, a delete where it
   * is not valid, conflicting ownership). The caller must reconcile the sources before merging.
   */
  configConflict: 'CONFIG_CONFLICT',
  /**
   * A config graph exceeded a configured bound (`maxKeys`, `maxDepth`, `maxNodes`) or a limit
   * option was itself invalid. The caller must shrink the input or raise the bound deliberately.
   */
  configLimitExceeded: 'CONFIG_LIMIT_EXCEEDED',
  /**
   * A config path or segment is malformed or dangerous (prototype keys, invalid length or segment).
   * The caller must pass a safe, well-formed path.
   */
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
