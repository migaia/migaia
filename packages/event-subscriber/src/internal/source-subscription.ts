/** Owns structural subscription helpers; source installation stays in the shared subscription owner. */
import { validateEventListener } from './channel-options.ts'
import { admitAbortSignal, type IAbortSignal } from '@migaia/utils/promise'
import { EventSubscriberErrorCode } from '../error-code.ts'
import { codeExistingError, createEventTypeError, eventErrorText } from '../errors.ts'
import type { IEventChannelLike, IEventContext, IEventListener, IUnsubscribe } from '../types.ts'
import { validateChannelLike, readTaskOption, type IValidatedChannel } from './channel-options.ts'
import { channelCapabilities } from './channel-capability.ts'
import { isRecord } from './record.ts'
import { installSubscriptionSource } from './subscription.ts'
import { AbortSubscription } from './abort-subscription.ts'
import { INVALID_SIGNAL_ADMISSION, ABORTED_SIGNAL_GETTER_FAILURE } from './source-state.ts'

/** Owns once-only delivery while preserving the source disposer returned to the caller. */
class OnceSubscription<T, R, V> {
  /** Structural source invokes subscribe with its original receiver. */
  readonly #channel: IValidatedChannel<T, R, V>
  /** Business listener starts only after the once registration has been revoked. */
  readonly #listener: IEventListener<T, R, V>
  /** Task selection option is admitted once before any registration. */
  readonly #taskId: string | undefined
  /** A source callback cannot deliver a second time after the first invocation throws or rejects. */
  #fired = false
  /** Source disposer is assigned after installation and retained with its original identity. */
  #release: IUnsubscribe = () => undefined

  /** Captures admitted inputs without invoking the source or business listener. */
  constructor(
    channel: IValidatedChannel<T, R, V>,
    listener: IEventListener<T, R, V>,
    taskId: string | undefined
  ) {
    this.#channel = channel
    this.#listener = listener
    this.#taskId = taskId
  }

  /** Installs through the canonical source protocol and returns exactly its disposer. */
  install(): IUnsubscribe {
    this.#release = installSubscriptionSource<
      Parameters<IEventListener<T, R, V>>[0],
      R | PromiseLike<R>
    >(
      (wrapped) =>
        this.#channel.subscribe(
          wrapped,
          this.#taskId === undefined ? undefined : { taskId: this.#taskId }
        ),
      (event) => this.#deliver(event)
    )
    return this.#release
  }

  /** Revokes before delivery so synchronous reentry cannot call the business listener again. */
  #deliver(event: Parameters<IEventListener<T, R, V>>[0]): R | PromiseLike<R> {
    if (this.#fired) return undefined as R
    this.#fired = true
    this.#release()
    /** Call the business listener as a plain function, preserving its original receiver. */
    const listener = this.#listener
    return listener(event)
  }
}

/**
 * Subscribes an object whose handle method receives events with the object as its receiver. Use for
 * subscribers that keep instance or private-field state. The current handle method is read on each
 * delivery, so no bind or cached receiver-changing wrapper is required.
 *
 * Accepts canonical, styled, or compatible structural channels and returns an idempotent canonical
 * unsubscribe function without style aliases. The source must return a callable release function
 * and must not deliver during subscribe. Invalid objects/methods throw INVALID_SUBSCRIBER;
 * malformed sources or installation-time delivery throw INVALID_CHANNEL, with owned release run
 * before a rejected installation exits. Listener failures follow the source dispatch policy.
 */
export const subscribeSubscriber = <T, R>(
  channel: IEventChannelLike<T, R>,
  subscriber: { readonly handle?: unknown }
): IUnsubscribe => {
  /** Channel after structural validation. */
  const validated = validateChannelLike<T, R>(channel)
  /** Raw `handle` member of the subscriber, read once. */
  let handleValue: unknown
  try {
    if (!isRecord(subscriber)) {
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidSubscriber,
        eventErrorText(EventSubscriberErrorCode.invalidSubscriber)
      )
    }
    handleValue = subscriber.handle
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidSubscriber)
  }
  if (typeof handleValue !== 'function') {
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidSubscriber,
      eventErrorText(EventSubscriberErrorCode.invalidSubscriber)
    )
  }
  /** Subscriber whose `handle` has been checked to be callable. */
  const typedSubscriber = subscriber as {
    handle(event: IEventContext<T>): R | PromiseLike<R>
  }
  try {
    return installSubscriptionSource<IEventContext<T>, R | PromiseLike<R>>(
      (wrapped) => validated.subscribe(wrapped),
      (event) => typedSubscriber.handle(event)
    )
  } catch (error) {
    /** Whether the thrown value already carries a `code`, in which case it is rethrown unchanged. */
    let hasCode = false
    try {
      hasCode =
        ((typeof error === 'object' && error !== null) || typeof error === 'function') &&
        'code' in error
    } catch {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
    }
    if (hasCode) throw error
    throw codeExistingError(error, EventSubscriberErrorCode.invalidChannel)
  }
}

