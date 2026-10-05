import { createAbortController, type ILifecycleScope } from '@migaia/lifecycle'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { SupervisionErrorCode } from './error-code.js'
import { SupervisionErrorText } from './error-text.js'
import { createSupervisionError } from './errors.js'
import { HealthState } from './constants.js'
import type { IHealthSnapshot, ISupervisorBaseOptions } from './types.js'

/** Starts serialized periodic checks and owns all active timers through the monitor scope. */
export function startHealth<THandle>(
  monitors: ILifecycleScope,
  handle: THandle,
  kind: string,
  health: NonNullable<ISupervisorBaseOptions<THandle>['health']>,
  scheduler: IScheduler,
  fail: (error: Error) => void,
  report: (error: unknown) => void
): () => IHealthSnapshot | undefined {
  const intervalMs = health.intervalMs ?? 5_000
  const timeoutMs = health.timeoutMs ?? 2_000
  const threshold = health.failureThreshold ?? 3
  let failures = 0
  let running = false
  let closed = false
  let interval: IScheduledTask | undefined
  let deadline: IScheduledTask | undefined
  let controller = createAbortController()
  /** Last observed monitor phase, never inferred from unit readiness. */
  let state: HealthState = HealthState.pending
  /** Only an actual check transition supplies the scheduler observation time. */
  let observedAt: number | undefined

  /** Counts one rejected or timed out check and ends the unit at the configured threshold. */
  const recordFailure = (cause: unknown, timedOut: boolean): void => {
    failures++
    state = HealthState.unhealthy
    observedAt = scheduler.now()
    if (failures < threshold || closed) return
    fail(
      createSupervisionError(
        Error,
        SupervisionErrorCode.unhealthy,
        SupervisionErrorText.unhealthy,
        { ...(timedOut ? {} : { cause }), detail: { kind, timedOut } }
      )
    )
  }
  /** Schedules the next check without overlapping the active one. */
  const schedule = (): void => {
    if (closed) return
    interval = scheduler.schedule(() => {
      schedule()
      if (running || closed) return
      running = true
      state = HealthState.checking
      observedAt = scheduler.now()
      controller = createAbortController()
      const checkController = controller
      let decided = false
      const checkDeadline = scheduler.schedule(() => {
        if (decided || closed) return
        decided = true
        running = false
        checkController.abort()
        recordFailure(undefined, true)
      }, timeoutMs)
      deadline = checkDeadline
      void Promise.resolve()
        .then(() => health.check(handle, checkController.signal))
        .then(
          () => {
            const current = !decided
            if (current && !closed) {
              failures = 0
              state = HealthState.healthy
              observedAt = scheduler.now()
            }
            decided = true
            if (current) running = false
            checkDeadline.cancel()
            if (deadline === checkDeadline) deadline = undefined
          },
          (error) => {
            const current = !decided
            if (current && !closed) recordFailure(error, false)
            else if (!closed) report(error)
            decided = true
            if (current) running = false
            checkDeadline.cancel()
            if (deadline === checkDeadline) deadline = undefined
          }
        )
    }, intervalMs)
  }
  monitors.own(
    { stop: true },
    {
      force: () => {
        closed = true
        interval?.cancel()
        deadline?.cancel()
        controller.abort()
      }
    }
  )
  schedule()
  /** A cold read neither schedules work nor retains a retired unit in the public snapshot. */
  return () =>
    closed
      ? undefined
      : {
          state,
          failures,
          ...(observedAt === undefined ? {} : { observedAt })
        }
}
