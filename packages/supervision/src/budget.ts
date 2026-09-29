import {
  createAbortController,
  createMutationQueue,
  createStringLeaseRegistry,
  type IAbortSignal
} from '@migaia/lifecycle'
import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import { BudgetRejection } from './constants.js'
import { SupervisionErrorCode } from './error-code.js'
import { SupervisionErrorText } from './error-text.js'
import { createSupervisionError } from './errors.js'
import type { IBudgetOutcome, IUnitBudget, IUnitBudgetOptions, IUnitLease } from './types.js'

/** Rejects a malformed limit before the budget owns any queue or timer. */
function positive(value: unknown, field: string, integer = false, zero = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < (zero ? 0 : Number.EPSILON) ||
    (integer && !Number.isInteger(value))
  )
    throw createSupervisionError(
      RangeError,
      SupervisionErrorCode.invalidOption,
      SupervisionErrorText.invalidOption,
      { detail: { field } }
    )
  return value
}

/** Admits units in FIFO order while retaining lifecycle leases for occupied slots. */
export function createUnitBudget<TKind extends string>(
  options: IUnitBudgetOptions<TKind>
): IUnitBudget<TKind> {
  positive(options.maxUnits, 'maxUnits', true, true)
  const timeoutMs = positive(options.queueTimeoutMs ?? 30_000, 'queueTimeoutMs')
  const rate = options.launchRate === undefined ? { max: 8, windowMs: 1_000 } : options.launchRate
  if (rate !== false) {
    positive(rate.max, 'launchRate.max', true)
    positive(rate.windowMs, 'launchRate.windowMs')
  }
  if (options.parent !== undefined && options.parent.kind !== options.kind)
    throw createSupervisionError(
      TypeError,
      SupervisionErrorCode.invalidOption,
      SupervisionErrorText.invalidOption,
      { detail: { field: 'parent' } }
    )
  /** Runtime-neutral clock and timers, admitted by the lifecycle boundary. */
  const scheduler = resolveSchedulerOption(options) ?? resolveScheduler(systemScheduler)
  /** Lifecycle counter for live unit slots. */
  const leases = createStringLeaseRegistry()
  /** Lifecycle FIFO serializes the head's capacity and parent wait. */
  const queue = createMutationQueue({ scheduler, admissionDiagnosticMs: false })
  /** Grant times still inside the current rate window. */
  const grants: number[] = []
  /** Waiters awakened whenever a lease, timer, or close changes eligibility. */
  const wake = new Set<() => void>()
  /** Cancellation functions for all unresolved public acquisitions. */
  const cancelPending = new Set<(reason: BudgetRejection) => void>()
  /** Number of unresolved acquire calls, including the active queue head. */
  let pending = 0
  /** Whether new admission is disabled; existing leases remain valid. */
  let closed = false

  /** Wakes all eligibility observers; the mutation queue still admits one head. */
  const notify = (): void => {
    for (const listener of wake) listener()
  }
  /** Drops timestamps that no longer consume launch rate. */
  const trim = (): void => {
    if (rate === false) return
    const now = scheduler.now()
    while (grants.length > 0 && now - grants[0]! >= rate.windowMs) grants.shift()
  }
  /** Takes a local lease and, optionally, composes it with an upstream lease. */
  const granted = (parent?: IUnitLease): IBudgetOutcome => {
    const releaseLocal = leases.retain(options.kind)
    let live = true
    return {
      kind: 'granted',
      lease: {
        release() {
          if (!live) return
          live = false
          parent?.release()
          releaseLocal()
          notify()
        }
      }
    }
  }
  /** Checks local instantaneous eligibility without mutating the rate history. */
  const localReason = (): BudgetRejection | undefined => {
    if (closed) return BudgetRejection.closed
    if (leases.count(options.kind) >= options.maxUnits || pending > 0) return BudgetRejection.full
    trim()
    if (rate !== false && grants.length >= rate.max) return BudgetRejection.rateLimited
    return undefined
  }

  return {
    kind: options.kind,
    get inUse() {
      return leases.count(options.kind)
    },
    get pending() {
      return pending
    },
    get closed() {
      return closed
    },
    tryAcquire() {
      const reason = localReason()
      if (reason !== undefined) return { kind: 'rejected', reason }
      const upstream = options.parent?.tryAcquire()
      if (upstream?.kind === 'rejected') return upstream
      if (rate !== false) grants.push(scheduler.now())
      return granted(upstream?.lease)
    },
    acquire(signal?: IAbortSignal) {
      if (closed) return Promise.resolve({ kind: 'rejected', reason: BudgetRejection.closed })
      if (signal?.aborted)
        return Promise.resolve({ kind: 'rejected', reason: BudgetRejection.aborted })
      if (
        options.overflow === 'reject' &&
        (leases.count(options.kind) >= options.maxUnits || pending > 0)
      )
        return Promise.resolve({ kind: 'rejected', reason: BudgetRejection.full })
      /** Combined cancellation forwarded to the parent and observed by the local head. */
      const controller = createAbortController()
      /** First terminal reason wins among caller abort, local timeout, and close. */
      let reason: BudgetRejection | undefined
      /** Active timeout for this request, cancelled on settlement. */
      let timer: IScheduledTask | undefined
      /** Settles the public result immediately even if this record is not the queue head. */
      let resolveResult: (outcome: IBudgetOutcome) => void = () => undefined
      /** Ensures pending is decremented once. */
      let settled = false
      const result = new Promise<IBudgetOutcome>((resolve) => {
        resolveResult = resolve
      })
      const settle = (outcome: IBudgetOutcome): void => {
        if (settled) {
          if (outcome.kind === 'granted') outcome.lease.release()
          return
        }
        settled = true
        pending--
        timer?.cancel()
        signal?.removeEventListener('abort', abort)
        cancelPending.delete(cancel)
        resolveResult(outcome)
        notify()
      }
      const cancel = (value: BudgetRejection): void => {
        if (settled) return
        reason = value
        controller.abort(value)
        settle({ kind: 'rejected', reason: value })
      }
      const abort = (): void => {
        cancel(BudgetRejection.aborted)
      }
      pending++
      cancelPending.add(cancel)
      signal?.addEventListener('abort', abort, { once: true })
      timer = scheduler.schedule(() => {
        cancel(BudgetRejection.queueTimeout)
      }, timeoutMs)
      if (signal?.aborted) abort()
      /** One head waits for local capacity or the earliest rate expiry. */
      void queue
        .enqueue(async () => {
          while (!settled) {
            if (closed) {
              cancel(BudgetRejection.closed)
              break
            }
            if (leases.count(options.kind) < options.maxUnits) {
              trim()
              if (rate === false || grants.length < rate.max) break
            }
            await new Promise<void>((resolve) => {
              let rateTimer: IScheduledTask | undefined
              const resume = (): void => {
                wake.delete(resume)
                rateTimer?.cancel()
                resolve()
              }
              wake.add(resume)
              if (rate !== false && grants.length >= rate.max) {
                const delay = Math.max(0, grants[0]! + rate.windowMs - scheduler.now())
                rateTimer = scheduler.schedule(resume, delay)
              }
            })
          }
          if (settled) return
          const releaseLocal = leases.retain(options.kind)
          let releaseNeeded = true
          try {
            const upstream =
              options.parent === undefined
                ? undefined
                : await options.parent.acquire(controller.signal)
            if (settled) {
              if (upstream?.kind === 'granted') upstream.lease.release()
              return
            }
            if (upstream?.kind === 'rejected') {
              settle(upstream)
              return
            }
            if (rate !== false) grants.push(scheduler.now())
            let live = true
            releaseNeeded = false
            settle({
              kind: 'granted',
              lease: {
                release() {
                  if (!live) return
                  live = false
                  upstream?.lease.release()
                  releaseLocal()
                  notify()
                }
              }
            })
          } finally {
            if (releaseNeeded) {
              releaseLocal()
              notify()
            }
          }
        })
        .catch(() => {
          if (!settled) cancel(reason ?? BudgetRejection.closed)
        })
      return result
    },
    close() {
      if (closed) return
      closed = true
      for (const cancel of cancelPending) cancel(BudgetRejection.closed)
    }
  }
}
