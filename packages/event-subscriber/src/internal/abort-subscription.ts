/**
 * Owns signal observation, subscription rollback and abort overlay state; no dispatch membership is
 * stored here.
 */
import type { IAbortSignal } from '@migaia/utils/promise'
import { tryReadProperty } from '@migaia/utils/error'
import { EventSubscriberErrorCode } from '../error-code.js'
import {
  attachEventErrorCode,
  codeExistingError,
  createEventTypeError,
  eventErrorText
} from '../errors.js'
import type { IEventChannelLike, IEventContext, IEventListener, IUnsubscribe } from '../types.js'
import { EventSubscriberState } from '../state-constants.js'
import { copyEventProjection, type IEventProjectionPlan } from '../value-projection.js'
import { channelCapabilities } from './channel-capability.js'
import type { IValidatedChannel } from './channel-options.js'
import { installSubscriptionSource } from './subscription.js'
import { SIGNAL_REASON_PROPERTY } from './source-state.js'

/** State read by contexts retained after signal or source release. */
type IAbortOverlayState = {
  /** Signal cancellation augments the source registration's own cancellation state. */
  overlayAborted: boolean
  /** Signal reason retains its identity once captured. */
  overlayReason: unknown
}

/** Explicit installation state preserves the two-phase observer/source rollback protocol. */
type IAbortSubscriptionState = IAbortOverlayState & {
  /** Reason probing is getter-once across callback and the final aborted read. */
  captured: boolean
  /** Cached hostile reason-getter outcome is rethrown without probing again. */
  captureFailed: boolean
  captureFailure: unknown
  /** The source disposer becomes available only after installation returns. */
  sourceRelease: IUnsubscribe
  /** Releases the acquired source registration at most once. */
  released: boolean
  /** Records attempted observer installation so partial acquisition can roll back. */
  abortInstallAttempted: boolean
  /** Source failures keep their existing boundary identity on rollback. */
  sourceSubscriptionFailed: boolean
  /** Removal requested inside addEventListener waits until installation completes. */
  observerInstallComplete: boolean
  removeRequested: boolean
  /** The signal listener is removed at most once after installation completes. */
  observerRemoved: boolean
}

/** Retains a source context and signal overlay while keeping the public own-property descriptors. */
class AbortEventOverlay<T> {
  /** Source context remains responsible for payload, task tags and registration controls. */
  readonly #source: IEventContext<T>
  /** Signal state stays live when the listener retains this event after delivery. */
  readonly #state: IAbortOverlayState
  /** Plain context preserves the incumbent getter/method order and projection descriptors. */
  readonly event: IEventContext<T>

  /** Adds signal cancellation without changing payload identity or registration ownership. */
  constructor(
    source: IEventContext<T>,
    state: IAbortOverlayState,
    plan: IEventProjectionPlan | undefined
  ) {
    this.#source = source
    this.#state = state
    this.event = AbortEventOverlay.#createEvent(this, source, plan)
  }

  /** Builds the original plain surface; descriptor callbacks receive their explicit owner. */
  static #createEvent<U>(
    owner: AbortEventOverlay<U>,
    source: IEventContext<U>,
    plan: IEventProjectionPlan | undefined
  ): IEventContext<U> {
    return copyEventProjection(
      {
        /** Payload of the source event. */
        get value() {
          return owner.#source.value
        },
        /** Signal cancellation augments source registration cancellation. */
        get aborted() {
          return owner.#state.overlayAborted || owner.#source.aborted
        },
        /** The signal reason wins only after signal cancellation. */
        get abortReason() {
          return owner.#state.overlayAborted
            ? owner.#state.overlayReason
            : owner.#source.abortReason
        },
        /** Snapshot task tag remains owned by the source dispatch. */
        get taskId() {
          return owner.#source.taskId
        },
        /** Cancels the source registration. */
        abort(reason?: unknown) {
          owner.#source.abort(reason)
        },
        /** Retags future source dispatches. */
        setTaskId(taskId: string | undefined) {
          owner.#source.setTaskId(taskId)
        }
      },
      source,
      plan
    )
  }
}

