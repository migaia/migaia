/**
 * Owns callable subscription chains and structural source installation; it does not dispatch
 * events.
 */
import { EventSubscriberErrorCode } from '../error-code.js'
import {
  createEventAggregateError,
  codeExistingError,
  createEventError,
  createEventTypeError,
  eventErrorText
} from '../errors.js'
import type { IUnsubscribe } from '../types.js'
import { EventApiMethod, type IEventApiStylePlan } from '../style.js'

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
): T => new SubscriptionOwner<T>(first, extend).project(stylePlan)

/** Owns ordered releases and exact callable identity independently of its surface callbacks. */
class SubscriptionOwner<T extends ISubscriptionHandle<unknown>> {
  /** Releases retained in registration order; release clears every entry after visiting in reverse. */
  readonly #disposers: Array<() => void>
  /** Extension performs source admission before this owner records the returned release. */
  readonly #extend: (...args: never[]) => void | (() => void)
  /** Terminal marker prevents duplicate cleanup and rejects extension before reading user input. */
  #closed = false
  /** Callable surface retains this owner; all cancellation aliases share this exact identity. */
  readonly #handle: T
  /** Small extension callback retains only this owner and returns its original handle. */
  readonly #subscribe = (...args: never[]): ISubscriptionHandle<T> => {
    if (this.#closed)
      throw createEventError(
        EventSubscriberErrorCode.subscriptionClosed,
        eventErrorText(EventSubscriberErrorCode.subscriptionClosed)
      )
    /** A local call preserves the extension callback's original undefined receiver. */
    const extend = this.#extend
    /** Successful extension transfers one more release into this chain. */
    const disposer = extend(...args)
    if (typeof disposer === 'function') this.#disposers.push(disposer)
    return this.#handle
  }

  /** Acquires the first release before descriptor installation can fail. */
  constructor(first: () => void, extend: (...args: never[]) => void | (() => void)) {
    this.#disposers = [first]
    this.#extend = extend
    this.#handle = (() => this.#release()) as T
  }

