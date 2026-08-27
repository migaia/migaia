import { EventSubscriberErrorCode } from '../error-code.js'
import {
  createEventAggregateError,
  createEventError,
  createEventTypeError,
  eventErrorText
} from '../errors.js'
import type { IUnsubscribe } from '../types.js'
import type { IEventApiStylePlan } from '../style.js'

/** Builds one callable, chain-owning subscription handle. */
type ISubscriptionHandle<T> = IUnsubscribe & {
  readonly unsubscribe: ISubscriptionHandle<T>
  readonly subscribe: (...args: never[]) => ISubscriptionHandle<T>
}

export const createRawSubscriptionOwner = <T extends ISubscriptionHandle<unknown>>(
  first: () => void,
  extend: (...args: never[]) => void | (() => void),
  stylePlan: IEventApiStylePlan
): T => {
  const disposers: Array<() => void> = [first]
  let closed = false
  const handle = (() => {
    if (closed) return
    closed = true
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      disposers[index]()
    }
    disposers.length = 0
  }) as T
  try {
    const subscribe = (...args: never[]): ISubscriptionHandle<T> => {
      if (closed) {
        throw createEventError(
          EventSubscriberErrorCode.subscriptionClosed,
          eventErrorText(EventSubscriberErrorCode.subscriptionClosed)
        )
      }
      const disposer = extend(...args)
      if (typeof disposer === 'function') disposers.push(disposer)
      return handle
    }
    const descriptors: PropertyDescriptorMap = {
      unsubscribe: { value: handle, enumerable: false, writable: false, configurable: false },
      subscribe: {
        value: subscribe,
        enumerable: false,
        writable: false,
        configurable: false
      }
    }
    if (stylePlan.subscribe !== 'subscribe') {
      descriptors[stylePlan.subscribe] = {
        value: subscribe,
        enumerable: false,
        writable: false,
        configurable: false
      }
    }
    if (stylePlan.unsubscribe !== 'unsubscribe') {
      descriptors[stylePlan.unsubscribe] = {
        value: handle,
        enumerable: false,
        writable: false,
        configurable: false
      }
    }
    Object.defineProperties(handle, descriptors)
  } catch (error) {
    try {
      handle()
    } catch (rollbackError) {
      throw createEventAggregateError(
        EventSubscriberErrorCode.subscriptionHandleProjectionFailed,
        [error, rollbackError],
        eventErrorText(EventSubscriberErrorCode.subscriptionHandleProjectionFailed)
      )
    }
    throw createEventTypeError(
      EventSubscriberErrorCode.subscriptionHandleProjectionFailed,
      eventErrorText(EventSubscriberErrorCode.subscriptionHandleProjectionFailed),
      error
    )
  }
  return handle
}

/** Builds public subscription handles through the shared raw owner. */
export const createSubscriptionHandle = createRawSubscriptionOwner
