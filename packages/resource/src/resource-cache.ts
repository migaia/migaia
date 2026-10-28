/**
 * Cache time arithmetic and passive clock-failure publication; no scheduler implementation or fetch
 * ownership.
 */
import { ReactiveErrorPhase } from '@migaia/reactive/extension'
import type { IResourceContext } from './resource-context.ts'
import { ResourceStatus } from './state-constants.ts'
import { createSchedulerFailure, isSchedulerFailure } from './resource-failure.ts'
import { tagResourceError } from './errors.ts'
import { ResourceErrorCode } from './error-code.ts'
import { ResourceErrorText } from './error-text.ts'

/** Rejects finite TTL arithmetic that would turn a cache deadline into Infinity. */
export function calculateExpiresAt(updatedAt: number, ttl: number): number {
  if (ttl === Infinity) return Infinity
  /** Candidate deadline stays local until arithmetic admission succeeds. */
  const expiresAt = updatedAt + ttl
  if (!Number.isFinite(expiresAt)) {
    throw tagResourceError(
      new RangeError(ResourceErrorText.ttlExpirationOverflow),
      ResourceErrorCode.invalidOption
    )
  }
  return expiresAt
}

/** Maps host/lifecycle clock failures at the Resource public boundary without replacing their cause. */
export function readResourceSchedulerNow<T>(context: IResourceContext<T>): number {
  try {
    return context.scheduler.now()
  } catch (error) {
    throw createSchedulerFailure(error)
  }
}

/** Tests the current success cache using the existing zero-TTL and clock-read rules. */
export function resourceIsFresh<T>(context: IResourceContext<T>): boolean {
  /** Nontracking visible state determines whether the clock is consulted. */
  const state = context.stateSignal.peek()
  return (
    state.status === ResourceStatus.success &&
    (context.ttl === 0 || readResourceSchedulerNow(context) < context.expiresAt)
  )
}

/** Publishes one stable passive clock error and rejected Promise while preserving cache timestamps. */
export function recordPassiveSchedulerFailure<T>(
  context: IResourceContext<T>,
  error: unknown
): void {
  /** One failure instance is shared by state, Promise and runtime diagnostics. */
  const failure = isSchedulerFailure(error) ? error : createSchedulerFailure(error)
  /** Passive reads retain this exact rejected Promise rather than retrying clock admission. */
  const rejectedPromise = Promise.reject<T>(failure)
  context.settlementExpiry = undefined
  context.requestPending = false
  context.paused = true
  context.refreshScheduled = false
  context.forceRefresh = false
  context.currentPromise = rejectedPromise
  void rejectedPromise.catch(ignoreResourceRejection)
  context.stateSignal.value = { status: ResourceStatus.error, error: failure }
  context.runtime.reportError(failure, { phase: ReactiveErrorPhase.asyncFlush })
}

/** Observes a rejection whose same object is already exposed by public state or Promise. */
export function ignoreResourceRejection(): undefined {
  return undefined
}
