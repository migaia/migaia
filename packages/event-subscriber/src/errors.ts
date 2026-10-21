import {
  EVENT_SUBSCRIBER_SOURCE,
  EventSubscriberErrorCode,
  type IEventSubscriberErrorCode
} from './error-code.js'
import { EventSubscriberErrorText } from './error-text.js'
import { attachErrorIdentity, isNativeErrorValue } from '@migaia/utils/error'

/** Native error with the optional identity fields this package attaches. */
type IEventError = Error & {
  /** Package that created the error, when attached. */
  readonly source?: string
  /** Package error code, when attached. */
  readonly code?: string
  /** Wrapped original error, when present. */
  readonly cause?: unknown
}

/** Creates the existing package wrapper when utils cannot attach identity in place. */
const eventErrorAttachmentFallback = <T extends object>(
  error: T,
  code: IEventSubscriberErrorCode,
  attachError: unknown
): T & {
  readonly source: typeof EVENT_SUBSCRIBER_SOURCE
  readonly code: IEventSubscriberErrorCode
} => {
  /** Fresh package-owned wrapper; the original stays reachable through `cause`. */
  const wrapped = attachErrorIdentity(new TypeError(eventErrorText(code), { cause: error }), {
    source: EVENT_SUBSCRIBER_SOURCE,
    code,
    detail: { attachError }
  })
  return wrapped as unknown as T & {
    readonly source: typeof EVENT_SUBSCRIBER_SOURCE
    readonly code: IEventSubscriberErrorCode
  }
}

/** Adds the package contract through utils without replacing the original native error object. */
export const attachEventErrorCode = <T extends object>(
  error: T,
  code: IEventSubscriberErrorCode
): T & {
  readonly source: typeof EVENT_SUBSCRIBER_SOURCE
  readonly code: IEventSubscriberErrorCode
} => {
  try {
    return attachErrorIdentity(
      error,
      { source: EVENT_SUBSCRIBER_SOURCE, code },
      {
        onFailure: ({ cause }) => eventErrorAttachmentFallback(error, code, cause),
        onConflict: ({ key, existing, incoming }) =>
          eventErrorAttachmentFallback(
            error,
            code,
            new TypeError(eventErrorText(code), { cause: { key, existing, incoming } })
          )
      }
    ) as T & {
      readonly source: typeof EVENT_SUBSCRIBER_SOURCE
      readonly code: IEventSubscriberErrorCode
    }
  } catch (attachError) {
    return eventErrorAttachmentFallback(error, code, attachError)
  }
}

/** Creates a native TypeError while preserving the original hostile value as cause. */
export const createEventTypeError = (
  code: IEventSubscriberErrorCode,
  message: string,
  ...causes: [] | [unknown]
): TypeError & {
  readonly source: typeof EVENT_SUBSCRIBER_SOURCE
  readonly code: IEventSubscriberErrorCode
} => {
  /** Presence and payload differ when a visitor explicitly throws undefined. */
  const error = new TypeError(message, causes.length === 0 ? undefined : { cause: causes[0] })
  return attachEventErrorCode(error, code)
}

/** Creates a coded native Error for lifecycle/state violations. */
export const createEventError = (
  code: IEventSubscriberErrorCode,
  message: string
): Error & {
  readonly source: typeof EVENT_SUBSCRIBER_SOURCE
  readonly code: IEventSubscriberErrorCode
} => attachEventErrorCode(new Error(message), code)

/**
 * Codes genuine Error values in place and wraps every other thrown value in a native TypeError.
 * Hostile proxy inspection is itself converted to a coded TypeError so no shape probe can escape
 * the package boundary uncoded.
 */
export const codeExistingError = (value: unknown, code: IEventSubscriberErrorCode): unknown => {
  /** Only objects and functions can carry an attached code; primitives are wrapped instead. */
  const objectLike = (typeof value === 'object' && value !== null) || typeof value === 'function'
  if (!objectLike) return createEventTypeError(code, eventErrorText(code), value)
  try {
    return isNativeErrorValue(value as object)
      ? attachEventErrorCode(value as object, code)
      : createEventTypeError(code, eventErrorText(code), value)
  } catch {
    return createEventTypeError(code, eventErrorText(code), value)
  }
}

/** Creates the AggregateError shape required for publish and late-failure diagnostics. */
export const createEventAggregateError = (
  code: IEventSubscriberErrorCode,
  errors: readonly unknown[],
  message: string
): AggregateError & {
  readonly source: typeof EVENT_SUBSCRIBER_SOURCE
  readonly code: IEventSubscriberErrorCode
} => {
  /** Native `AggregateError` whose `cause` is its first entry. */
  const error = new AggregateError(errors, message, { cause: errors[0] })
  return attachEventErrorCode(error, code)
}

/** Stable code-to-text lookup allocated once for every error construction path. */
const eventErrorTextByCode: Record<IEventSubscriberErrorCode, string> = {
  [EventSubscriberErrorCode.invalidListener]: EventSubscriberErrorText.invalidListener,
  [EventSubscriberErrorCode.invalidReporter]: EventSubscriberErrorText.invalidReporter,
  [EventSubscriberErrorCode.invalidChannel]: EventSubscriberErrorText.invalidChannel,
  [EventSubscriberErrorCode.invalidSignal]: EventSubscriberErrorText.invalidSignal,
  [EventSubscriberErrorCode.aborted]: EventSubscriberErrorText.aborted,
  [EventSubscriberErrorCode.invalidSubscriber]: EventSubscriberErrorText.invalidSubscriber,
  [EventSubscriberErrorCode.invalidEventKey]: EventSubscriberErrorText.invalidEventKey,
  [EventSubscriberErrorCode.taskNotFound]: EventSubscriberErrorText.taskNotFound,
  [EventSubscriberErrorCode.taskNotUnique]: EventSubscriberErrorText.taskNotUnique,
  [EventSubscriberErrorCode.invalidTaskId]: EventSubscriberErrorText.invalidTaskId,
  [EventSubscriberErrorCode.invalidOptions]: EventSubscriberErrorText.invalidOptions,
  [EventSubscriberErrorCode.publishFailed]: EventSubscriberErrorText.publishFailed,
  [EventSubscriberErrorCode.visitorFailed]: EventSubscriberErrorText.visitorFailed,
  [EventSubscriberErrorCode.valueProjectionFailed]: EventSubscriberErrorText.valueProjectionFailed,
  [EventSubscriberErrorCode.subscriptionClosed]: EventSubscriberErrorText.subscriptionClosed,
  [EventSubscriberErrorCode.unhandledListenerFailure]:
    EventSubscriberErrorText.unhandledListenerFailure,
  [EventSubscriberErrorCode.subscriptionHandleProjectionFailed]:
    EventSubscriberErrorText.subscriptionHandleProjectionFailed,
  [EventSubscriberErrorCode.invocationClosed]: EventSubscriberErrorText.invocationClosed,
  [EventSubscriberErrorCode.subscriptionDisposeFailed]:
    EventSubscriberErrorText.subscriptionDisposeFailed
}

/** Returns the canonical text without rebuilding the full code table. */
export const eventErrorText = (code: IEventSubscriberErrorCode): string =>
  eventErrorTextByCode[code]

/** Error that carries this package's `source` and one of its codes. */
export type IEventErrorWithCode = IEventError & {
  /** Always `@migaia/event-subscriber`. */
  readonly source: typeof EVENT_SUBSCRIBER_SOURCE
  /** One of `EventSubscriberErrorCode`. */
  readonly code: IEventSubscriberErrorCode
}
