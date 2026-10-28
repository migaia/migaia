/** Owns structural channel and registration-option admission; stores no registration state. */
import { EventSubscriberErrorCode } from '../error-code.js'
import { codeExistingError, createEventTypeError, eventErrorText } from '../errors.js'
import type { IEventChannelLike } from '../types.js'
import { EventDelivery } from '../state-constants.js'
import { isRecord } from './record.js'

/** Creates the canonical options failure while preserving whether a cause was supplied. */
export const createInvalidOptionsError = (
  ...causes: [] | [unknown]
): ReturnType<typeof createEventTypeError> =>
  createEventTypeError(
    EventSubscriberErrorCode.invalidOptions,
    eventErrorText(EventSubscriberErrorCode.invalidOptions),
    ...causes
  )

/** Rejects non-callable business listeners before any registration state can be acquired. */
export function validateEventListener(listener: unknown): void {
  if (typeof listener !== 'function')
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidListener,
      eventErrorText(EventSubscriberErrorCode.invalidListener)
    )
}

/** Admits an optional reporter without reading options again or changing its failure identity. */
export function validateEventReporter(reporter: unknown): void {
  if (reporter !== undefined && typeof reporter !== 'function')
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidReporter,
      eventErrorText(EventSubscriberErrorCode.invalidReporter)
    )
}

/** Structural channel after validation: `subscribe` is known to be callable. */
export type IValidatedChannel<T, R, V = undefined> = IEventChannelLike<T, R, V> & {
  /** The channel's `subscribe`, checked to be callable. */
  readonly subscribe: IEventChannelLike<T, R, V>['subscribe']
}

/** Validates a task label before it can enter a registration or selection index. */
export const validateTaskId = (value: unknown, allowUndefined: boolean): string | undefined => {
  if (value === undefined && allowUndefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidTaskId,
      eventErrorText(EventSubscriberErrorCode.invalidTaskId)
    )
  }
  return value
}

/** Validates a listener option record and reads taskId once. */
export const readTaskOption = (options: unknown): string | undefined => {
  if (options === undefined) return undefined
  try {
    if (!isRecord(options)) {
      throw createInvalidOptionsError()
    }
    return validateTaskId(options.taskId, true)
  } catch (error) {
    /** Whether the failure came from task-name validation, which keeps its own code. */
    let isTaskIdError = false
    try {
      isTaskIdError =
        ((typeof error === 'object' && error !== null) || typeof error === 'function') &&
        (error as { readonly code?: unknown }).code === EventSubscriberErrorCode.invalidTaskId
    } catch {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions)
    }
    if (isTaskIdError) throw error
    throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions)
  }
}

/** Reads the listener argument mode once, preserving existing options-error identity and coding. */
export const readDeliveryOption = (options: unknown): EventDelivery => {
  if (options === undefined) return EventDelivery.context
  try {
    if (!isRecord(options)) throw createInvalidOptionsError()
    /** Omission alone selects the incumbent context contract; malformed supplied modes reject. */
    const delivery = options.delivery
    if (delivery === undefined) return EventDelivery.context
    if (delivery !== EventDelivery.context && delivery !== EventDelivery.value)
      throw createInvalidOptionsError()
    return delivery
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidOptions)
  }
}

/** Validates a structural channel before registration state can be changed. */
export const validateChannelLike = <T, R, V = undefined>(
  channel: unknown
): IValidatedChannel<T, R, V> => {
  try {
    if (!isRecord(channel) && typeof channel !== 'function') {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    }
    if (!('subscribe' in (channel as object))) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    }
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
  }
  return {
    /** Forwards to the source channel's `subscribe` and codes a failure as `INVALID_CHANNEL`. */
    subscribe(listener, options) {
      try {
        return (channel as IEventChannelLike<T, R, V>).subscribe(
          listener as never,
          options as never
        )
      } catch (error) {
        throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
      }
    }
  }
}
