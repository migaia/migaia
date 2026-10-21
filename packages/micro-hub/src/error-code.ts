/**
 * Declares the public error codes for `@migaia/micro-hub` in one place.
 *
 * The registry in `docs/contracts/error-codes.md` identifies errors by `(source, code)`. The
 * `source` is always `'@migaia/micro-hub'`. Throw sites use these constants instead of inline
 * literals. Code values are public API; renaming one is a breaking change.
 */
export const MicroHubErrorCode = {
  /**
   * `createMicroHub()` is called while a hub already exists in this realm.
   *
   * The package is a singleton: only the shell configures it. Child apps call `getMicroHub()`; call
   * `hub.dispose()` first when a fresh hub is really intended.
   */
  hubAlreadyCreated: 'HUB_ALREADY_CREATED',

  /**
   * `getMicroHub()` is called before the shell created the hub.
   *
   * Load order is wrong: create the hub in the shell before any remote mounts, or create it in a
   * child's standalone development entry.
   */
  hubNotCreated: 'HUB_NOT_CREATED',

  /**
   * `connect(name)` is called while an app with the same name is still connected.
   *
   * Prevents double subscriptions after a remount. Disconnect the previous instance first.
   */
  appAlreadyConnected: 'APP_ALREADY_CONNECTED',

  /**
   * A member of an app handle, or of a view obtained from it, is used after `disconnect()` began.
   *
   * Connect again to obtain a live handle; disconnected handles are never revived.
   */
  appDisconnected: 'APP_DISCONNECTED',

  /**
   * A contract needs a capability (`events`, `state`, `persist`, `resource`) the hub was created
   * without, or a capability plugin requires another one that is missing.
   *
   * Add the plugin to `createMicroHub({ plugins })`.
   */
  pluginMissing: 'PLUGIN_MISSING',

  /**
   * A contract is used with a major version different from the one already registered under the
   * same name.
   *
   * Two independently deployed apps disagree on the contract shape; deploy matching versions.
   */
  contractVersionMismatch: 'CONTRACT_VERSION_MISMATCH',

  /**
   * `own(contract)` is called while another connected app (or the same app) already owns it.
   *
   * Each contract has at most one owner. Wait for the current owner to disconnect.
   */
  contractOwned: 'CONTRACT_OWNED',

  /**
   * A command is called by an app that is neither the owner nor listed in the contract `writers`.
   *
   * Add the app to `writers`, or route the change through the owner with a request.
   */
  writeDenied: 'WRITE_DENIED',

  /**
   * An event is emitted by an app that does not own the contract.
   *
   * Events belong to the owner; other apps use commands or requests to reach it.
   */
  emitDenied: 'EMIT_DENIED',

  /**
   * A command returned a thenable. Thrown as `TypeError`; no state was written.
   *
   * Commands must be synchronous pure functions so a commit is atomic. Do async work first, then
   * call the command with the result.
   */
  commandAsync: 'COMMAND_ASYNC',

  /**
   * `handle()` or `provide()` is called twice for the same request or resource of one contract.
   *
   * Each request or resource has exactly one provider; remove the duplicate registration.
   */
  handlerDuplicated: 'HANDLER_DUPLICATED',

  /**
   * A request is made while the contract has no owner (or no handler for it) and no `waitForOwner`
   * was given.
   *
   * Pass `waitForOwner` when the owner may mount later, or retry after it connects.
   */
  ownerAbsent: 'OWNER_ABSENT',

  /**
   * `waitForOwner` elapsed before the owner registered a handler for the request.
   *
   * The owner did not mount in time; surface the failure or retry later.
   */
  ownerTimeout: 'OWNER_TIMEOUT',

  /**
   * The owner disconnected while a request to it was in flight.
   *
   * The handler may or may not have completed its side effects; reconcile before retrying.
   */
  ownerGone: 'OWNER_GONE',

  /**
   * An argument or option has an invalid shape: empty or dotted names, a non-positive version,
   * unknown fields in a command patch, a non-function command. Thrown as `TypeError`.
   *
   * Fix the call site; nothing was registered.
   */
  invalidOption: 'INVALID_OPTION'
} as const

/** Union of every `@migaia/micro-hub` error code value. */
export type IMicroHubErrorCode = (typeof MicroHubErrorCode)[keyof typeof MicroHubErrorCode]