/**
 * Delivers at most one event and unsubscribes before calling the listener. Use when the listener
 * can publish synchronously again: reentry, a throw, or a rejected result cannot make this
 * registration fire twice. Optional taskId is forwarded without a default label.
 *
 * Accepts canonical/styled channels and structural sources that return a callable release handle
 * without delivering during installation. Returns an idempotent canonical unsubscribe function,
 * without style aliases. Invalid channel, listener, options, or taskId inputs throw their matching
 * INVALID_* errors before delivery. Listener returns and failures follow the source dispatcher.
 */
export const subscribeOnce = <T, R, V = undefined>(
  channel: IEventChannelLike<T, R, V>,
  listener: IEventListener<T, R, V>,
  options?: { readonly taskId?: string }
): IUnsubscribe => {
  /** Channel after structural validation. */
  const validated = validateChannelLike<T, R, V>(channel)
  /** Validated task name forwarded to the source subscription. */
  const taskId = readTaskOption(options)
  validateEventListener(listener)

  return new OnceSubscription(validated, listener, taskId).install()
}

/**
 * Keeps a subscription until manual release or signal abort, then removes both owned listeners.
 * Accepts a standard AbortSignal or compatible object with boolean aborted and callable abort-event
 * add/remove methods. Optional taskId is forwarded without a default label. Aborting updates the
 * running context's aborted/abortReason values but does not interrupt code already executing.
 *
 * An already-aborted signal creates no registration and normally returns a no-op unsubscribe; a
 * canonical channel with throwOnAborted true throws ABORTED instead. Aborts during installation
 * also release any acquired registration before returning or throwing. Invalid inputs and cleanup
 * failures leave as coded errors, with INVALID_SIGNAL preserving signal/cleanup failures. The
 * returned idempotent function has canonical naming, without the channel's style aliases.
 */
export const subscribeUntil = <T, R, V = undefined>(
  channel: IEventChannelLike<T, R, V>,
  signal: IAbortSignal,
  listener: IEventListener<T, R, V>,
  options?: { readonly taskId?: string }
): IUnsubscribe => {
  /** Channel after structural validation. */
  const validated = validateChannelLike<T, R, V>(channel)
  /** Validated task name forwarded to the source subscription. */
  const taskId = readTaskOption(options)
  validateEventListener(listener)

  /** Result of checking the signal at subscription time: invalid, already aborted, or usable. */
  let admission
  try {
    if (!isRecord(signal))
      throw createEventTypeError(
        EventSubscriberErrorCode.invalidSignal,
        eventErrorText(EventSubscriberErrorCode.invalidSignal)
      )
    admission = admitAbortSignal(signal)
  } catch (error) {
    throw codeExistingError(error, EventSubscriberErrorCode.invalidSignal)
  }
  if (admission.kind === INVALID_SIGNAL_ADMISSION) {
    // A hostile `aborted` getter threw the caller's own value; the shared validator captures it
    // rather than letting it escape, so this is the throw site that owns its identity. Coding it in
    // place keeps `thrown === original` and its native type, which is what the incumbent did by
    // reading `aborted` inside the try. A shape this package rejected itself has no such original.
    if (admission.reason === ABORTED_SIGNAL_GETTER_FAILURE)
      throw codeExistingError(admission.cause, EventSubscriberErrorCode.invalidSignal)
    throw createEventTypeError(
      EventSubscriberErrorCode.invalidSignal,
      eventErrorText(EventSubscriberErrorCode.invalidSignal),
      admission.cause
    )
  }
  /** Whether the channel was created to throw instead of ignoring an already-aborted signal. */
  const throwOnAborted = channelCapabilities.get(channel as object)?.options.throwOnAborted === true
  if (admission.aborted) {
    if (throwOnAborted)
      throw createEventTypeError(
        EventSubscriberErrorCode.aborted,
        eventErrorText(EventSubscriberErrorCode.aborted)
      )
    return () => undefined
  }
  return new AbortSubscription(
    channel,
    validated,
    signal,
    listener,
    taskId,
    throwOnAborted
  ).install()
}
