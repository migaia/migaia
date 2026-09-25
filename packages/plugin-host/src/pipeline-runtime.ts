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
import type { IDataOrderSlotState } from './composition.js'
import type { IRegistration } from './registry.js'
import type { IStageSnapshot, StageLanes } from './stage-lanes.js'
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

type IPluginHostPipelineExecutionOptions<TValue> = Readonly<{
  readonly mode: IMiddlewarePipelineMode
  readonly snapshot: IStageSnapshot<TValue>
  readonly value: TValue
  readonly done: (value: TValue) => void
  readonly runner: IMiddlewarePipeline<IMiddlewarePipelineMode, TValue>
  readonly assertActive: () => void
  readonly retainLease: (ownerKeys: readonly object[]) => () => void
  readonly enter: () => void
  readonly leave: () => void
  readonly pending: IPendingTracker
}>

type IPluginHostStageRegistrationOptions<TDomainCore extends object, TValue> = Readonly<{
  readonly host: object
  readonly depth: number
  readonly stage: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>
  readonly owner: IRegistration<TDomainCore, TValue> | undefined
  readonly lanes: StageLanes<TValue>
  readonly stageSlots: Map<string, IDataOrderSlotState>
  readonly allocateSlot: () => bigint
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
  if (!owner) {
    options.lanes.appendHost(stage, options.allocateSlot())
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
  options.lanes.registerOwner(owner, slotState, stage)
}

/** Executes the single host-mode lane and owns lease/depth/pending cleanup. */
export const executePluginHostPipeline = <TValue>(
  options: IPluginHostPipelineExecutionOptions<TValue>
): void | Promise<void> => {
  const stages = [...options.snapshot.stages]
  const asynchronous =
    options.mode === MiddlewarePipelineMode.async ||
    options.mode === MiddlewarePipelineMode.asyncGenerator
  if (asynchronous) {
    try {
      options.assertActive()
    } catch (error) {
      return Promise.reject(error)
    }
    const release = options.retainLease(options.snapshot.ownerKeys)
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
  const release = options.retainLease(options.snapshot.ownerKeys)
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
