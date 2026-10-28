/**
 * Request admission, cancellation and settlement; the explicit context retains generation and
 * public Promise identity without a constructor-owned request closure.
 */
import type { IResourceContext } from './resource-context.ts'
import {
  ignoreResourceRejection,
  calculateExpiresAt,
  readResourceSchedulerNow
} from './resource-cache.ts'
import { LifecycleState, type IGenerationToken } from '@migaia/lifecycle'
import { ReactiveErrorPhase } from '@migaia/reactive/extension'
import { executeResourceFetcher } from './resource-attempt.ts'
import { withResourceAbort } from './resource-abort.ts'
import { scheduleResourceSuspension } from './resource-suspension.ts'
import { tagResourceError } from './errors.ts'
import { ResourceErrorCode } from './error-code.ts'
import { ResourceErrorText } from './error-text.ts'
import {
  abortError,
  ResourceCancelledError,
  createCancellationFailure
} from './resource-failure.ts'
import type { IResourceError } from './errors.ts'
import { ResourceStatus } from './state-constants.ts'

/** Observes an already-public rejection while retaining the original Promise identity. */
export function observeResourcePromise<T>(request: Promise<T>): void {
  void request.catch(ignoreResourceRejection)
}

/** Cancels the active generation and converges pending/SWR state before exposing cleanup failure. */
export function abortResourceRequest<T>(context: IResourceContext<T>, pause: boolean): void {
  if (!context.requestPending) return
  /** Cancellation cleanup must not prevent data/transport state from converging. */
  let cancellationError: IResourceError | undefined
  try {
    context.requests.supersede(abortError())
  } catch (error) {
    cancellationError = createCancellationFailure(error)
  }
  context.requestPending = false
  context.paused = pause
  /** A background refresh preserves old data while a first load enters cancelled/idle. */
  const current = context.stateSignal.peek()
  if (current.status === ResourceStatus.pending) {
    context.stateSignal.value = pause
      ? { status: ResourceStatus.cancelled, error: new ResourceCancelledError() }
      : { status: ResourceStatus.idle }
    if (cancellationError) throw cancellationError
    return
  }
  if (current.status === ResourceStatus.success && current.refreshing === true)
    context.stateSignal.value = { status: ResourceStatus.success, data: current.data }
  if (cancellationError) throw cancellationError
}

/** Admits one generation and retains the public Promise slot across synchronous fetcher reentry. */
export function startResourceRequest<T>(context: IResourceContext<T>): Promise<T> {
  context.refreshScheduled = false
  context.forceRefresh = false
  context.paused = false
  /** Lifecycle invalidates the previous generation before exposing this request identity. */
  const requestToken = context.requests.begin()
  /** Current-generation token gates both expiry capture and state publication. */
  const token = requestToken.token
  /** Signal is captured before synchronous fetch execution can reenter Resource. */
  const signal = requestToken.signal
  /** A reentrant publisher may replace this slot while the fetcher executes. */
  const previousPromise = context.currentPromise
  context.requestPending = true
  context.settlementExpiry = undefined
  /** SWR preserves the existing success shape during refresh. */
  const current = context.stateSignal.peek()
  if (context.staleWhileRevalidate && current.status === ResourceStatus.success) {
    context.stateSignal.value = { ...current, refreshing: true }
  } else {
    context.stateSignal.value = { status: ResourceStatus.pending }
  }
  /** Resource captures expiry in the original native request reaction, with no forwarding layer. */
  const request = withResourceAbort(
    executeResourceFetcher(context, { signal, generation: requestToken.generation, token }, 0),
    signal,
    context.runtime
  ).then((data) => {
    if (context.requests.isCurrent(token)) {
      /** The whole clock/deadline pair is admitted before any success publication. */
      const updatedAt = readResourceSchedulerNow(context)
      context.settlementExpiry = {
        updatedAt,
        expiresAt: calculateExpiresAt(updatedAt, context.ttl)
      }
    }
    return data
  })
  if (
    context.terminal.lifecycle === LifecycleState.open &&
    context.currentPromise === previousPromise
  )
    context.currentPromise = request
  observeResourceSettlement(context, request, token)
  return request
}

/** Publishes the current request outcome directly in its original native Promise reactions. */
function observeResourceSettlement<T>(
  context: IResourceContext<T>,
  request: Promise<T>,
  token: IGenerationToken
): void {
  void request
    .then(
      (data) => {
        if (
          !context.requests.isCurrent(token) ||
          context.terminal.lifecycle !== LifecycleState.open
        )
          return
        /** Expiry was captured in the preceding request reaction and remains failure-atomic. */
        const expiry = context.settlementExpiry
        context.settlementExpiry = undefined
        if (expiry === undefined)
          throw tagResourceError(
            new RangeError(ResourceErrorText.ttlExpirationOverflow),
            ResourceErrorCode.invalidOption
          )
        context.updatedAt = expiry.updatedAt
        context.expiresAt = expiry.expiresAt
        context.requestPending = false
        context.stateSignal.value = { status: ResourceStatus.success, data }
        if (context.stateSignal.subs.size === 0) scheduleResourceSuspension(context)
      },
      (error: unknown) => {
        if (
          !context.requests.isCurrent(token) ||
          context.terminal.lifecycle !== LifecycleState.open
        )
          return
        context.settlementExpiry = undefined
        context.requestPending = false
        context.stateSignal.value = { status: ResourceStatus.error, error }
        if (context.stateSignal.subs.size === 0) scheduleResourceSuspension(context)
      }
    )
    .catch((error: unknown) =>
      context.runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })
    )
}
