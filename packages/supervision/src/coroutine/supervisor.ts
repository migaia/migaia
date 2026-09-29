import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createSupervisor } from '../supervisor.js'
import { SupervisionErrorCode } from '../error-code.js'
import { SupervisionErrorText } from '../error-text.js'
import { createSupervisionError } from '../errors.js'
import type { IUnitProfile } from '../types.js'
import { CoroutineOutcome } from './constants.js'
import { createCoroutineLauncher, terminateCoroutineHandle } from './launcher.js'
import type {
  ICoroutineExitStatus,
  ICoroutineHandle,
  ICoroutineSpec,
  ICoroutineSupervisor,
  ICoroutineSupervisorOptions
} from './types.js'

/** Adapts a cooperative task and optional heartbeat policy to the core supervisor. */
export function createCoroutineSupervisor<TPort = undefined>(
  options: ICoroutineSupervisorOptions<TPort>
): ICoroutineSupervisor<TPort> {
  if (typeof options.spec?.task !== 'function')
    throw createSupervisionError(
      TypeError,
      SupervisionErrorCode.invalidOption,
      SupervisionErrorText.invalidOption,
      { detail: { field: 'spec.task' } }
    )
  if (options.heartbeat && options.health)
    throw createSupervisionError(
      TypeError,
      SupervisionErrorCode.invalidOption,
      SupervisionErrorText.invalidOption,
      { detail: { field: 'heartbeat' } }
    )
  const scheduler = resolveSchedulerOption(options) ?? resolveScheduler(systemScheduler)
  const heartbeat = options.heartbeat
  if (heartbeat && (!(heartbeat.timeoutMs > 0) || !Number.isFinite(heartbeat.timeoutMs)))
    throw createSupervisionError(
      RangeError,
      SupervisionErrorCode.invalidOption,
      SupervisionErrorText.invalidOption,
      { detail: { field: 'heartbeat.timeoutMs' } }
    )
  const profile: IUnitProfile<
    ICoroutineSpec<TPort>,
    ICoroutineHandle<TPort>,
    ICoroutineExitStatus
  > = {
    kind: 'coroutine',
    gracefulTermination: false,
    requirements: () => [],
    validateSpec(spec) {
      if (typeof spec?.task !== 'function')
        throw createSupervisionError(
          TypeError,
          SupervisionErrorCode.invalidOption,
          SupervisionErrorText.invalidOption,
          { detail: { field: 'spec.task' } }
        )
    },
    terminate(handle) {
      terminateCoroutineHandle(handle)
    },
    classifyExit(status) {
      return status.outcome === CoroutineOutcome.fulfilled
        ? { reason: 'exited' }
        : { reason: 'crashed', cause: status.error }
    }
  }
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
                  kind: 'coroutine'
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
    launcher: createCoroutineLauncher<TPort>(scheduler),
    profile
  })
}
