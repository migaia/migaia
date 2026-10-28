/** Owns unit admission, FIFO requests, and composed leases; lifecycle owns queueing and counters. */
import { OutcomeKind, ABORT_EVENT, SupervisionField } from './text.ts'
import { TimestampWindow } from './timestamp-window.ts'
import type { IAbortSignal } from '@migaia/utils/promise'
import {
  createAbortController,
  createMutationQueue,
  createStringLeaseRegistry
} from '@migaia/lifecycle'
import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import { BudgetRejection, BudgetOverflow } from './constants.ts'
import { SupervisionErrorCode } from './error-code.ts'
import { SupervisionErrorText } from './error-text.ts'
import { createSupervisionError } from './errors.ts'
import type { IBudgetOutcome, IUnitBudget, IUnitBudgetOptions, IUnitLease } from './types.ts'

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

/** Owns the lifetime of one local lease and releases its upstream lease first. */
class BudgetLease {
  /** Local counter release, invoked at most once after the parent release. */
  #releaseLocal: () => void
  /** Wake publication belongs to the budget rather than to the counter. */
  #budget: UnitBudget<string>
  /** Optional upstream lease retained by this exact grant. */
  #parent: IUnitLease | undefined
  /** Prevents repeated public release from returning capacity twice. */
  #live = true

  /** Captures the already-retained counter; construction does not change admission order. */
  constructor(budget: UnitBudget<string>, releaseLocal: () => void, parent?: IUnitLease) {
    this.#budget = budget
    this.#releaseLocal = releaseLocal
    this.#parent = parent
  }

  /** Preserves the original plain object's single own method and detached-call behavior. */
  publicLease(): IUnitLease {
    return { release: () => this.release() }
  }

  /** Returns parent capacity before local capacity, then wakes the current queue head. */
  release(): void {
    if (!this.#live) return
    this.#live = false
    this.#parent?.release()
    /** Lifecycle's disposer retains its original undefined receiver. */
    const releaseLocal = this.#releaseLocal
    releaseLocal()
    this.#budget.notify()
  }
}

/** Owns one eligibility wait and removes its timer/listener together when awakened. */
class BudgetWake {
  /** Budget whose active FIFO head waits for capacity or launch rate. */
  #budget: UnitBudget<string>
  /** Settles this wait without adding an extra Promise continuation. */
  #resolve: () => void
  /** Optional rate expiry; capacity-only waits have no timer. */
  #timer: IScheduledTask | undefined
  /** Stable identity used by both the wake set and the scheduler. */
  readonly resume = (): void => this.#resume()

  /** Registers the waiter before arming the same earliest grant expiry as before. */
  constructor(budget: UnitBudget<string>, resolve: () => void) {
    this.#budget = budget
    this.#resolve = resolve
    budget.addWake(this.resume)
    this.#timer = budget.scheduleRateWake(this.resume)
  }

  /** Removes both registrations before allowing the head to retry eligibility. */
  #resume(): void {
    this.#budget.removeWake(this.resume)
    this.#timer?.cancel()
    this.#resolve()
  }
}

/** Owns a single queued acquisition from public settlement through final head cleanup. */
class BudgetRequest {
  /** Admission state shared with other requests only through the owning budget. */
  #budget: UnitBudget<string>
  /** Optional caller cancellation registration, removed on public settlement. */
  #signal: IAbortSignal | undefined
  /** Combined cancellation forwarded to a waiting parent budget. */
  #controller = createAbortController()
  /** First terminal reason wins among abort, timeout, and close. */
  #reason: BudgetRejection | undefined
  /** Queue deadline, cancelled even when the record has not reached the head. */
  #timer: IScheduledTask | undefined
  /** Resolver for the original public result Promise. */
  #resolveResult: (outcome: IBudgetOutcome) => void = ignoreBudgetOutcome
  /** Guards the pending count and every request-owned registration. */
  #settled = false
  /** Original result returned to the caller without an async wrapper. */
  #result: Promise<IBudgetOutcome>
  /** Stable caller-abort listener removed with the same identity. */
  #abort = (): void => this.cancel(BudgetRejection.aborted)

