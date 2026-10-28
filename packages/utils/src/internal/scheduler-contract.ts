/** Canonical scheduler type and value contracts; implementations depend inward on this module. */

/**
 * Handle of one scheduled callback. `cancel()` is idempotent; after it, or after the callback ran,
 * the callback never runs (again). `unref()` is an optional hint that does not change when the
 * callback runs; it only lets a host exit while this timer is the last pending work.
 */
export type IScheduledTask = { cancel(): void; unref?(): void }

/**
 * The only scheduler contract. `now()` is monotonic non-decreasing milliseconds (two reads may be
 * equal) and is only meaningful as a difference. `schedule()` accepts a finite non-negative
 * `delayMs`, runs the callback at most once, and never runs it synchronously inside `schedule()`.
 */
export type IScheduler = {
  now(): number
  schedule(callback: () => void, delayMs: number): IScheduledTask
  /**
   * Optional non-cancellable deferred job registration. System uses native microtasks; manual
   * clocks use their existing zero-time queue. Registration is synchronous, callbacks are
   * asynchronous and any returned callback Promise belongs to its caller.
   */
  defer?(callback: () => void): void
}

/**
 * Deterministic scheduler for tests and simulations. `advance(ms)` moves virtual time forward and
 * synchronously flushes due callbacks; `pendingCount` counts tasks neither run nor cancelled.
 */
export type IManualScheduler = IScheduler & {
  advance(ms: number): void
  readonly pendingCount: number
}

/**
 * Wall clock for diagnostic timestamps only. `timestamp()` returns epoch milliseconds as a safe
 * integer and must never take part in deadline, expiry, or replay-window comparisons.
 */
export type IWallClock = { timestamp(): number }
