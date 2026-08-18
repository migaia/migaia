/** Stable public error messages; scenario details remain in the attached error fields. */
export const EventSubscriberErrorText = {
  /** Stable text for invalid listener input; used by channel and helper boundary guards. */
  invalidListener: 'event-subscriber listener must be a function',
  /** Stable text for invalid reporter input; used by channel and hub option validation. */
  invalidReporter: 'event-subscriber reporter must be a function',
  /** Stable text for malformed structural channels; used by helper admission. */
  invalidChannel: 'event-subscriber channel is invalid',
  /** Stable text for malformed abort signals or signal cleanup failures; used by subscribeUntil. */
  invalidSignal: 'event-subscriber abort signal is invalid',
  /** Stable text for malformed subscriber objects; used by subscribeSubscriber. */
  invalidSubscriber: 'event-subscriber subscriber must expose handle()',
  /** Stable text for unsupported hub keys; used by keyed event routing. */
  invalidEventKey: 'event-subscriber event key is invalid',
  /** Stable text for a task selection with no registration; used by strict task publishing. */
  taskNotFound: 'event-subscriber taskId has no registration',
  /** Stable text for a task selection with multiple registrations; used by strict task publishing. */
  taskNotUnique: 'event-subscriber taskId is not unique',
  /** Stable text for malformed task labels; used by registration and selection validation. */
  invalidTaskId: 'event-subscriber taskId is invalid',
  /** Stable text for malformed public option records; used by all channel boundaries. */
  invalidOptions: 'event-subscriber options are invalid',
  /** Stable text for synchronous listener failures; used by awaited publish helpers. */
  publishFailed: 'event-subscriber publish failed',
  /** Stable text for fire-and-forget failures that reached terminal diagnostics. */
  unhandledListenerFailure: 'event-subscriber listener failure was not handled'
} as const;
