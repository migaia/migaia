/** Owns process sampling timers and in-flight samples; limits never run in parallel. */
import { USAGE_PROBE, ProcessField } from './text.js'
import { ExitReason } from '../index.js'
import type { IScheduler, IScheduledTask } from '@migaia/utils/scheduler'
import type { IUnitRuntime } from '../index.js'
import { CapabilityLevel } from '../index.js'
import { ProcessCapability, ProcessLimit } from './constants.js'
import type {
  IProcessHandle,
  IProcessLimits,
  IProcessUsage,
  IProcessSupervisorOptions
} from './types.js'
import { invalidProcessOption } from './spec.js'

/** Both process entry points admit the same finite positive sampling interval and failure count. */
export function validateUsageOptions(
  usage: IProcessSupervisorOptions<IProcessHandle>['usage']
): void {
  if (
    usage?.intervalMs !== undefined &&
    (!Number.isFinite(usage.intervalMs) || usage.intervalMs <= 0)
  )
    invalidProcessOption(ProcessField.usageIntervalMs, true)
  if (
    usage?.failureThreshold !== undefined &&
    (!Number.isSafeInteger(usage.failureThreshold) || usage.failureThreshold <= 0)
  )
    invalidProcessOption(ProcessField.usageFailureThreshold, true)
}

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
    reason: typeof ExitReason.resourceViolation | typeof ExitReason.unhealthy,
    detail: Readonly<Record<string, unknown>>,
    cause?: unknown
  ) => void,
  report: (error: unknown) => void
): void {
  /** Disabled sampling allocates no monitor, matching the original fast path. */
  const memory =
    limits?.memoryBytes !== undefined &&
    capabilities[ProcessCapability.memoryLimit] === CapabilityLevel.monitored
  /** CPU and memory can share one native sample without duplicating adapter calls. */
  const cpu =
    limits?.cpuTimeMs !== undefined &&
    capabilities[ProcessCapability.cpuTimeLimit] === CapabilityLevel.monitored
  if (!memory && !cpu) return
  new UsageMonitor(
    handle,
    limits!,
    memory,
    cpu,
    scheduler,
    intervalMs,
    failureThreshold,
    fail,
    report
  ).attach(unit)
}

/** A monitor owns exactly one timer and at most one outstanding adapter sample. */
class UsageMonitor {
  /** Adapter whose native sampling method remains called with its original receiver. */
  #handle: IProcessHandle
  /** Admitted limit values remain shared with the original process specification. */
  #limits: IProcessLimits
  /** Only monitored memory limits participate in sample validation. */
  #memory: boolean
  /** Only monitored CPU limits participate in sample validation. */
  #cpu: boolean
  /** Timer owner is the injected monotonic scheduler. */
  #scheduler: IScheduler
  /** Existing fixed sampling interval. */
  #intervalMs: number
  /** Consecutive rejection count that declares the unit unhealthy. */
  #failureThreshold: number
  /** Core or prewarm failure port owns termination and diagnostic construction. */
  #fail: Parameters<typeof startUsageMonitor>[7]
  /** Passive late rejections retain the supplied reporting port. */
  #report: (error: unknown) => void
  /** Closing suppresses further checks while still observing pending rejection. */
  #active = true
  /** A scheduled tick never overlaps an unsettled native sample. */
  #pending = false
  /** Successful samples reset this consecutive rejection counter. */
  #failures = 0
  /** Only the latest scheduled timer can remain live after a tick. */
  #timer?: IScheduledTask

  /** Captures admitted sampling inputs without creating additional Promise stages. */
  constructor(
    handle: IProcessHandle,
    limits: IProcessLimits,
    memory: boolean,
    cpu: boolean,
    scheduler: IScheduler,
    intervalMs: number,
    failureThreshold: number,
    fail: Parameters<typeof startUsageMonitor>[7],
    report: (error: unknown) => void
  ) {
    this.#handle = handle
    this.#limits = limits
    this.#memory = memory
    this.#cpu = cpu
    this.#scheduler = scheduler
    this.#intervalMs = intervalMs
    this.#failureThreshold = failureThreshold
    this.#fail = fail
    this.#report = report
  }

  /** Monitoring is released before the unit itself, as in the original lifecycle descriptor. */
  attach(unit: IUnitRuntime): void {
    unit.monitors.own({ close: () => this.#close() }, { force: () => this.#close() })
    this.#schedule()
  }

  /** Schedules one unref'ed timer only while this monitor accepts samples. */
  #schedule(): void {
    if (!this.#active) return
    this.#timer = this.#scheduler.schedule(() => this.#tick(), this.#intervalMs)
    this.#timer.unref?.()
  }

  /** The next tick is scheduled before checking pending state, preserving baseline cadence. */
  #tick(): void {
    if (!this.#active) return
    this.#schedule()
    if (this.#pending) return
    this.#pending = true
    Promise.resolve()
      .then(() => this.#handle.sampleUsage!())
      .then(
        (usage) => this.#sampled(usage),
        (error) => this.#rejected(error)
      )
  }

  /** Successful sampling clears failure history before checking the active limits. */
  #sampled(usage: IProcessUsage): void {
    this.#pending = false
    if (!this.#active) return
    this.#failures = 0
    /** The original failure callback is invoked without a receiver. */
    const fail = this.#fail
    if (
      this.#memory &&
      usage.rssBytes !== undefined &&
      usage.rssBytes > this.#limits.memoryBytes!
    ) {
      this.#active = false
      fail(ExitReason.resourceViolation, {
        limit: ProcessLimit.memoryBytes,
        observed: usage.rssBytes,
        maximum: this.#limits.memoryBytes
      })
    } else if (
      this.#cpu &&
      usage.cpuTimeMs !== undefined &&
      usage.cpuTimeMs > this.#limits.cpuTimeMs!
    ) {
      this.#active = false
      fail(ExitReason.resourceViolation, {
        limit: ProcessLimit.cpuTimeMs,
        observed: usage.cpuTimeMs,
        maximum: this.#limits.cpuTimeMs
      })
    }
  }

  /** Pending failures remain reported after close; active failures count toward unhealthy. */
  #rejected(error: unknown): void {
    this.#pending = false
    if (!this.#active) {
      /** Late passive reports preserve the original receiver-free callback invocation. */
      const report = this.#report
      report(error)
      return
    }
    this.#failures++
    if (this.#failures >= this.#failureThreshold) {
      this.#active = false
      /** The original failure callback is invoked without a receiver. */
      const fail = this.#fail
      fail(ExitReason.unhealthy, { probe: USAGE_PROBE }, error)
    }
  }

  /** Disables new samples and cancels the latest timer idempotently. */
  #close(): void {
    this.#active = false
    this.#timer?.cancel()
  }
}