/** Owns one signal listener and one source registration through installation, abort and release. */
export class AbortSubscription<T, R, V> {
  /** Channel identity selects the original projection plan for overlay contexts. */
  readonly #channel: IEventChannelLike<T, R, V>
  /** Validated source preserves receiver-sensitive structural subscribe methods. */
  readonly #validated: IValidatedChannel<T, R, V>
  /** Signal owns the callback until explicit removal completes. */
  readonly #signal: IAbortSignal
  /** Business callback is never called during source installation. */
  readonly #listener: IEventListener<T, R, V>
  /** Registration option is read once before state acquisition. */
  readonly #taskId: string | undefined
  /** Strict admission also applies to an abort detected by the post-install read. */
  readonly #throwOnAborted: boolean
  /** All mutable installation and retained-context state belongs to this subscription. */
  readonly #state: IAbortSubscriptionState = {
    overlayAborted: false,
    overlayReason: undefined,
    captured: false,
    captureFailed: false,
    captureFailure: undefined,
    sourceRelease: () => undefined,
    released: false,
    abortInstallAttempted: false,
    sourceSubscriptionFailed: false,
    observerInstallComplete: false,
    removeRequested: false,
    observerRemoved: false
  }

  /** Captures already-admitted inputs without acquiring any signal/source resources. */
  constructor(
    channel: IEventChannelLike<T, R, V>,
    validated: IValidatedChannel<T, R, V>,
    signal: IAbortSignal,
    listener: IEventListener<T, R, V>,
    taskId: string | undefined,
    throwOnAborted: boolean
  ) {
    this.#channel = channel
    this.#validated = validated
    this.#signal = signal
    this.#listener = listener
    this.#taskId = taskId
    this.#throwOnAborted = throwOnAborted
  }

  /**
   * Reads the signal's abort reason once and returns the same value, or rethrows the same failure,
   * on later calls.
   */
  #captureReason(): unknown {
    if (this.#state.captured) {
      if (this.#state.captureFailed) throw this.#state.captureFailure
      return this.#state.overlayReason
    }
    this.#state.captured = true
    /** Cache the first getter outcome so repeated abort paths retain identity. */
    const read = tryReadProperty(this.#signal, SIGNAL_REASON_PROPERTY)
    if (read.threw) {
      this.#state.captureFailed = true
      throw (this.#state.captureFailure = read.error)
    }
    return (this.#state.overlayReason = read.value)
  }
  /**
   * Removes the abort listener once. Before installation finishes the removal is deferred unless
   * `force` is set.
   */
  #removeObserver(force = false): void {
    this.#state.removeRequested = true
    if (this.#state.observerRemoved || (!this.#state.observerInstallComplete && !force)) return
    this.#state.observerRemoved = true
    this.#signal.removeEventListener(EventSubscriberState.abort, this.#abortListener)
  }
  /** Releases the source subscription once. */
  #release(): void {
    if (this.#state.released) return
    this.#state.released = true
    try {
      this.#state.sourceRelease()
    } catch (error) {
      throw codeExistingError(error, EventSubscriberErrorCode.invalidSignal)
    }
  }
  /**
   * Finishes an abort: reads the reason, removes the listener and releases the subscription.
   * Failures are collected and thrown together as `INVALID_SIGNAL`, with the first one as `cause`.
   */
  #completeAbort(removeSignalListener: boolean): void {
    /** Failure thrown while reading the abort reason. */
    let primary: unknown
    /** Whether reading the abort reason failed. */
    let hasPrimary = false
    /** Failures from removing the listener and releasing the subscription. */
    const cleanup: unknown[] = []
    try {
      this.#captureReason()
    } catch (error) {
      primary = codeExistingError(error, EventSubscriberErrorCode.invalidSignal)
      hasPrimary = true
    }
    if (removeSignalListener) {
      try {
        this.#removeObserver()
      } catch (error) {
        cleanup.push(error)
      }
    }
    try {
      this.#release()
    } catch (error) {
      cleanup.push(error)
    }
    if (hasPrimary || cleanup.length > 0) {
      /** All failures, the primary one first. */
      const errors = [...(hasPrimary ? [primary] : []), ...cleanup]
      /** First failure; becomes the aggregate's `cause`. */
      const first = errors[0]
      throw attachEventErrorCode(
        new AggregateError(errors, eventErrorText(EventSubscriberErrorCode.invalidSignal), {
          cause: first
        }),
        EventSubscriberErrorCode.invalidSignal
      )
    }
  }
  /** Abort listener installed on the signal. */
  readonly #abortListener = (): void => {
    if (this.#state.released) return
    this.#state.overlayAborted = true
    this.#completeAbort(true)
  }
  /** Copies a source context's alias after adding the live signal overlay. */
  #eventWrapper(sourceEvent: IEventContext<T>): IEventContext<T> {
    return new AbortEventOverlay(
      sourceEvent,
      this.#state,
      channelCapabilities.get(this.#channel as object)?.plan
    ).event
  }

  /**
   * Installs observation before registration and closes the check/register race with one final
   * read.
   */
  install(): IUnsubscribe {
    try {
      this.#state.abortInstallAttempted = true
      this.#signal.addEventListener(EventSubscriberState.abort, this.#abortListener, { once: true })
      this.#state.observerInstallComplete = true
      if (this.#state.removeRequested) this.#removeObserver()
      try {
        this.#state.sourceRelease = installSubscriptionSource<
          Parameters<IEventListener<T, R, V>>[0],
          R | PromiseLike<R>
        >(
          (wrapped) =>
            this.#validated.subscribe(
              wrapped,
              this.#taskId === undefined ? undefined : { taskId: this.#taskId }
            ),
          (event) => {
            if (this.#state.released) return undefined as R
            if (this.#state.overlayAborted) return undefined as R
            /** Preserve the plain callback receiver used by the original helper. */
            const listener = this.#listener
            return listener(this.#eventWrapper(event) as never)
          },
          EventSubscriberErrorCode.invalidSignal,
          () => this.#state.released || this.#state.overlayAborted
        )
      } catch (error) {
        this.#state.sourceSubscriptionFailed = true
        throw error
      }
      if (this.#state.released) this.#state.sourceRelease()
      /** Second read of `signal.aborted`, catching an abort during installation. */
      const secondAborted = this.#signal.aborted
      if (typeof secondAborted !== 'boolean') {
        throw createEventTypeError(
          EventSubscriberErrorCode.invalidSignal,
          eventErrorText(EventSubscriberErrorCode.invalidSignal)
        )
      }
      if (secondAborted) {
        this.#state.overlayAborted = true
        this.#completeAbort(true)
        if (this.#throwOnAborted)
          throw createEventTypeError(
            EventSubscriberErrorCode.aborted,
            eventErrorText(EventSubscriberErrorCode.aborted)
          )
      }
    } catch (primary) {
      this.#rollback(primary)
    }
    return () => this.#unsubscribe()
  }

  /** Rolls back only acquired resources and leaves the primary failure first in every error chain. */
  #rollback(primary: unknown): never {
    /** Failures from rolling back a partly installed subscription. */
    const cleanup: unknown[] = []
    this.#state.observerInstallComplete = true
    if (this.#state.abortInstallAttempted) {
      try {
        this.#removeObserver(true)
      } catch (error) {
        cleanup.push(error)
      }
    }
    try {
      this.#release()
    } catch (error) {
      cleanup.push(error)
    }
    if (cleanup.length > 0) {
      throw attachEventErrorCode(
        new AggregateError(
          [primary, ...cleanup],
          eventErrorText(EventSubscriberErrorCode.invalidSignal),
          { cause: primary }
        ),
        EventSubscriberErrorCode.invalidSignal
      )
    }
    /** Whether the primary failure already carries a `code`. */
    let hasExistingCode = false
    try {
      hasExistingCode =
        ((typeof primary === 'object' && primary !== null) || typeof primary === 'function') &&
        'code' in primary
    } catch {
      throw codeExistingError(primary, EventSubscriberErrorCode.invalidSignal)
    }
    if (hasExistingCode) throw primary
    if (this.#state.sourceSubscriptionFailed) throw primary
    throw codeExistingError(primary, EventSubscriberErrorCode.invalidSignal)
  }

  /**
   * Removes the observer before releasing the source; each cleanup is attempted even if the other
   * fails.
   */
  #unsubscribe(): void {
    if (this.#state.observerRemoved && this.#state.released) return
    /** Failure thrown while removing the abort listener. */
    let removeError: unknown
    /** Whether removing the abort listener failed. */
    let hasRemoveError = false
    /** Failure thrown while releasing the source subscription. */
    let releaseError: unknown
    /** Whether releasing the source subscription failed. */
    let hasReleaseError = false
    try {
      this.#removeObserver()
    } catch (error) {
      hasRemoveError = true
      removeError = error
    }
    try {
      this.#release()
    } catch (error) {
      hasReleaseError = true
      releaseError = error
    }
    if (hasRemoveError && hasReleaseError) {
      /** Removal failure, coded as `INVALID_SIGNAL`; it stays first in the aggregate. */
      const primary = codeExistingError(removeError, EventSubscriberErrorCode.invalidSignal)
      /** Release failure, coded as `INVALID_SIGNAL`. */
      const secondary = codeExistingError(releaseError, EventSubscriberErrorCode.invalidSignal)
      throw attachEventErrorCode(
        new AggregateError(
          [primary, secondary],
          eventErrorText(EventSubscriberErrorCode.invalidSignal),
          { cause: primary }
        ),
        EventSubscriberErrorCode.invalidSignal
      )
    }
    if (hasRemoveError) throw codeExistingError(removeError, EventSubscriberErrorCode.invalidSignal)
    if (hasReleaseError)
      throw codeExistingError(releaseError, EventSubscriberErrorCode.invalidSignal)
  }
}
