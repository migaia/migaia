/**
 * The single declaration site for `@migaia/capability` error codes.
 *
 * The pair (source, code) uniquely identifies an error at the public boundary. `source` is always
 * `'@migaia/capability'`. Throw sites use these constants instead of inline values.
 *
 * The migration assigns codes to previously untagged errors. `INVALID_NAME`, `INVALID_ACTIVATE`,
 * and `INVALID_HANDLE` retain their native `TypeError` identity. Codes are attached as properties
 * without replacing the error type.
 *
 * Code values are public API. Renaming a code is a breaking change.
 */
export const CapabilityErrorCode = {
  /**
   * Thrown when a mutation method such as `register`, `setFlag`, `setFlags`, `enable`, or `disable`
   * is called after the host is disposed.
   *
   * Enforces the terminal host boundary. Read-only diagnostics (`names`, `state`, `handle`, and
   * `error`) remain available after disposal. Create a new host to enable capabilities again. A
   * disposed host cannot be revived.
   */
  hostDisposed: 'HOST_DISPOSED',

  /**
   * Thrown or rejected when `register`, `setFlag`, `setFlags`, `enable`, `disable`, or `dispose`
   * reenters a disposer or reporter while `transitionDepth > 0`. Also rejects repeated `dispose()`
   * calls before the first disposal completes.
   *
   * Enforces the reentrancy boundary. A rollback callback cannot rewrite the flag snapshot during
   * the surrounding transition. Move mutations outside lifecycle callbacks.
   */
  hostTransitioning: 'HOST_TRANSITIONING',

  /**
   * Thrown when `state`, `handle`, `error`, `enable`, or `disable` references an unregistered
   * capability.
   *
   * Enforces registered-name lookup. Check the name and register the capability first.
   */
  notRegistered: 'NOT_REGISTERED',

  /**
   * Thrown when `register()` receives an existing `name`. Duplicate registration is a programming
   * error and never silently replaces the existing entry.
   *
   * Enforces unique registration names. Use a different name or create a new host.
   */
  alreadyRegistered: 'ALREADY_REGISTERED',

  /**
   * Thrown as a `TypeError` when `register()` receives a name that is not a nonempty string.
   *
   * Enforces input validation. Correct `name` before retrying.
   */
  invalidName: 'INVALID_NAME',

  /**
   * Thrown as a `TypeError` when `register()` receives a non-function `activate`.
   *
   * Enforces input validation. Provide a callable `activate`.
   */
  invalidActivate: 'INVALID_ACTIVATE',

  /**
   * Thrown as a `TypeError` when the result of `activate()` lacks a callable `dispose`. Rejects
   * incomplete activation instead of leaving a partially enabled capability.
   *
   * Enforces the handle contract. Ensure `activate` returns a handle with `dispose`.
   */
  invalidHandle: 'INVALID_HANDLE',

  /**
   * Reserved for diagnostics or events when the gate denies activation. No current throw site uses
   * it. `enable()` returns `{ status: 'gated' }` for a denied activation without throwing.
   * Reserving this code for an `onError` or event channel does not change that behavior.
   *
   * Enforces the activation gate. `gated` differs from graph availability `blocked`. Branch on the
   * return value instead of catching an error.
   */
  gated: 'GATED',

  /**
   * Thrown when an `ownKeys`, `getOwnPropertyDescriptor`, or getter operation fails while
   * snapshotting `flags`, `definition`, or graph-readiness state/error, for example on a hostile
   * proxy. Annotatable readiness getter Errors retain their native identity and receive this code.
   *
   * The gate fails closed before throwing. `cause` retains the original proxy exception by
   * identity. Correct the flags or definition object before retrying.
   */
  invalidOption: 'INVALID_OPTION'
} as const

/** Stable host error values; activation outcomes use CapabilityEnableStatus instead. */
export type ICapabilityErrorCode = (typeof CapabilityErrorCode)[keyof typeof CapabilityErrorCode]
