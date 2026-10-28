/**
 * Owns publish transactions, queued reentrancy and native-stack spill draining. Registration
 * membership and context projection remain composed services; no style work enters dispatch.
 */
import { MAX_NATIVE_RECURSION_DEPTH } from '@migaia/utils/function'
import { EventSubscriberErrorCode } from '../error-code.js'
import { createEventAggregateError, eventErrorText } from '../errors.js'
import { EventDispatchPolicy, type IEventDispatchPolicy } from '../state-constants.js'
import type { IEventChannelOptions } from '../types.js'
import {
  projectEventValue,
  reportEventProjectionFailure,
  type IEventProjectionPlan
} from '../value-projection.js'
import { createEventContext, invokeDispatchSnapshot } from './dispatch-context.js'
import { observeDispatchRejection } from './listener-reporting.js'
import type { ChannelRegistrations } from './channel-registrations.js'

/** A channel's synchronous publish state, shared across nested dispatches in one transaction. */
export class ChannelDispatch<T, R, V> {
  /** Registration owner provides fixed delivery-order snapshots. */
  readonly #registrations: ChannelRegistrations<T, R, V>
  /** Admitted reporting options retained for late Promise rejection. */
  readonly #options: IEventChannelOptions<T, undefined, V>
  /** Optional static alias projection, computed once per delivered value. */
  readonly #plan: IEventProjectionPlan | undefined
  /** Selected recursive or queued scheduling contract. */
  readonly #policy: IEventDispatchPolicy
  /** Total listener-call budget for each top-level transaction. */
  readonly #budget: number
  /** Whether a queued drain currently owns the value cursor. */
  #publishing = false
  /** Pending queued values and reverse spill stack, reset at the next root transaction. */
  readonly #pendingValues: T[] = []
  /** Cursor avoids removing the front of the growable pending array. */
  #pendingIndex = 0
  /** Calls still available to the current root transaction. */
  #remaining = 0
  /** Tracks omitted targets even after the value queue is empty. */
  #budgetExhausted = false
  /** Synchronous failures collected in listener execution order. */
  #failures: unknown[] = []
  /** Native recursion depth controls the existing stack-spill boundary. */
  #nativeDepth = 0
  /** Nested values captured at the stack boundary before returning to the drain. */
  #spillCapture: T[] | undefined

  /** Installs immutable policy before this channel can publish a value. */
  constructor(
    registrations: ChannelRegistrations<T, R, V>,
    options: IEventChannelOptions<T, undefined, V>,
    plan: IEventProjectionPlan | undefined
  ) {
    this.#registrations = registrations
    this.#options = options
    this.#plan = plan
    this.#policy = options.dispatchPolicy!
    this.#budget = options.publishBudget!
  }

  /** Delivers one value while preserving listener snapshots and late-failure reporting. */
  #dispatchValue(value: T): void {
    // A channel without owners has nothing to snapshot, project, or report.
    if (!this.#registrations.first) return
    ++this.#nativeDepth
    /** Frozen list of registrations taken before any listener runs. */
    const snapshots = this.#registrations.snapshot()
    try {
      /** Value-path projection, computed once for this value. */
      const projection = this.#plan
        ? { plan: this.#plan, outcome: projectEventValue(value, this.#plan) }
        : undefined
      for (const snapshot of snapshots) {
        // Budget exhaustion stops delivery but still reaches the projection report below.
        if (!this.#remaining) {
          this.#budgetExhausted = true
          break
        }
        --this.#remaining
        if (this.#nativeDepth >= MAX_NATIVE_RECURSION_DEPTH) this.#spillCapture = []
        /** Listener return value; checked for a later rejection when it is an object or function. */
        let result: R | PromiseLike<R>
        try {
          result = invokeDispatchSnapshot(snapshot, value, projection)
        } catch (error) {
          this.#failures.push(error)
          continue
        } finally {
          if (this.#spillCapture) {
            while (this.#spillCapture.length) this.#pendingValues.push(this.#spillCapture.pop()!)
            this.#spillCapture = undefined
            if (this.#nativeDepth === MAX_NATIVE_RECURSION_DEPTH)
              while (this.#pendingValues.length && this.#remaining)
                this.#dispatchValue(this.#pendingValues.pop()!)
          }
        }
        // Primitive results cannot be thenables: skip the probe so sync listeners allocate nothing.
        if (result === null || (typeof result !== 'object' && typeof result !== 'function'))
          continue
        // The failure context is built only when a rejection is actually reported.
        observeDispatchRejection(result, { options: this.#options, value, snapshot, projection })
      }
      if (projection?.outcome.diagnostic)
        reportEventProjectionFailure<T, undefined, V>(
          this.#options,
          createEventContext(value, snapshots[0]!, projection),
          projection.outcome.diagnostic
        )
    } finally {
      --this.#nativeDepth
    }
  }

  /** Delivers a value recursively by default, or drains an explicit queued policy. */
  publish(initialValue: T): void {
    /** True when this call starts a new top-level publish and must reset its budget and failures. */
    const rootTransaction = !this.#nativeDepth && !this.#publishing
    if (rootTransaction) {
      this.#remaining = this.#budget
      this.#budgetExhausted = false
      this.#failures = []
      this.#pendingValues.length = 0
      this.#pendingIndex = 0
    }
    try {
      if (this.#policy === EventDispatchPolicy.queued && this.#publishing) {
        this.#pendingValues.push(initialValue)
        return
      }
      if (this.#policy === EventDispatchPolicy.recursive) {
        if (!this.#remaining || this.#nativeDepth >= MAX_NATIVE_RECURSION_DEPTH) {
          if (this.#spillCapture) this.#spillCapture.push(initialValue)
          else this.#pendingValues.push(initialValue)
          return
        }
        this.#dispatchValue(initialValue)
      } else {
        this.#publishing = true
        this.#pendingValues.push(initialValue)
        try {
          while (this.#pendingIndex < this.#pendingValues.length && this.#remaining)
            this.#dispatchValue(this.#pendingValues[this.#pendingIndex++]!)
        } finally {
          this.#publishing = false
        }
      }
      if (
        rootTransaction &&
        (this.#budgetExhausted ||
          this.#failures.length + this.#pendingValues.length - this.#pendingIndex)
      ) {
        /** `PUBLISH_FAILED` aggregate holding every synchronous failure of this publish. */
        const error = createEventAggregateError(
          EventSubscriberErrorCode.publishFailed,
          this.#failures,
          eventErrorText(EventSubscriberErrorCode.publishFailed)
        )
        Object.defineProperty(error, 'detail', {
          enumerable: true,
          value: Object.freeze({
            processed: this.#budget - this.#remaining,
            remaining: this.#remaining,
            causalSummary: Object.freeze(this.#failures)
          })
        })
        throw error
      }
    } finally {
      if (rootTransaction) {
        this.#pendingValues.length = 0
        this.#pendingIndex = 0
        this.#spillCapture = undefined
        this.#failures = []
      }
    }
  }
}
