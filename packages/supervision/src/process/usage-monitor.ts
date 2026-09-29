import type { IScheduler, IScheduledTask } from '@migaia/utils/scheduler'
import type { IUnitRuntime } from '../index.js'
import { CapabilityLevel } from '../index.js'
import { ProcessCapability, ProcessLimit } from './constants.js'
import type { IProcessHandle, IProcessLimits, IProcessUsage } from './types.js'

/** Polls only monitored limits, with one outstanding sample and a finite failure threshold. */
export function startUsageMonitor(
  handle: IProcessHandle,
  limits: IProcessLimits | undefined,
  capabilities: Readonly<Record<string, string>>,
  unit: IUnitRuntime,
  scheduler: IScheduler,
  intervalMs: number,
  failureThreshold: number,
  fail: (
    reason: 'resource-violation' | 'unhealthy',
    detail: Readonly<Record<string, unknown>>,
    cause?: unknown
  ) => void,
  report: (error: unknown) => void
): void {
  const memory =
    limits?.memoryBytes !== undefined &&
    capabilities[ProcessCapability.memoryLimit] === CapabilityLevel.monitored
  const cpu =
    limits?.cpuTimeMs !== undefined &&
    capabilities[ProcessCapability.cpuTimeLimit] === CapabilityLevel.monitored
  if (!memory && !cpu) return
  let active = true
  let pending = false
  let failures = 0
  let timer: IScheduledTask | undefined
  const schedule = (): void => {
    if (!active) return
    timer = scheduler.schedule(tick, intervalMs)
    timer.unref?.()
  }
  const check = (usage: IProcessUsage): void => {
    if (memory && usage.rssBytes !== undefined && usage.rssBytes > limits!.memoryBytes!) {
      active = false
      fail('resource-violation', {
        limit: ProcessLimit.memoryBytes,
        observed: usage.rssBytes,
        maximum: limits!.memoryBytes
      })
    } else if (cpu && usage.cpuTimeMs !== undefined && usage.cpuTimeMs > limits!.cpuTimeMs!) {
      active = false
      fail('resource-violation', {
        limit: ProcessLimit.cpuTimeMs,
        observed: usage.cpuTimeMs,
        maximum: limits!.cpuTimeMs
      })
    }
  }
  const tick = (): void => {
    if (!active) return
    schedule()
    if (pending) return
    pending = true
    Promise.resolve()
      .then(() => handle.sampleUsage!())
      .then(
        (usage) => {
          pending = false
          if (!active) return
          failures = 0
          check(usage)
        },
        (error) => {
          pending = false
          if (!active) {
            report(error)
            return
          }
          failures++
          if (failures >= failureThreshold) {
            active = false
            fail('unhealthy', { probe: 'usage' }, error)
          }
        }
      )
  }
  unit.monitors.own(
    {
      close: () => {
        active = false
        timer?.cancel()
      }
    },
    {
      force: () => {
        active = false
        timer?.cancel()
      }
    }
  )
  schedule()
}
