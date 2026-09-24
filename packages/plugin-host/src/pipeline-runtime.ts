import { reportDiagnostic } from './diagnostic-report.js'
import { boundedWait, type ILifecycleScheduler, type IPendingTracker } from '@migaia/lifecycle'
import {
  MiddlewarePipelineMode,
  MiddlewarePipelineViolation,
  type IMiddlewarePipeline,
  type IMiddlewarePipelineMode,
  type IMiddlewarePipelineStage,
  type IMiddlewarePipelineViolationHandler
} from '@migaia/middleware-pipeline'
import ERROR_TEXT, {
  PluginHostError,
  attachPluginHostIdentity,
  createPluginHostTypeError
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type { IInstallBatchContext } from './install-runtime.js'
import { registerStage } from './pipeline.js'
import type { IDataOrderSlotState } from './composition.js'
import type { IRegistration } from './registry.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IPluginHostErrorCode } from './typing.js'

/** Maps canonical runner violations onto the Host diagnostic and coded-error policy. */
export const createPluginHostPipelineViolationHandler =
  (
    host: object,
    diagnostic: (message: string, code?: IPluginHostErrorCode) => void
  ): IMiddlewarePipelineViolationHandler =>
  (kind) => {
    if (kind === MiddlewarePipelineViolation.late) {
      reportDiagnostic(
        diagnostic,
        ERROR_TEXT.PIPELINE_NEXT_CALLED_LATE,
        PluginHostErrorCode.pipelineNextLate
      )
      return
    }
    throw attachPluginHostIdentity(
      new PluginHostError(
        PluginHostErrorCode.pipelineNextDuplicate,
        ERROR_TEXT.PIPELINE_NEXT_ALREADY_CALLED
      ),
      host
    )
  }

export type IPluginHostPipelineExecutionOptions<TValue> = Readonly<{
  readonly mode: IMiddlewarePipelineMode
  readonly stages: readonly Function[]
  readonly value: TValue
  readonly done: (value: TValue) => void
  readonly runner: IMiddlewarePipeline<IMiddlewarePipelineMode, TValue>
  readonly assertActive: () => void
  readonly retainLease: (stages: readonly Function[]) => () => void
  readonly enter: () => void
  readonly leave: () => void
  readonly pending: IPendingTracker
}>

export type IPluginHostStageRegistrationOptions<TDomainCore extends object, TValue> = Readonly<{
  readonly host: object
  readonly depth: number
  readonly stage: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>
  readonly owner: IRegistration<TDomainCore, TValue> | undefined
  readonly activeBatch: IInstallBatchContext<TDomainCore, TValue> | undefined
  readonly stages: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[]
  readonly stageSlots: Map<string, IDataOrderSlotState>
  readonly stageOwners: WeakMap<Function, string>
  readonly pipelineOwnerKeys: Map<string, object>
  readonly allocateSlot: () => bigint
  readonly readLiveStages: () => readonly Function[][]
}>

/** Registers one already-lifted stage while preserving definition order and disposal ownership. */
export const registerPluginHostStage = <TDomainCore extends object, TValue>(
  options: IPluginHostStageRegistrationOptions<TDomainCore, TValue>
): void => {
  const { stage, owner } = options
  if (typeof stage !== 'function')
    throw createPluginHostTypeError('pipeline stage must be a function')
  if (owner && owner.lifecycle !== PluginHostRegistrationLifecycle.install)
    throw new PluginHostError(
      PluginHostErrorCode.resourceOutsideInstall,
      ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
    )
  if (options.depth > 0 && !owner)
    throw new PluginHostError(PluginHostErrorCode.pipelineExecuting, ERROR_TEXT.PIPELINE_EXECUTING)
  const track = (dispose: () => void): void => {
    if (owner) owner.pipelineDisposers.push(dispose)
  }
  const stages = owner ? (options.activeBatch?.stages ?? options.stages) : options.stages
  if (owner) options.pipelineOwnerKeys.set(owner.name, owner.pipelineOwnerKey)
  if (!owner) {
    registerStage(stages, stage, track)
    return
  }
  let slotState = options.stageSlots.get(owner.name)
  if (!slotState || slotState.retired) {
    slotState = {
      host: options.host,
      name: owner.name,
      ordinal: options.allocateSlot(),
      retired: false
    }
    options.stageSlots.set(owner.name, slotState)
  }
  const slot = slotState.ordinal
  let index = stages.length
  for (let cursor = 0; cursor < stages.length; cursor += 1) {
    const current = stages[cursor] as Function
    const currentOwner = options.stageOwners.get(current)
    if (currentOwner === owner.name) index = cursor + 1
    else if (
      index === stages.length &&
      currentOwner !== undefined &&
      (options.stageSlots.get(currentOwner)?.ordinal ?? 1n << 100n) > slot
    )
      index = cursor
  }
  stages.splice(index, 0, stage)
  options.stageOwners.set(stage, owner.name)
  track(() => {
    for (const candidate of [stages, ...options.readLiveStages()]) {
      let currentIndex = candidate.indexOf(stage)
      while (currentIndex !== -1) {
        candidate.splice(currentIndex, 1)
        currentIndex = candidate.indexOf(stage)
      }
    }
  })
}

/** Executes the single host-mode lane and owns lease/depth/pending cleanup. */
export const executePluginHostPipeline = <TValue>(
  options: IPluginHostPipelineExecutionOptions<TValue>
): void | Promise<void> => {
  const stages = [...options.stages] as IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>[]
  const asynchronous =
    options.mode === MiddlewarePipelineMode.async ||
    options.mode === MiddlewarePipelineMode.asyncGenerator
  if (asynchronous) {
    try {
      options.assertActive()
    } catch (error) {
      return Promise.reject(error)
    }
    const release = options.retainLease(stages)
    options.enter()
    const task = (options.runner.run(stages, options.value, options.done) as Promise<void>).finally(
      () => {
        options.leave()
        release()
      }
    )
    return options.pending.track(task)
  }
  options.assertActive()
  const release = options.retainLease(stages)
  options.enter()
  try {
    return options.runner.run(stages, options.value, options.done)
  } finally {
    options.leave()
    release()
  }
}

/** Waits for the stages currently in flight, bounded by the host drain budget. */
export const drainPipelineLeases = async (context: {
  readonly leases: { whenZeroOnce(key: object): Promise<void> }
  readonly key: object
  readonly drainTimeoutMs: number | false
  readonly scheduler: ILifecycleScheduler
}): Promise<{
  readonly complete: boolean
  readonly physicalCompletion?: Promise<{ readonly cleanupErrors: readonly unknown[] }>
}> => {
  const pending = context.leases.whenZeroOnce(context.key)
  if (context.drainTimeoutMs === false) {
    await pending
    return { complete: true }
  }
  const complete = await boundedWait(pending, context.scheduler.now() + context.drainTimeoutMs, {
    scheduler: context.scheduler
  })
  if (complete) return { complete: true }
  return {
    complete: false,
    physicalCompletion: pending.then(
      () => Object.freeze({ cleanupErrors: Object.freeze([]) }),
      (error: unknown) => Object.freeze({ cleanupErrors: Object.freeze([error]) })
    )
  }
}
