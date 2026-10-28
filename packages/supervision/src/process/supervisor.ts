/** Composes process output, records, sampling and prewarm adoption above the shared core. */
import { PROCESS_KIND, SAMPLE_USAGE_MISSING, ProcessField } from './text.ts'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, type ILaunchContext, type IUnitRuntime } from '../index.ts'
import { CapabilityLevel, LaunchCause } from '../index.ts'
import { SupervisionErrorCode } from '../error-code.ts'
import { SupervisionErrorText } from '../error-text.ts'
import { createSupervisionError } from '../errors.ts'
import { processRequirements, validateCapabilityDeclaration } from './capabilities.ts'
import { ProcessCapability } from './constants.ts'
import { attachOutput, type IOutputAttachment } from './output-tail.ts'
import { createProcessProfile } from './profile.ts'
import { registerRecord } from './registry.ts'
import { invalidProcessOption, validateProcessSpec } from './spec.ts'
import type {
  IPrewarmEntry,
  IProcessHandle,
  IProcessLaunchContext,
  IProcessSpec,
  IProcessSupervisor,
  IProcessSupervisorOptions
} from './types.ts'
import { startUsageMonitor, validateUsageOptions } from './usage-monitor.ts'
import { readPrewarmRecordOwner } from './prewarm.ts'

/** Checks process-only settings before delegating core options to the shared supervisor. */
export function validateProcessOptions<THandle extends IProcessHandle>(
  options: IProcessSupervisorOptions<THandle>
): void {
  validateProcessSpec(options.spec)
  validateCapabilityDeclaration(options.launcher.capabilities)
  if (options.budget.kind !== PROCESS_KIND) invalidProcessOption(ProcessField.budget)
  if (
    options.registry &&
    (typeof options.launcher.probe !== 'function' ||
      typeof options.launcher.terminateRecord !== 'function')
  )
    invalidProcessOption(ProcessField.registry)
  if (
    options.prewarm &&
    (options.prewarm.spec !== options.spec ||
      options.prewarm.budget !== options.budget ||
      options.prewarm.launcher !== options.launcher)
  )
    invalidProcessOption(ProcessField.prewarm)
  validateUsageOptions(options.usage)
  if (
    options.output?.tailBytes !== undefined &&
    (!Number.isSafeInteger(options.output.tailBytes) || options.output.tailBytes <= 0)
  )
    invalidProcessOption(ProcessField.outputTailBytes, true)
}

/**
 * Supervises a child process created by an application-supplied launcher, such as a ready-made Node
 * launcher from an adapter package.
 *
 * Adds process concerns to the shared policy: bounded stdout/stderr tails, optional resource-usage
 * sampling against declared limits, durable records for recovery after parent loss, and handover of
 * a prewarmed idle process. This package never spawns a process itself. Under the default required
 * isolation, a launcher that cannot guarantee termination or fault isolation is rejected with
 * `CAPABILITY_UNSUPPORTED`; pass `isolation: 'best-effort'` to accept and report the gap instead.
 */
export function createProcessSupervisor<THandle extends IProcessHandle>(
  options: IProcessSupervisorOptions<THandle>
): IProcessSupervisor<THandle> {
  validateProcessOptions(options)
  return new ProcessAttachments(options).createSupervisor()
}

/** One process supervisor owns generation indexes and weak per-handle attachment metadata. */
class ProcessAttachments<THandle extends IProcessHandle> {
  /** Original options remain shared with profile hooks rather than copied into each callback. */
  #options: IProcessSupervisorOptions<THandle>
  /** The same scheduler drives process sampling and shared-core deadlines. */
  #scheduler: IScheduler
  /** Generation entries are removed by their corresponding unit scope. */
  #outputByGeneration = new Map<number, IOutputAttachment>()
  /** Output inspection must not keep exited handles alive. */
  #outputByHandle = new WeakMap<THandle, IOutputAttachment>()
  /** Handoff metadata remains weak after the core adopts a prewarmed handle. */
  #takenByHandle = new WeakMap<THandle, IPrewarmEntry<THandle>>()
  /** Each handle retains the exact spec used by its native launch or prewarm adoption. */
  #specByHandle = new WeakMap<THandle, IProcessSpec>()

  /** Stores process-owned attachment state without modifying the shared command surface. */
  constructor(options: IProcessSupervisorOptions<THandle>) {
    this.#options = options
    this.#scheduler = options.scheduler ?? systemScheduler
  }

  /** Existing profile/hooks perform real process ownership; commands remain core-owned. */
  createSupervisor(): IProcessSupervisor<THandle> {
    return createSupervisor({
      ...this.#options,
      launcher: {
        capabilities: this.#options.launcher.capabilities,
        launch: (spec, context) => this.#launch(spec, context)
      },
      profile: createProcessProfile<THandle>((base, unit) => this.#launchContext(base, unit)),
      hooks: {
        acquireUnit: (request) => this.#acquireUnit(request),
        afterLaunch: (handle, unit) => this.#afterLaunch(handle, unit),
        onReady: (handle, unit, fail) => this.#onReady(handle, unit, fail),
        inspectUnit: (handle) => this.#inspectUnit(handle)
      }
    })
  }

  /** Preserves the original single native-launch await before recording the actual spec. */
  async #launch(
    spec: IProcessSpec,
    context: Parameters<IProcessSupervisorOptions<THandle>['launcher']['launch']>[1]
  ): Promise<THandle> {
    /** The adapter result is published unchanged to shared-core startup. */
    const handle = await this.#options.launcher.launch(spec, context)
    this.#specByHandle.set(handle, spec)
    return handle
  }

