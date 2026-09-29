import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createSupervisor, type IUnitRuntime } from '../index.js'
import { CapabilityLevel, LaunchCause } from '../index.js'
import { SupervisionErrorCode } from '../error-code.js'
import { SupervisionErrorText } from '../error-text.js'
import { createSupervisionError } from '../errors.js'
import { processRequirements, validateCapabilityDeclaration } from './capabilities.js'
import { ProcessCapability } from './constants.js'
import { attachOutput, type IOutputAttachment } from './output-tail.js'
import { createProcessProfile } from './profile.js'
import { registerRecord } from './registry.js'
import { invalidProcessOption, validateProcessSpec } from './spec.js'
import type {
  IPrewarmEntry,
  IProcessHandle,
  IProcessSpec,
  IProcessSupervisor,
  IProcessSupervisorOptions
} from './types.js'
import { startUsageMonitor } from './usage-monitor.js'

/** Checks process-only settings before delegating core options to the shared supervisor. */
export function validateProcessOptions<THandle extends IProcessHandle>(
  options: IProcessSupervisorOptions<THandle>
): void {
  validateProcessSpec(options.spec)
  validateCapabilityDeclaration(options.launcher.capabilities)
  if (options.budget.kind !== 'process') invalidProcessOption('budget')
  if (
    options.registry &&
    (typeof options.launcher.probe !== 'function' ||
      typeof options.launcher.terminateRecord !== 'function')
  )
    invalidProcessOption('registry')
  if (
    options.prewarm &&
    (options.prewarm.spec !== options.spec ||
      options.prewarm.budget !== options.budget ||
      options.prewarm.launcher !== options.launcher)
  )
    invalidProcessOption('prewarm')
  if (
    options.usage?.intervalMs !== undefined &&
    (!Number.isFinite(options.usage.intervalMs) || options.usage.intervalMs <= 0)
  )
    invalidProcessOption('usage.intervalMs', true)
  if (
    options.usage?.failureThreshold !== undefined &&
    (!Number.isSafeInteger(options.usage.failureThreshold) || options.usage.failureThreshold <= 0)
  )
    invalidProcessOption('usage.failureThreshold', true)
  if (
    options.output?.tailBytes !== undefined &&
    (!Number.isSafeInteger(options.output.tailBytes) || options.output.tailBytes <= 0)
  )
    invalidProcessOption('output.tailBytes', true)
}

/** Adapts process-specific output, registration, usage and prewarming to core hooks. */
export function createProcessSupervisor<THandle extends IProcessHandle>(
  options: IProcessSupervisorOptions<THandle>
): IProcessSupervisor<THandle> {
  validateProcessOptions(options)
  const scheduler: IScheduler = options.scheduler ?? systemScheduler
  const outputByGeneration = new Map<number, IOutputAttachment>()
  const outputByHandle = new WeakMap<THandle, IOutputAttachment>()
  const takenByHandle = new WeakMap<THandle, IPrewarmEntry<THandle>>()
  const specByHandle = new WeakMap<THandle, IProcessSpec>()
  const launcher = {
    capabilities: options.launcher.capabilities,
    launch: async (spec: IProcessSpec, context: Parameters<typeof options.launcher.launch>[1]) => {
      const handle = await options.launcher.launch(spec, context)
      specByHandle.set(handle, spec)
      return handle
    }
  }
  const profile = createProcessProfile<THandle>((base, unit) => {
    const attachment = attachOutput(
      unit,
      options.output?.tailBytes ?? 65_536,
      options.report,
      options.output?.onChunk
    )
    outputByGeneration.set(unit.generation, attachment)
    unit.scope.own(
      { generation: unit.generation },
      {
        force: () => {
          outputByGeneration.delete(unit.generation)
        }
      }
    )
    return { ...base, output: attachment.sink }
  })
  /** A taken unit keeps its original lease while the core adopts the handle. */
  const acquireUnit = (request: { readonly cause: LaunchCause; readonly spec: IProcessSpec }) => {
    const pool = options.prewarm
    if (!pool) return undefined
    if (request.cause === LaunchCause.restart || request.cause === LaunchCause.replace) {
      pool.invalidate()
      return undefined
    }
    if (request.spec !== pool.spec) return undefined
    const taken = pool.take()
    if (taken) {
      takenByHandle.set(taken.handle, taken)
      specByHandle.set(taken.handle, request.spec)
    }
    return taken && { handle: taken.handle, lease: taken.lease }
  }
  /** All attach checks run before ready, so failure follows core force-and-reap semantics. */
  const afterLaunch = async (handle: THandle, unit: IUnitRuntime): Promise<void> => {
    const requirements = processRequirements(specByHandle.get(handle) ?? options.spec)
    for (const name of [ProcessCapability.memoryLimit, ProcessCapability.cpuTimeLimit]) {
      if (
        requirements.includes(name) &&
        options.launcher.capabilities[name] === CapabilityLevel.monitored &&
        typeof handle.sampleUsage !== 'function'
      )
        throw createSupervisionError(
          Error,
          SupervisionErrorCode.capabilityUnsupported,
          SupervisionErrorText.capabilityUnsupported,
          { detail: { kind: 'process', capability: name, reason: 'sample-usage-missing' } }
        )
    }
    const attachment = outputByGeneration.get(unit.generation)!
    outputByHandle.set(handle, attachment)
    takenByHandle.get(handle)?.bindOutput(attachment.sink)
    await registerRecord(handle, unit, options.id, options.registry, options.wallClock)
  }
  return createSupervisor({
    ...options,
    launcher,
    profile,
    hooks: {
      acquireUnit,
      afterLaunch,
      onReady: (handle, unit, fail) =>
        startUsageMonitor(
          handle,
          (specByHandle.get(handle) ?? options.spec).limits,
          options.launcher.capabilities,
          unit,
          scheduler,
          options.usage?.intervalMs ?? 1_000,
          options.usage?.failureThreshold ?? 3,
          fail,
          options.report
        ),
      inspectUnit: (handle) => ({
        pid: handle.identity.pid,
        fingerprint: handle.identity.fingerprint,
        stdoutTail: outputByHandle.get(handle)?.stdoutTail,
        stderrTail: outputByHandle.get(handle)?.stderrTail
      })
    }
  })
}
