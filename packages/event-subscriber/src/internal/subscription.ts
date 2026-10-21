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
  /** The handle itself under a readable name. */
  readonly unsubscribe: ISubscriptionHandle<T>
  /** Adds another registration to the chain and returns the same handle. */
  readonly subscribe: (...args: never[]) => ISubscriptionHandle<T>
}

/**
 * Builds the callable handle of a subscription chain. Calling the handle or `unsubscribe` releases
 * every link in reverse order; `subscribe` adds a link; style aliases are added from `stylePlan`.
 */
export const createRawSubscriptionOwner = <T extends ISubscriptionHandle<unknown>>(
  first: () => void,
  extend: (...args: never[]) => void | (() => void),
  stylePlan: IEventApiStylePlan
): T => {
  /** Release functions of the chain, in registration order. */
  const disposers: Array<() => void> = [first]
  /** Set when the chain is released; adding a link afterwards throws `SUBSCRIPTION_CLOSED`. */
  let closed = false
  /**
   * Closes the chain once and runs every disposer in reverse registration order. A failing disposer
   * does not stop later ones: one failure is rethrown unchanged, several are collected into an
   * AggregateError whose `errors` keep the original failures in run order.
   */
  const handle = (() => {
    if (closed) return
    closed = true
    /** Disposer failures collected so every registration is released before reporting. */
    let failures: unknown[] | undefined
    for (let index = disposers.length - 1; index >= 0; index -= 1) {
      try {
        disposers[index]()
      } catch (error) {
        ;(failures ??= []).push(error)
      }
    }
    disposers.length = 0
    if (!failures) return
    if (failures.length === 1) throw failures[0]
    throw createEventAggregateError(
      EventSubscriberErrorCode.subscriptionDisposeFailed,
      failures,
      eventErrorText(EventSubscriberErrorCode.subscriptionDisposeFailed)
    )
  }) as T
  try {
    /** Adds one link to the chain and returns the same handle. */
    const subscribe = (...args: never[]): ISubscriptionHandle<T> => {
      if (closed) {
        throw createEventError(
          EventSubscriberErrorCode.subscriptionClosed,
          eventErrorText(EventSubscriberErrorCode.subscriptionClosed)
        )
      }
      /** Release of the new link, if the extension produced one. */
      const disposer = extend(...args)
      if (typeof disposer === 'function') disposers.push(disposer)
      return handle
    }
    /** Property descriptors of the handle's members. */
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

/** Installs one structural source subscription with the canonical synchronous-delivery guard. */
export const installSubscriptionSource = <TEvent, R>(
  subscribe: (listener: (event: TEvent) => R) => unknown,
  listener: (event: TEvent) => R,
  releaseErrorCode: (typeof EventSubscriberErrorCode)[keyof typeof EventSubscriberErrorCode] = EventSubscriberErrorCode.invalidChannel,
  /** Suppresses an installation-time delivery already made terminal by an outer abort protocol. */
  ignoreSynchronousDelivery: () => boolean = () => false
): IUnsubscribe => {
  /** Release function returned by the source; set once installation succeeds. */
  let sourceRelease: IUnsubscribe | undefined
  /** Set once the source `subscribe` call has returned. */
  let ready = false
  /** Set by the first release request. */
  let released = false
  /** Set once the source release has been called. */
  let sourceReleaseCalled = false
  /**
   * Set when the source delivered an event while `subscribe` was still running, which is not
   * allowed.
   */
  let synchronousDelivery = false
  /**
   * Releases the source once. A release requested during installation runs after the source has
   * returned its release function.
   */
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
  /** Value returned by the source `subscribe`; checked to be a function below. */
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
    /** `INVALID_CHANNEL` error for a source that delivered during installation. */
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