  /** Installs immutable aliases, rolling back owned registrations on projection failure. */
  project(stylePlan: IEventApiStylePlan): T {
    try {
      /** Canonical and selected alias descriptors share exact function identities. */
      const descriptors: PropertyDescriptorMap = {
        unsubscribe: {
          value: this.#handle,
          enumerable: false,
          writable: false,
          configurable: false
        },
        subscribe: {
          value: this.#subscribe,
          enumerable: false,
          writable: false,
          configurable: false
        }
      }
      if (stylePlan.subscribe !== EventApiMethod.subscribe)
        descriptors[stylePlan.subscribe] = {
          value: this.#subscribe,
          enumerable: false,
          writable: false,
          configurable: false
        }
      if (stylePlan.unsubscribe !== EventApiMethod.unsubscribe)
        descriptors[stylePlan.unsubscribe] = {
          value: this.#handle,
          enumerable: false,
          writable: false,
          configurable: false
        }
      Object.defineProperties(this.#handle, descriptors)
    } catch (error) {
      try {
        this.#handle()
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
    return this.#handle
  }

  /** Releases in reverse order once, preserving original failures and their execution order. */
  #release(): void {
    if (this.#closed) return
    this.#closed = true
    /** Failures accumulate only when cleanup fails; every remaining release still runs. */
    let failures: unknown[] | undefined
    for (let index = this.#disposers.length - 1; index >= 0; index -= 1) {
      try {
        this.#disposers[index]()
      } catch (error) {
        ;(failures ??= []).push(error)
      }
    }
    this.#disposers.length = 0
    if (!failures) return
    if (failures.length === 1) throw failures[0]
    throw createEventAggregateError(
      EventSubscriberErrorCode.subscriptionDisposeFailed,
      failures,
      eventErrorText(EventSubscriberErrorCode.subscriptionDisposeFailed)
    )
  }
}

/** Installs one structural source subscription with the canonical synchronous-delivery guard. */
export const installSubscriptionSource = <TEvent, R>(
  subscribe: (listener: (event: TEvent) => R) => unknown,
  listener: (event: TEvent) => R,
  releaseErrorCode: (typeof EventSubscriberErrorCode)[keyof typeof EventSubscriberErrorCode] = EventSubscriberErrorCode.invalidChannel,
  /** Suppresses an installation-time delivery already made terminal by an outer abort protocol. */
  ignoreSynchronousDelivery: () => boolean = () => false
): IUnsubscribe =>
  new SubscriptionSourceInstaller(listener, releaseErrorCode, ignoreSynchronousDelivery).install(
    subscribe
  )

/** Owns admission, delivery guarding, and deferred exact-once release of a structural source. */
class SubscriptionSourceInstaller<TEvent, R> {
  /** Caller listener receives only post-installation deliveries. */
  readonly #listener: (event: TEvent) => R
  /** Existing semantic code attached when the source release throws. */
  readonly #releaseErrorCode: (typeof EventSubscriberErrorCode)[keyof typeof EventSubscriberErrorCode]
  /** Outer cancellation protocol can suppress delivery without producing a new admission error. */
  readonly #ignoreSynchronousDelivery: () => boolean
  /** Source release becomes owned only after the subscribe call returns a callable value. */
  #sourceRelease: IUnsubscribe | undefined
  /** True after callable source release admission completes. */
  #ready = false
  /** First release request is remembered even while installation is still running. */
  #released = false
  /** Prevents repeated calls to the source release, including when its first call throws. */
  #sourceReleaseCalled = false
  /** Records unsupported source delivery during installation so admission can roll back. */
  #synchronousDelivery = false
  /** Detached release remains stable for callers and outer cancellation owners. */
  readonly release = (): void => {
    if (this.#released && this.#sourceReleaseCalled) return
    this.#released = true
    if (!this.#ready || this.#sourceReleaseCalled) return
    this.#sourceReleaseCalled = true
    try {
      /** Preserve the release function's original detached receiver. */
      const sourceRelease = this.#sourceRelease
      sourceRelease?.()
    } catch (error) {
      throw codeExistingError(error, this.#releaseErrorCode)
    }
  }

  /** Captures source delivery and failure contracts before calling any user source. */
  constructor(
    listener: (event: TEvent) => R,
    releaseErrorCode: (typeof EventSubscriberErrorCode)[keyof typeof EventSubscriberErrorCode],
    ignoreSynchronousDelivery: () => boolean
  ) {
    this.#listener = listener
    this.#releaseErrorCode = releaseErrorCode
    this.#ignoreSynchronousDelivery = ignoreSynchronousDelivery
  }

  /** Admits the source release, then rolls it back if installation delivered synchronously. */
  install(subscribe: (listener: (event: TEvent) => R) => unknown): IUnsubscribe {
    /** The source callback remains a small bridge into this owner's admission state. */
    const candidate = subscribe((event) => this.#deliver(event))
    if (typeof candidate !== 'function')
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidChannel,
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    this.#sourceRelease = candidate as IUnsubscribe
    this.#ready = true
    if (this.#released) this.release()
    if (this.#synchronousDelivery) this.#rejectSynchronousDelivery()
    return this.release
  }

  /** Drops terminal or installation-time deliveries; admitted listeners retain their raw result. */
  #deliver(event: TEvent): R {
    /** Calls remain detached, matching the structural callback contract. */
    const ignoreSynchronousDelivery = this.#ignoreSynchronousDelivery
    if (this.#released || ignoreSynchronousDelivery()) return undefined as R
    if (!this.#ready) {
      this.#synchronousDelivery = true
      return undefined as R
    }
    /** Original listener is called without borrowing this owner's receiver. */
    const listener = this.#listener
    return listener(event)
  }

  /** Preserves the primary admission failure before any failing rollback release. */
  #rejectSynchronousDelivery(): never {
    /** Native INVALID_CHANNEL error remains first in the rollback failure chain. */
    const primary = createEventTypeError(
      EventSubscriberErrorCode.invalidChannel,
      eventErrorText(EventSubscriberErrorCode.invalidChannel)
    )
    try {
      this.release()
    } catch (error) {
      throw createEventAggregateError(
        EventSubscriberErrorCode.invalidChannel,
        [primary, error],
        eventErrorText(EventSubscriberErrorCode.invalidChannel)
      )
    }
    throw primary
  }
}
