/** Stable source attached to every event-subscriber package-boundary error. */
export const EVENT_SUBSCRIBER_SOURCE = '@migaia/event-subscriber'

/** The package-local error code declaration site. */
export const EventSubscriberErrorCode = {
  /** Invalid listener/reporter or terminal reporter input; caller must pass a function. */
  invalidListener: 'INVALID_LISTENER',
  /** Invalid report/terminalReport function; caller must provide a callable reporter or omit it. */
  invalidReporter: 'INVALID_REPORTER',
  /** A helper received a malformed or non-canonical channel; caller must use a factory channel. */
  invalidChannel: 'INVALID_CHANNEL',
  /**
   * A signal-like value failed structural validation or abort rollback; caller must provide a valid
   * signal.
   */
  invalidSignal: 'INVALID_SIGNAL',
  /** An object subscriber lacks handle(); caller must implement the typing contract. */
  invalidSubscriber: 'INVALID_SUBSCRIBER',
  /** A hub key is not string, number, or symbol; caller must use a valid property key. */
  invalidEventKey: 'INVALID_EVENT_KEY',
  /** Strict task publish found no registration; caller must fix the taskId or registration lifetime. */
  taskNotFound: 'TASK_NOT_FOUND',
  /** Strict task publish found multiple registrations; caller must make the taskId unique. */
  taskNotUnique: 'TASK_NOT_UNIQUE',
  /**
   * A task label is empty or not a string; caller must pass a non-empty string or undefined where
   * allowed.
   */
  invalidTaskId: 'INVALID_TASK_ID',
  /** A public options object or field is malformed; caller must correct the option shape. */
  invalidOptions: 'INVALID_OPTIONS',
  /** One or more listeners failed after the full target snapshot was processed. */
  publishFailed: 'PUBLISH_FAILED',
  /** A configured value path was missing, blocked, or threw while delivering an event. */
  valueProjectionFailed: 'VALUE_PROJECTION_FAILED',
  /**
   * A fire-and-forget listener failure reached terminal diagnostics after report handling failed or
   * was absent.
   */
  unhandledListenerFailure: 'UNHANDLED_LISTENER_FAILURE',
  /** A callable subscription chain was closed; caller must retain a live handle. */
  subscriptionClosed: 'SUBSCRIPTION_CLOSED',
  /**
   * Handle descriptor projection failed after registration; the package rolls back the first
   * registration and preserves the projection failure as the primary cause.
   */
  subscriptionHandleProjectionFailed:
    'SUBSCRIPTION_HANDLE_PROJECTION_FAILED' /** A captured invocation was called after completion or more than once. */,
  invocationClosed: 'INVOCATION_CLOSED'
} as const

export type IEventSubscriberErrorCode =
  (typeof EventSubscriberErrorCode)[keyof typeof EventSubscriberErrorCode]
