/** An originating invocation owns retry input only while its selected feature may need it. */
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import type {
  IRpcAttempt,
  IRpcAttemptFacts,
  IRpcAttemptOptions,
  IRpcCallFeatures
} from '@migaia/rpc-contract/interfaces'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { RpcCoreErrorText } from '@migaia/rpc-contract/errors'
import { createRpcError, createRpcTimeoutError } from '../host/error-owner.ts'
import type { FeatureScope } from '../feature/scope.ts'
import { resolveAbortReason } from '../host/abort-reason.ts'
import type { ICallCommand, ICallLocalOptions, ICallTargetRef } from './types.ts'

/** Only this explicit port can start an attempt or retire the originating feature execution. */
export type ICallInvocationOwner = Readonly<{
  features: Pick<FeatureScope, 'execute'>
  now(): number
  attempt(
    target: ICallTargetRef,
    command: ICallCommand,
    options: ICallLocalOptions,
    signal: IAbortSignal,
    remainingMs: number | undefined,
    onWritten: () => void,
    attemptOptions?: IRpcAttemptOptions
  ): Promise<unknown>
  remove(invocation: CallInvocation): void
  report(error: unknown): void
}>

/** One Promise surrounds complete retry/timeout instances without embedding either policy. */
export class CallInvocation implements IRpcAttempt<unknown> {
  /** Parent table provides attempts and clocks, never mutable Session state. */
  readonly #owner: ICallInvocationOwner
  /** A narrow address is refreshed by Namespace only when a new attempt actually begins. */
  readonly #target: ICallTargetRef
  /** Selected complete instances stay fixed throughout this originating execution. */
  readonly #selected: IRpcCallFeatures
  /** Retry alone authorizes retaining original business data beyond physical write completion. */
  readonly #retry: boolean
  /** Input exists only until first write without retry, or the final retry result. */
  #command: ICallCommand | undefined
  /** Native transfer/options are released with input rather than retained by compact records. */
  #options: ICallLocalOptions | undefined
  /** Inherited budget begins once, before any attempt or backoff can consume time. */
  readonly #deadline: number | undefined
  /** Host shutdown can cancel a feature's backoff even when no pending attempt exists. */
  readonly #controller = new AbortController()
  /** The caller source is separate from the internal attempt controller and its cleanup. */
  readonly #caller: IAbortSignal | undefined
  /** Successful registration owns exactly one bridge cleanup. */
  #listening = false
  /** Cleanup during a synchronous registration callback waits until that acquisition returns. */
  #registering = false
  /** A close reentering registration still removes the eventual acquired caller bridge once. */
  #removeAfterRegistration = false
  /** Caller reason is captured before notification, including reentrant supported getter behavior. */
  #callerCancelled = false
  /** Public completion can preserve host close identity before cancelling feature-owned work. */
  readonly #completion = deferred<unknown>()
  /** First originating settlement wins over late attempt or feature completion. */
  #settled = false
  /** The same originating budget is supplied to retry, never restarted for later attempts. */
  readonly remainingMs: number | undefined
  /** The real host/native admission supplies immutable facts for this originating execution. */
  readonly facts: IRpcAttemptFacts | undefined

  /** Capture input and the already selected feature pair before invoking any user feature. */
  constructor(
    owner: ICallInvocationOwner,
    target: ICallTargetRef,
    command: ICallCommand,
    options: ICallLocalOptions,
    selected: IRpcCallFeatures,
    facts?: IRpcAttemptFacts
  ) {
    this.#owner = owner
    this.#target = target
    this.#command = command
    this.#options = options
    this.#selected = selected
    this.#retry = Boolean(selected.retry)
    this.#caller = options.signal
    this.remainingMs = options.remainingMs
    this.facts = facts
    this.#deadline =
      options.remainingMs === undefined ? undefined : owner.now() + options.remainingMs
  }

  /** Features receive a controller owned by this originating execution, not the caller's object. */
  get signal(): IAbortSignal {
    return this.#controller.signal
  }

  /** Register caller cancellation, then execute the selected complete feature instances once. */
  start(): Promise<unknown> {
    try {
      if (this.#caller) {
        this.#listening = true
        this.#registering = true
        try {
          this.#caller.addEventListener('abort', this.#abort, { once: true })
        } catch (cause) {
          throw createRpcError(
            RpcCoreErrorCode.invalidConfig,
            RpcCoreErrorText.abortSignalInvalid,
            cause
          )
        } finally {
          this.#registering = false
          if (this.#removeAfterRegistration) this.#cleanup()
        }
        if (this.#settled) {
          this.#cleanup()
          return this.#completion.promise
        }
        if (this.#caller.aborted) this.#abort()
      }
      if (this.#settled) return this.#completion.promise
      Promise.resolve(
        this.#owner.features.execute(this.#target.namespace, this.#selected, this)
      ).then(
        (value) => this.#finish(true, value),
        (error: unknown) => this.#finish(false, error)
      )
    } catch (error) {
      this.#finish(false, error)
    }
    return this.#completion.promise
  }

  /** Intersect actual elapsed inherited time with the feature-selected attempt budget. */
  readonly invoke = (
    signal: IAbortSignal,
    remainingMs?: number,
    attemptOptions?: IRpcAttemptOptions
  ): Promise<unknown> => {
    try {
      /** A selected timeout may shorten this attempt but can never renew its upstream deadline. */
      const inherited =
        this.#deadline === undefined
          ? undefined
          : Math.max(0, Math.floor(this.#deadline - this.#owner.now()))
      /** The two fixed bounds do not need a generic policy merge or timer in host. */
      const budget =
        inherited === undefined
          ? remainingMs
          : remainingMs === undefined
            ? inherited
            : Math.min(inherited, remainingMs)
      if (budget !== undefined && budget <= 0) throw createRpcTimeoutError()
      return this.#owner.attempt(
        this.#target,
        this.#command!,
        this.#options!,
        signal,
        budget,
        this.#written,
        attemptOptions
      )
    } catch (error) {
      return Promise.reject(error)
    }
  }

  /** Host close first settles the original error, then interrupts feature-owned timers/backoff. */
  close(reason: unknown): void {
    if (this.#settled) return
    this.#finish(false, reason)
    this.#controller.abort(reason)
  }

  /** This callback owns no payload capture; no-retry input can disappear before the reply arrives. */
  readonly #written = (): void => {
    if (!this.#retry) {
      this.#command = undefined
      this.#options = undefined
    }
  }

  /** Read the original caller reason once before its controller notifies attempt listeners. */
  readonly #abort = (): void => {
    if (this.#callerCancelled) return
    this.#callerCancelled = true
    this.#controller.abort(resolveAbortReason(this.#caller!))
  }

  /** Drop input/options and caller bridges before exposing the final originating result. */
  #finish(success: boolean, value: unknown): void {
    if (this.#settled) return
    this.#settled = true
    this.#command = undefined
    this.#options = undefined
    this.#cleanup()
    this.#owner.remove(this)
    if (success) this.#completion.resolve(value)
    else this.#completion.reject(value)
  }

  /** Only an actually acquired bridge is removed; compact notify keeps its independent listener. */
  #cleanup(): void {
    if (!this.#listening) return
    if (this.#registering) {
      this.#removeAfterRegistration = true
      return
    }
    this.#listening = false
    try {
      this.#caller!.removeEventListener('abort', this.#abort)
    } catch (error) {
      this.#owner.report(error)
    }
  }
}
