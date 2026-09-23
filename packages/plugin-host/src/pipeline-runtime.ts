import { boundedWait, type ILifecycleScheduler, type IPendingTracker } from '@migaia/lifecycle'
import type {
  IMiddlewarePipelineAbortSignal,
  IMiddlewarePipelineViolationHandler
} from '@migaia/middleware-pipeline'
import ERROR_TEXT, {
  PluginHostError,
  attachPluginHostIdentity,
  createPluginHostTypeError
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type { IInstallBatchContext } from './install-runtime.js'
import { registerStage, runPipeline } from './pipeline.js'
import type { IDataOrderSlotState } from './composition.js'
import type { IRegistration } from './registry.js'
import {
  PluginHostPipelineMode,
  PluginHostPipelineViolation,
  PluginHostRegistrationLifecycle
} from './state-constants.js'
import type {
  IAsyncGeneratorPipelineStage,
  IAsyncPipelineStage,
  IGeneratorPipelineStage,
  IPluginHostErrorCode,
  IPipelineMode,
  ISyncPipelineStage
} from './typing.js'

/** Maps runner violations onto the Host's diagnostic and coded-error policy. */
export const createPluginHostPipelineViolationHandler =
  (
    host: object,
    diagnostic: (message: string, code?: IPluginHostErrorCode) => void
  ): IMiddlewarePipelineViolationHandler =>
  (kind) => {
    if (kind === PluginHostPipelineViolation.late) {
      try {
        diagnostic(ERROR_TEXT.PIPELINE_NEXT_CALLED_LATE, PluginHostErrorCode.pipelineNextLate)
      } catch {
        // Diagnostics must never alter pipeline control flow.
      }
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
  readonly mode: IPipelineMode
  readonly syncStages: readonly ISyncPipelineStage<TValue>[]
  readonly asyncStages: readonly IAsyncPipelineStage<TValue>[]
  readonly generatorStages: readonly IGeneratorPipelineStage<TValue>[]
  readonly asyncGeneratorStages: readonly IAsyncGeneratorPipelineStage<TValue>[]
  readonly value: TValue
  readonly done: (value: TValue) => void
  readonly onViolation: Parameters<typeof runPipeline<TValue>>[4]
  readonly assertActive: () => void
  readonly retainLease: (stages: readonly Function[]) => () => void
  readonly enter: () => void
  readonly leave: () => void
  readonly pending: IPendingTracker
  readonly liveSignal: IMiddlewarePipelineAbortSignal
}>

export type IPluginHostStageRegistrationOptions<TDomainCore extends object, TValue> = Readonly<{
  readonly host: object
  readonly hostMode: IPipelineMode
  readonly kind: IPipelineMode
  readonly depth: number
  readonly stage: Function
  readonly owner: IRegistration<TDomainCore, TValue> | undefined
  readonly activeBatch: IInstallBatchContext<TDomainCore, TValue> | undefined
  readonly syncStages: ISyncPipelineStage<TValue>[]
  readonly asyncStages: IAsyncPipelineStage<TValue>[]
  readonly generatorStages: IGeneratorPipelineStage<TValue>[]
  readonly asyncGeneratorStages: IAsyncGeneratorPipelineStage<TValue>[]
  readonly stageSlots: Map<string, IDataOrderSlotState>
  readonly stageOwners: WeakMap<Function, string>
  readonly pipelineOwnerKeys: Map<string, object>
  readonly allocateSlot: () => bigint
  readonly readLiveStages: () => readonly unknown[][]
}>

/** Registers a Host or plugin-owned stage while preserving definition order and disposal ownership. */
export const registerPluginHostStage = <TDomainCore extends object, TValue>(
  options: IPluginHostStageRegistrationOptions<TDomainCore, TValue>
): void => {
  const { stage, owner, kind } = options
  if (typeof stage !== 'function')
    throw createPluginHostTypeError('pipeline stage must be a function')
  if (kind !== options.hostMode)
    throw new PluginHostError(
      PluginHostErrorCode.pipelineModeMismatch,
      ERROR_TEXT.PIPELINE_MODE_MISMATCH(options.hostMode, kind)
    )
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
  const batch = owner ? options.activeBatch : undefined
  if (owner) options.pipelineOwnerKeys.set(owner.name, owner.pipelineOwnerKey)
  const insert = <TStage>(stages: TStage[]): void => {
    if (!owner) {
      registerStage(stages, stage as TStage, track)
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
      const current = stages[cursor] as unknown as Function
      const currentOwner = options.stageOwners.get(current)
      if (currentOwner === owner.name) index = cursor + 1
      else if (
        index === stages.length &&
        currentOwner !== undefined &&
        (options.stageSlots.get(currentOwner)?.ordinal ?? 1n << 100n) > slot
      )
        index = cursor
    }
    stages.splice(index, 0, stage as TStage)
    options.stageOwners.set(stage, owner.name)
    track(() => {
      const candidates = [stages, ...options.readLiveStages()] as TStage[][]
      for (const candidate of candidates) {
        let currentIndex = candidate.indexOf(stage as TStage)
        while (currentIndex !== -1) {
          candidate.splice(currentIndex, 1)
          currentIndex = candidate.indexOf(stage as TStage)
        }
      }
    })
  }
  if (kind === PluginHostPipelineMode.sync) insert(batch?.syncStages ?? options.syncStages)
  else if (kind === PluginHostPipelineMode.async) insert(batch?.asyncStages ?? options.asyncStages)
  else if (kind === PluginHostPipelineMode.generator)
    insert(batch?.generatorStages ?? options.generatorStages)
  else insert(batch?.asyncGeneratorStages ?? options.asyncGeneratorStages)
}

/** Executes one mode-specific pipeline snapshot while owning lease/depth/pending cleanup. */
export const executePluginHostPipeline = <TValue>(
  options: IPluginHostPipelineExecutionOptions<TValue>
): void | Promise<void> => {
  const { mode, value, done, onViolation } = options
  // 每次执行都在自己的副本上遍历：stage 在执行中注册或移除 stage，不会改变它所处的这一轮的序列。
  // 此前 sync 与 generator 直接传活动数组，async 两路才复制,同一个程序按配置的代数给出两种答案。
  if (mode === PluginHostPipelineMode.sync) {
    options.assertActive()
    const release = options.retainLease(options.syncStages)
    options.enter()
    try {
      return runPipeline(mode, [...options.syncStages], value, done, onViolation)
    } finally {
      options.leave()
      release()
    }
  }
  if (mode === PluginHostPipelineMode.async) {
    try {
      options.assertActive()
    } catch (error) {
      return Promise.reject(error)
    }
    const release = options.retainLease(options.asyncStages)
    options.enter()
    const task = (
      runPipeline(
        mode,
        [...options.asyncStages],
        value,
        done,
        onViolation,
        options.assertActive
      ) as Promise<void>
    ).finally(() => {
      options.leave()
      release()
    })
    return options.pending.track(task)
  }
  if (mode === PluginHostPipelineMode.generator) {
    options.assertActive()
    const release = options.retainLease(options.generatorStages)
    options.enter()
    try {
      return runPipeline(mode, [...options.generatorStages], value, done, onViolation)
    } finally {
      options.leave()
      release()
    }
  }
  try {
    options.assertActive()
  } catch (error) {
    return Promise.reject(error)
  }
  const release = options.retainLease(options.asyncGeneratorStages)
  options.enter()
  const task = (
    runPipeline(
      mode,
      [...options.asyncGeneratorStages],
      value,
      done,
      onViolation,
      undefined,
      options.liveSignal
    ) as Promise<void>
  ).finally(() => {
    options.leave()
    release()
  })
  return options.pending.track(task)
}

/**
 * Waits for the stages currently in flight, bounded by the host's drain budget.
 *
 * Lives with pipeline execution rather than on the host: what it waits for is a pipeline lease, and
 * the host's part is only choosing which key and which budget. A timeout does not abandon the work
 * — it hands the caller back control and returns the still-pending completion as
 * `physicalCompletion`, so the drain stays observable instead of silently continuing unwatched.
 */
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
