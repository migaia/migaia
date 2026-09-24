import { EventSubscriberErrorCode } from '../error-code.js'
import {
  createEventAggregateError,
  codeExistingError,
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

/** Installs one structural source subscription with the canonical synchronous-delivery guard. */
export const installSubscriptionSource = <TEvent, R>(
  subscribe: (listener: (event: TEvent) => R) => unknown,
  listener: (event: TEvent) => R,
  releaseErrorCode: (typeof EventSubscriberErrorCode)[keyof typeof EventSubscriberErrorCode] = EventSubscriberErrorCode.invalidChannel,
  /** Suppresses an installation-time delivery already made terminal by an outer abort protocol. */
  ignoreSynchronousDelivery: () => boolean = () => false
): IUnsubscribe => {
  let sourceRelease: IUnsubscribe | undefined
  let ready = false
  let released = false
  let sourceReleaseCalled = false
  let synchronousDelivery = false
  const release = (): void => {
    if (released && sourceReleaseCalled) return
    released = true
    if (!ready || sourceReleaseCalled) return
    sourceReleaseCalled = true
    try {
      sourceRelease?.()
    } catch (error) {
      throw codeExistingError(error, releaseErrorCode)
    }
  }
  const candidate = subscribe((event) => {
    if (released || ignoreSynchronousDelivery()) return undefined as R
    if (!ready) {
      synchronousDelivery = true
      return undefined as R
    }
    return listener(event)
  })
  if (typeof candidate !== 'function')
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidChannel,
      eventErrorText(EventSubscriberErrorCode.invalidChannel)
    )
  sourceRelease = candidate as IUnsubscribe
  ready = true
  if (released) release()
  if (synchronousDelivery) {
    const primary = createEventTypeError(
      EventSubscriberErrorCode.invalidChannel,
      eventErrorText(EventSubscriberErrorCode.invalidChannel)
    )
    try {
      release()
    } catch (error) {
      throw createEventAggregateError(
        EventSubscriberErrorCode.invalidChannel,
        [primary, error],
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    }
    throw primary
  }
  return release
}