  /** Creates the output attachment before launch and registers its generation removal point. */
  #launchContext(base: ILaunchContext, unit: IUnitRuntime): IProcessLaunchContext {
    /** One attachment serves both live drain and post-ready inspection for this generation. */
    const attachment = attachOutput(
      unit,
      this.#options.output?.tailBytes ?? 65_536,
      this.#options.report,
      this.#options.output?.onChunk
    )
    this.#outputByGeneration.set(unit.generation, attachment)
    unit.scope.own(
      { generation: unit.generation },
      {
        force: () => {
          this.#outputByGeneration.delete(unit.generation)
        }
      }
    )
    return { ...base, output: attachment.sink }
  }

  /** A taken unit keeps its original lease while the core adopts the handle. */
  #acquireUnit(request: {
    readonly cause: LaunchCause
    readonly spec: IProcessSpec
  }): { handle: THandle; lease: IPrewarmEntry<THandle>['lease'] } | undefined {
    /** Explicit restart/replace invalidates the pool before launching fresh code. */
    const pool = this.#options.prewarm
    if (!pool) return undefined
    if (request.cause === LaunchCause.restart || request.cause === LaunchCause.replace) {
      pool.invalidate()
      return undefined
    }
    if (request.spec !== pool.spec) return undefined
    /** Identity and lease move together; neither is reconstructed. */
    const taken = pool.take()
    if (taken) {
      this.#takenByHandle.set(taken.handle, taken)
      this.#specByHandle.set(taken.handle, request.spec)
    }
    return taken && { handle: taken.handle, lease: taken.lease }
  }

  /** All attach checks run before ready, preserving shared-core force-and-reap failure handling. */
  async #afterLaunch(handle: THandle, unit: IUnitRuntime): Promise<void> {
    /** Requirements contain at most seven fixed process capability names from processRequirements. */
    const requirements = processRequirements(this.#specByHandle.get(handle) ?? this.#options.spec)
    // Two monitored capability names; processRequirements emits at most seven fixed names.
    for (const name of [ProcessCapability.memoryLimit, ProcessCapability.cpuTimeLimit]) {
      if (
        requirements.includes(name) &&
        this.#options.launcher.capabilities[name] === CapabilityLevel.monitored &&
        typeof handle.sampleUsage !== 'function'
      )
        throw createSupervisionError(
          Error,
          SupervisionErrorCode.capabilityUnsupported,
          SupervisionErrorText.capabilityUnsupported,
          { detail: { kind: PROCESS_KIND, capability: name, reason: SAMPLE_USAGE_MISSING } }
        )
    }
    /** Startup already installed the same generation attachment before calling the adapter. */
    const attachment = this.#outputByGeneration.get(unit.generation)!
    this.#outputByHandle.set(handle, attachment)
    /** A warm entry retains its existing exit-owned record cleanup after transfer. */
    const taken = this.#takenByHandle.get(handle)
    taken?.bindOutput(attachment.sink)
    /** Reuse only the exact owner; distinct ids, ports or namespaces still register normally. */
    const recordOwner = taken && readPrewarmRecordOwner(taken)
    if (
      !recordOwner ||
      recordOwner.id !== this.#options.id ||
      recordOwner.port !== this.#options.registry?.port ||
      recordOwner.namespace !== this.#options.registry?.namespace
    )
      await registerRecord(
        handle,
        unit,
        this.#options.id,
        this.#options.registry,
        this.#options.wallClock
      )
  }

  /** Samples only the active handle's original specification and delegates failure to core. */
  #onReady(
    handle: THandle,
    unit: IUnitRuntime,
    fail: Parameters<typeof startUsageMonitor>[7]
  ): void {
    startUsageMonitor(
      handle,
      (this.#specByHandle.get(handle) ?? this.#options.spec).limits,
      this.#options.launcher.capabilities,
      unit,
      this.#scheduler,
      this.#options.usage?.intervalMs ?? 1_000,
      this.#options.usage?.failureThreshold ?? 3,
      fail,
      this.#options.report
    )
  }

  /** Returns diagnostic copies from the handle's attachment without retaining the handle. */
  #inspectUnit(handle: THandle): Readonly<Record<string, unknown>> {
    return {
      pid: handle.identity.pid,
      fingerprint: handle.identity.fingerprint,
      stdoutTail: this.#outputByHandle.get(handle)?.stdoutTail,
      stderrTail: this.#outputByHandle.get(handle)?.stderrTail
    }
  }
}
