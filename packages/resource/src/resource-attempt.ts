/**
 * Fetch attempts, Suspense wakeups and retry admission; scheduler and generation mechanics stay in
 * lifecycle.
 */
import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import { attachSecondaryErrors } from '@migaia/utils/error'
import { abortableDelay } from '@migaia/lifecycle'
import { ReactiveErrorPhase } from '@migaia/reactive/extension'
import type { IResourceContext } from './resource-context.ts'
import type { IResourceFetchContext } from './resource-types.ts'
import {
  abortError,
  createCancellationFailure,
  createResourceOptionTypeError,
  createSchedulerFailure
} from './resource-failure.ts'
import { identifyResourceFailure, tagResourceError, type IResourceError } from './errors.ts'
import { ResourceErrorCode } from './error-code.ts'
import { ResourceErrorText } from './error-text.ts'

/** Immutable continuation state is allocated only when a fetcher actually suspends. */
type IResourceAttemptContinuation<T> = {
  /** Resource owns graph, fetcher, retry policy and diagnostics. */
  readonly context: IResourceContext<T>
  /** A Suspense wakeup retains the same request identity. */
  readonly controller: IResourceFetchContext
  /** Suspense is not an ordinary failure and does not advance retry numbering. */
  readonly failureCount: number
  /** The original attempt completion Promise keeps its resolver across wakeups. */
  readonly resolve: (value: T | PromiseLike<T>) => void
  /** The original attempt completion Promise keeps its rejecter across wakeups. */
  readonly reject: (error: unknown) => void
}

/** Runs the synchronous first attempt inside the same native completion Promise executor. */
export function executeResourceFetcher<T>(
  context: IResourceContext<T>,
  controller: IResourceFetchContext,
  failureCount: number
): Promise<T> {
  // The small executor forwards immutable inputs; no mutable component state lives in its closure.
  return new Promise<T>((resolve, reject) =>
    startResourceAttempt(context, controller, failureCount, resolve, reject)
  )
}

/** Runs tracked fetch execution without allocating a per-attempt owner on the normal success path. */
function startResourceAttempt<T>(
  context: IResourceContext<T>,
  controller: IResourceFetchContext,
  failureCount: number,
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (error: unknown) => void
): void {
  if (controller.signal.aborted) {
    reject(abortError(controller.signal.reason))
    return
  }
  /** Only the fetcher's synchronous portion participates in the dependency frame. */
  let fetched: T | PromiseLike<T>
  try {
    // Reflect.apply preserves the original Resource receiver of the private callback field.
    // IGenerationRequest fixes this copied argument to its three public fields.
    fetched = context.tracking.runTracked(() =>
      Reflect.apply(context.fetcher, context.owner, [{ ...controller }])
    )
  } catch (error) {
    handleResourceThrown(context, controller, failureCount, resolve, reject, error)
    return
  }
  // This indivisible native-Promise rejection delivery forwards five immutable inputs only.
  // Its state belongs to the explicit Resource/request context, not shared mutable closure locals.
  void Promise.resolve(fetched).then(resolve, (error) =>
    failResourceAttempt(context, controller, failureCount, resolve, reject, error)
  )
}

/** Captures thrown thenables once and creates continuation ownership only for actual Suspense work. */
function handleResourceThrown<T>(
  context: IResourceContext<T>,
  controller: IResourceFetchContext,
  failureCount: number,
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (error: unknown) => void,
  error: unknown
): void {
  /** Captured then prevents a second hostile getter read. */
  const probe = probeThenable(error)
  if (probe.kind === ThenableProbeKind.failed) {
    reject(
      tagResourceError(
        new AggregateError([error, probe.error], ResourceErrorText.suspenseProbeFailed),
        ResourceErrorCode.suspenseProbeFailed
      )
    )
    return
  }
  if (probe.kind === ThenableProbeKind.notThenable) {
    failResourceAttempt(context, controller, failureCount, resolve, reject, error)
    return
  }
  /** Resumption retains only the original completion callbacks and immutable request inputs. */
  const continuation: IResourceAttemptContinuation<T> = {
    context,
    controller,
    failureCount,
    resolve,
    reject
  }
  void assimilateCapturedThen<void>(probe.thenFn, error)
    .then(() => waitForResourceAttempt(continuation.context, continuation.controller, 0))
    .then(
      () =>
        startResourceAttempt(
          continuation.context,
          continuation.controller,
          continuation.failureCount,
          continuation.resolve,
          continuation.reject
        ),
      reject
    )
}

/** Ordinary failures preserve the existing retry Promise chain and exact final rejection object. */
function failResourceAttempt<T>(
  context: IResourceContext<T>,
  controller: IResourceFetchContext,
  failureCount: number,
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (error: unknown) => void,
  error: unknown
): void {
  void retryResourceFailure(context, error, controller, failureCount).then(resolve, reject)
}