  /** Creates cancellation and result ownership before joining the FIFO. */
  constructor(budget: UnitBudget<string>, signal?: IAbortSignal) {
    this.#budget = budget
    this.#signal = signal
    this.#result = new Promise<IBudgetOutcome>((resolve) => {
      this.#resolveResult = resolve
    })
  }

  /** Registers this request and starts exactly one original mutation task. */
  begin(): Promise<IBudgetOutcome> {
    this.#budget.addPending(this)
    this.#signal?.addEventListener(ABORT_EVENT, this.#abort, { once: true })
    this.#timer = this.#budget.scheduleTimeout(() => this.cancel(BudgetRejection.queueTimeout))
    if (this.#signal?.aborted) this.#abort()
    void this.#budget.enqueue(() => this.#admit()).catch(() => this.#queueFailed())
    return this.#result
  }

  /** Publishes cancellation immediately while the queue later clears the retired record. */
  cancel(value: BudgetRejection): void {
    if (this.#settled) return
    this.#reason = value
    this.#controller.abort(value)
    this.#settle({ kind: OutcomeKind.rejected, reason: value })
  }

  /** Settles once and removes every listener, timeout, and pending-set entry. */
  #settle(outcome: IBudgetOutcome): void {
    if (this.#settled) {
      if (outcome.kind === OutcomeKind.granted) outcome.lease.release()
      return
    }
    this.#settled = true
    this.#budget.decrementPending()
    this.#timer?.cancel()
    this.#signal?.removeEventListener(ABORT_EVENT, this.#abort)
    this.#budget.removePending(this)
    this.#resolveResult(outcome)
    this.#budget.notify()
  }

  /** Contains the mutation task's original rejection as a stable capacity outcome. */
  #queueFailed(): void {
    if (!this.#settled) this.cancel(this.#reason ?? BudgetRejection.closed)
  }

  /** Installs one wake owner inside the original waiting Promise executor. */
  #wait(resolve: () => void): void {
    new BudgetWake(this.#budget, resolve)
  }

  /** Waits for local capacity, retains it, then awaits the parent's original acquisition. */
  async #admit(): Promise<void> {
    while (!this.#settled) {
      if (this.#budget.isClosed) {
        this.cancel(BudgetRejection.closed)
        break
      }
      if (this.#budget.headEligible()) break
      await new Promise<void>((resolve) => this.#wait(resolve))
    }
    if (this.#settled) return
    /** Local capacity stays retained while the parent is pending. */
    const releaseLocal = this.#budget.retain()
    /** Failed or cancelled upstream admission must return the provisional local capacity. */
    let releaseNeeded = true
    try {
      /** Missing parents do not add an await/microtask to the original admission path. */
      const upstream =
        this.#budget.parent === undefined
          ? undefined
          : await this.#budget.parent.acquire(this.#controller.signal)
      if (this.#settled) {
        if (upstream?.kind === OutcomeKind.granted) upstream.lease.release()
        return
      }
      if (upstream?.kind === OutcomeKind.rejected) {
        this.#settle(upstream)
        return
      }
      this.#budget.recordGrant()
      releaseNeeded = false
      this.#settle(this.#budget.grant(releaseLocal, upstream?.lease))
    } finally {
      if (releaseNeeded) {
        releaseLocal()
        this.#budget.notify()
      }
    }
  }
}

/** Placeholder resolver exists only before the synchronous Promise executor captures its resolver. */
function ignoreBudgetOutcome(_outcome: IBudgetOutcome): void {
  return undefined
}

/** Owns one budget's canonical counters, rate history, queue, and unresolved acquisitions. */
class UnitBudget<TKind extends string> {
  /** Immutable caller policy is read at the same operation boundaries as the original budget. */
  #options: IUnitBudgetOptions<TKind>
  /** Validated acquisition lifetime, independent of an upstream budget's lifetime. */
  #timeoutMs: number
  /** Launch-rate policy; false avoids rate bookkeeping on each grant. */
  #rate: false | { readonly max: number; readonly windowMs: number }
  /** Runtime-neutral clock admitted by the lifecycle boundary. */
  #scheduler: ReturnType<typeof resolveScheduler>
  /** Lifecycle counter remains the sole owner of retained local slots. */
  #leases: ReturnType<typeof createStringLeaseRegistry>
  /** Lifecycle FIFO serializes local eligibility and parent admission. */
  #queue: ReturnType<typeof createMutationQueue>
  /** Ordered grant history expires by cursor rather than moving every live suffix. */
  #grants = new TimestampWindow()
  /** Eligibility observers removed by their own BudgetWake owner. */
  #wake = new Set<() => void>()
  /** Every unresolved public acquisition is removed on settlement. */
  #requests = new Set<BudgetRequest>()
  /** Includes the active FIFO head until its public Promise settles. */
  #pending = 0
  /** Disables new admission while already granted leases remain valid. */
  #closed = false

  /** Validates policy before allocating the queue or owning timers. */
  constructor(options: IUnitBudgetOptions<TKind>) {
    positive(options.maxUnits, SupervisionField.maxUnits, true, true)
    this.#timeoutMs = positive(options.queueTimeoutMs ?? 30_000, SupervisionField.queueTimeoutMs)
    this.#rate = options.launchRate === undefined ? { max: 8, windowMs: 1_000 } : options.launchRate
    if (this.#rate !== false) {
      positive(this.#rate.max, SupervisionField.launchRateMax, true)
      positive(this.#rate.windowMs, SupervisionField.launchRateWindowMs)
    }
    if (options.parent !== undefined && options.parent.kind !== options.kind)
      throw createSupervisionError(
        TypeError,
        SupervisionErrorCode.invalidOption,
        SupervisionErrorText.invalidOption,
        { detail: { field: SupervisionField.parent } }
      )
    this.#options = options
    this.#scheduler = resolveSchedulerOption(options) ?? resolveScheduler(systemScheduler)
    this.#leases = createStringLeaseRegistry()
    this.#queue = createMutationQueue({ scheduler: this.#scheduler, admissionDiagnosticMs: false })
  }

  /** Builds the original plain public object, preserving own getters and detached method calls. */
  static publicBudget<TKind extends string>(owner: UnitBudget<TKind>): IUnitBudget<TKind> {
    return {
      kind: owner.#options.kind,
      get inUse() {
        return owner.#leases.count(owner.#options.kind)
      },
      get pending() {
        return owner.#pending
      },
      get closed() {
        return owner.#closed
      },
      tryAcquire: () => owner.#tryAcquire(),
      acquire: (signal) => owner.#acquire(signal),
      close: () => owner.#close()
    }
  }

  /** Exposes the upstream policy without creating a second admission abstraction. */
  get parent(): IUnitBudget<TKind> | undefined {
    return this.#options.parent
  }
  /** Lets the active request observe close at its existing loop boundary. */
  get isClosed(): boolean {
    return this.#closed
  }

  /** Wakes eligibility observers; lifecycle still serializes all admission. */
  notify(): void {
    for (const listener of this.#wake) listener()
  }
  /** Registers one request's eligibility listener before scheduling its timer. */
  addWake(listener: () => void): void {
    this.#wake.add(listener)
  }
  /** Removes a settled wait's listener. */
  removeWake(listener: () => void): void {
    this.#wake.delete(listener)
  }
  /** Counts and registers a public acquisition before listener/timer installation. */
  addPending(request: BudgetRequest): void {
    this.#pending++
    this.#requests.add(request)
  }
  /** Preserves pending-count publication before the request's timer cancellation. */
  decrementPending(): void {
    this.#pending--
  }
  /** Removes cancellation ownership after the caller listener has been removed. */
  removePending(request: BudgetRequest): void {
    this.#requests.delete(request)
  }
  /** Uses the existing mutation queue without a task owner or additional Promise. */
  enqueue(task: () => Promise<void>): Promise<void> {
    return this.#queue.enqueue(task)
  }
  /** Owns the request's original local queue deadline. */
  scheduleTimeout(cancel: () => void): IScheduledTask {
    return this.#scheduler.schedule(cancel, this.#timeoutMs)
  }
  /** Arms only rate-limited waits at their earliest live grant's original expiry. */
  scheduleRateWake(resume: () => void): IScheduledTask | undefined {
    if (this.#rate === false || this.#grants.length < this.#rate.max) return
    /** Expiry comes from the live prefix, never from discarded array entries. */
    const delay = Math.max(0, this.#grants.first! + this.#rate.windowMs - this.#scheduler.now())
    return this.#scheduler.schedule(resume, delay)
  }
  /** Checks the active head without treating its own pending count as contention. */
  headEligible(): boolean {
    if (this.#leases.count(this.#options.kind) >= this.#options.maxUnits) return false
    this.#trim()
    return this.#rate === false || this.#grants.length < this.#rate.max
  }
  /** Retains provisional local capacity before upstream admission. */
  retain(): () => void {
    return this.#leases.retain(this.#options.kind)
  }
  /** Records only successful grants, at the original observation time. */
  recordGrant(): void {
    if (this.#rate !== false) this.#grants.append(this.#scheduler.now())
  }
  /** Composes a retained local counter with its optional parent into one idempotent lease. */
  grant(releaseLocal: () => void, parent?: IUnitLease): IBudgetOutcome {
    return {
      kind: OutcomeKind.granted,
      lease: new BudgetLease(this, releaseLocal, parent).publicLease()
    }
  }

  /** Drops only grants that reached the exact rolling expiry boundary. */
  #trim(): void {
    if (this.#rate !== false) this.#grants.trim(this.#scheduler.now(), this.#rate.windowMs)
  }

  /** Checks instantaneous eligibility without jumping an existing FIFO request. */
  #localReason(): BudgetRejection | undefined {
    if (this.#closed) return BudgetRejection.closed
    if (this.#leases.count(this.#options.kind) >= this.#options.maxUnits || this.#pending > 0)
      return BudgetRejection.full
    this.#trim()
    if (this.#rate !== false && this.#grants.length >= this.#rate.max)
      return BudgetRejection.rateLimited
    return undefined
  }

  /** Grants immediately or returns the original local/upstream rejection object. */
  #tryAcquire(): IBudgetOutcome {
    /** Local refusal precedes all parent calls. */
    const reason = this.#localReason()
    if (reason !== undefined) return { kind: OutcomeKind.rejected, reason }
    /** Parent refusal must pass through unchanged before retaining local capacity. */
    const upstream = this.#options.parent?.tryAcquire()
    if (upstream?.kind === OutcomeKind.rejected) return upstream
    this.recordGrant()
    return this.grant(this.retain(), upstream?.lease)
  }

  /** Keeps immediate rejection and queued admission on their original Promise paths. */
  #acquire(signal?: IAbortSignal): Promise<IBudgetOutcome> {
    if (this.#closed)
      return Promise.resolve({ kind: OutcomeKind.rejected, reason: BudgetRejection.closed })
    if (signal?.aborted)
      return Promise.resolve({ kind: OutcomeKind.rejected, reason: BudgetRejection.aborted })
    if (
      this.#options.overflow === BudgetOverflow.reject &&
      (this.#leases.count(this.#options.kind) >= this.#options.maxUnits || this.#pending > 0)
    )
      return Promise.resolve({ kind: OutcomeKind.rejected, reason: BudgetRejection.full })
    return new BudgetRequest(this, signal).begin()
  }

  /** Rejects every unresolved request while preserving already granted leases. */
  #close(): void {
    if (this.#closed) return
    this.#closed = true
    for (const request of this.#requests) request.cancel(BudgetRejection.closed)
  }
}

/**
 * Creates the slots a group of supervisors shares: how many units of one kind may run at once, how
 * many may start per window, and how long a start may queue.
 *
 * Requests are admitted first in, first out. `acquire()` resolves with a granted lease or a stable
 * rejection reason and never throws for capacity; `tryAcquire()` answers immediately. A supervisor
 * releases its lease only after the unit has actually exited, so a unit that ignores stop keeps its
 * slot. `close()` rejects queued and future requests while existing leases stay valid. Malformed
 * limits throw a coded `RangeError` or `TypeError` before any queue or timer exists.
 */
export function createUnitBudget<TKind extends string>(
  options: IUnitBudgetOptions<TKind>
): IUnitBudget<TKind> {
  return UnitBudget.publicBudget(new UnitBudget(options))
}
