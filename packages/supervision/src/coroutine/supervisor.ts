import { ExitReason } from '../index.ts'
import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createSupervisor } from '../supervisor.ts'
import { SupervisionErrorCode } from '../error-code.ts'
import { SupervisionErrorText } from '../error-text.ts'
import { createSupervisionError } from '../errors.ts'
import type { IUnitProfile } from '../types.ts'
import { CoroutineOutcome } from './constants.ts'
import { COROUTINE_KIND, CoroutineField } from './contract.ts'
import { createCoroutineLauncher, terminateCoroutineHandle } from './launcher.ts'
import type {
  ICoroutineExitStatus,
  ICoroutineHandle,
  ICoroutineSpec,
  ICoroutineSupervisor,
  ICoroutineSupervisorOptions
} from './types.ts'

/**
 * Supervises a task that runs on the current event loop and stops when its `signal` aborts.
 *
 * Use it for background work inside one process: a formatter, a queue consumer, a periodic scanner.
 * The task may publish one port with `expose()` and report progress with `heartbeat()`; with the
 * `heartbeat` option, a task that stops reporting is treated as unhealthy and restarted. A
 * coroutine cannot be preempted or isolated: a task that ignores cancellation is reported with
 * `REAP_TIMEOUT` and keeps its budget slot until it actually ends. Choose a process when a forced
 * stop is required.
 */
export function createCoroutineSupervisor<TPort = undefined>(
  options: ICoroutineSupervisorOptions<TPort>
): ICoroutineSupervisor<TPort> {
  if (typeof options.spec?.task !== 'function')
    throw createSupervisionError(
      TypeError,
      SupervisionErrorCode.invalidOption,
      SupervisionErrorText.invalidOption,
      { detail: { field: CoroutineField.task } }
    )
  if (options.heartbeat && options.health)
    throw createSupervisionError(
      TypeError,
      SupervisionErrorCode.invalidOption,
      SupervisionErrorText.invalidOption,
      { detail: { field: CoroutineField.heartbeat } }
    )
  /** Core and heartbeat observations share the admitted scheduler. */
  const scheduler = resolveSchedulerOption(options) ?? resolveScheduler(systemScheduler)
  /** Optional heartbeat configuration replaces generic health only when present. */
  const heartbeat = options.heartbeat
  if (heartbeat && (!(heartbeat.timeoutMs > 0) || !Number.isFinite(heartbeat.timeoutMs)))
    throw createSupervisionError(
      RangeError,
      SupervisionErrorCode.invalidOption,
      SupervisionErrorText.invalidOption,
      { detail: { field: CoroutineField.heartbeatTimeout } }
    )
  /** Coroutine policy delegates lifecycle state and teardown to the shared core. */
  const profile: IUnitProfile<
    ICoroutineSpec<TPort>,
    ICoroutineHandle<TPort>,
    ICoroutineExitStatus
  > = {
    kind: COROUTINE_KIND,
    gracefulTermination: false,
    requirements: () => [],
    validateSpec(spec) {
      if (typeof spec?.task !== 'function')
        throw createSupervisionError(
          TypeError,
          SupervisionErrorCode.invalidOption,
          SupervisionErrorText.invalidOption,
          { detail: { field: CoroutineField.task } }
        )
    },
    terminate(handle) {
      terminateCoroutineHandle(handle)
    },
    classifyExit(status) {
      return status.outcome === CoroutineOutcome.fulfilled
        ? { reason: ExitReason.exited }
        : { reason: ExitReason.crashed, cause: status.error }
    }
  }
  /** Heartbeat checks observe task progress without creating another monitor. */
  const health = heartbeat
    ? {
        intervalMs: heartbeat.intervalMs ?? heartbeat.timeoutMs,
        failureThreshold: heartbeat.failureThreshold ?? 1,
        timeoutMs: heartbeat.timeoutMs,
        check(handle: ICoroutineHandle<TPort>) {
          if (scheduler.now() - handle.lastHeartbeatAt > heartbeat.timeoutMs)
            throw createSupervisionError(
              Error,
              SupervisionErrorCode.heartbeatMissed,
              SupervisionErrorText.heartbeatMissed,
              {
                detail: {
                  lastHeartbeatAt: handle.lastHeartbeatAt,
                  timeoutMs: heartbeat.timeoutMs,
                  kind: COROUTINE_KIND
                }
              }
            )
          return Promise.resolve()
        }
      }
    : options.health
  return createSupervisor({
    ...options,
    scheduler,
    health,
    launcher: createCoroutineLauncher<TPort>(scheduler, options.report),
    profile
  })
}