/** Rejects nonsynchronous retry results while observing any captured late rejection. */
function createInvalidRetryPolicyResult<T>(
  context: IResourceContext<T>,
  value: unknown,
  message: string
): IResourceError {
  /** Safe thenable admission preserves getter failures and never re-reads then. */
  const probe = probeThenable(value)
  if (probe.kind === ThenableProbeKind.failed)
    return createResourceOptionTypeError(message, probe.error)
  if (probe.kind === ThenableProbeKind.thenable) {
    void assimilateCapturedThen<void>(probe.thenFn, value).catch((error) =>
      context.runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })
    )
  }
  return createResourceOptionTypeError(message)
}

/** Evaluates one retry decision with the same receiver and runtime result validation. */
function shouldRetryResource<T>(
  context: IResourceContext<T>,
  failureCount: number,
  error: unknown
): boolean {
  if (typeof context.retry === 'number') return failureCount <= context.retry
  /** Policy result is inspected once; an async result is a contract error. */
  // The argument pair is fixed by IResourceRetryPolicy, independent of request/retry counts.
  const result = Reflect.apply(context.retry, context.owner, [failureCount, error]) as unknown
  if (typeof result !== 'boolean')
    throw createInvalidRetryPolicyResult(context, result, ResourceErrorText.retryInvalid)
  return result
}

/** Evaluates one retry delay without changing its getter/call or failure-attachment order. */
function resourceRetryDelay<T>(
  context: IResourceContext<T>,
  failureCount: number,
  error: unknown
): number {
  if (typeof context.retryDelay === 'number') return context.retryDelay
  /** Dynamic delay must be a synchronous number before numeric range admission. */
  // The argument pair is fixed by IResourceOptions.retryDelay, independent of runtime collection sizes.
  const result = Reflect.apply(context.retryDelay, context.owner, [failureCount, error]) as unknown
  if (typeof result !== 'number')
    throw createInvalidRetryPolicyResult(context, result, ResourceErrorText.retryDelayInvalid)
  return result
}

/** Admits one ordinary retry, preserving the original nested completion Promise chain. */
function retryResourceFailure<T>(
  context: IResourceContext<T>,
  error: unknown,
  controller: IResourceFetchContext,
  failureCount: number
): Promise<T> {
  if (controller.signal.aborted) return Promise.reject(abortError(controller.signal.reason))
  /** Failure numbering starts at one for the first rejected attempt. */
  const nextFailureCount = failureCount + 1
  /** Decision admission can fail independently from delay admission. */
  let shouldRetry: boolean
  try {
    shouldRetry = shouldRetryResource(context, nextFailureCount, error)
  } catch (policyError) {
    return Promise.reject(
      identifyResourceFailure(
        attachSecondaryErrors(policyError, [error]),
        ResourceErrorCode.invalidOption,
        ResourceErrorText.retryPolicyFailed
      )
    )
  }
  if (!shouldRetry)
    return Promise.reject(
      identifyResourceFailure(error, ResourceErrorCode.fetchFailed, ResourceErrorText.fetchFailed)
    )
  /** Validated delay is sampled only after the decision permits a retry. */
  let delay: number
  try {
    delay = resourceRetryDelay(context, nextFailureCount, error)
  } catch (policyError) {
    return Promise.reject(
      identifyResourceFailure(
        attachSecondaryErrors(policyError, [error]),
        ResourceErrorCode.invalidOption,
        ResourceErrorText.retryPolicyFailed
      )
    )
  }
  if (!Number.isFinite(delay) || delay < 0)
    return Promise.reject(
      tagResourceError(
        new RangeError(ResourceErrorText.retryDelayInvalid, { cause: error }),
        ResourceErrorCode.invalidOption
      )
    )
  return waitForResourceAttempt(context, controller, delay).then(() =>
    executeResourceFetcher(context, controller, nextFailureCount)
  )
}

/** Shares timer cancellation and scheduler-failure policy between retry and Suspense waits. */
function waitForResourceAttempt<T>(
  context: IResourceContext<T>,
  controller: IResourceFetchContext,
  delay: number
): Promise<void> {
  return abortableDelay(context.scheduler, delay, controller.signal, (error) =>
    reportResourceWaitCleanup(context, error)
  ).then(
    (elapsed) => {
      if (!elapsed || controller.signal.aborted) throw abortError(controller.signal.reason)
    },
    (error: unknown) => rejectResourceWait(context, controller, error)
  )
}

/** Resource cancellation retains its AbortError; wait-cleanup failure remains diagnostic-only. */
function reportResourceWaitCleanup<T>(context: IResourceContext<T>, error: unknown): void {
  context.runtime.reportError(createCancellationFailure(error), {
    phase: ReactiveErrorPhase.asyncFlush
  })
}

/** Applies cancellation precedence after a failed scheduler wait. */
function rejectResourceWait<T>(
  context: IResourceContext<T>,
  controller: IResourceFetchContext,
  error: unknown
): never {
  if (controller.signal.aborted) {
    reportResourceWaitCleanup(context, error)
    throw abortError(controller.signal.reason)
  }
  throw createSchedulerFailure(error)
}
