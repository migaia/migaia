/**
 * Owns Host stage admission and execution settlement; middleware and lifecycle retain runner and
 * lease authority.
 */
import { reportDiagnostic } from './diagnostic-report.js'
import { boundedWait, type IPendingTracker } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
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
  createPluginHostTypeError,
  PluginHostInternalText
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type { IDataOrderSlotState } from './composition.js'
import type { IRegistration } from './registry.js'
import type { IStageSnapshot, IStageForms, StageLanes } from './stage-lanes.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import type { IPluginHostErrorCode } from './error-code.js'

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

/** Runner, lease and pending authority borrowed from the canonical Host execution owner. */
export type IPluginHostPipelineExecutionPort<TValue> = Readonly<{
  readonly mode: IMiddlewarePipelineMode
  readonly runner: IMiddlewarePipeline<IMiddlewarePipelineMode, TValue>
  readonly assertActive: () => void
  readonly retainLease: (snapshot: IStageSnapshot<TValue>) => () => void
  readonly enter: () => void
  readonly leave: () => void
  readonly pending: IPendingTracker
}>

/** Exact stage and original data-order slot authority admitted for one registration. */
type IPluginHostStageRegistrationOptions<TDomainCore extends object, TValue> = Readonly<{
  readonly host: object
  readonly depth: number
  readonly stage: IMiddlewarePipelineStage<IMiddlewarePipelineMode, TValue>
  readonly forms?: IStageForms<TValue>
  readonly owner: IRegistration<TDomainCore, TValue> | undefined
  readonly lanes: StageLanes<TValue>
  readonly stageSlots: Map<string, IDataOrderSlotState>
  readonly allocateSlot: () => bigint
  /** Every declared lane reserves this one shared ordinal before later registrations can append. */
  readonly ensureSlot: (slot: IDataOrderSlotState) => void
}>

/** Reuses the original name slot for declared groups and later concrete stage occurrences. */
export function ensurePluginHostStageSlot<TDomainCore extends object, TValue>(
  options: Pick<
    IPluginHostStageRegistrationOptions<TDomainCore, TValue>,
    'host' | 'stageSlots' | 'allocateSlot' | 'ensureSlot'
  >,
  owner: IRegistration<TDomainCore, TValue>
): IDataOrderSlotState {
  /** Original name slot survives replacement until its explicit retirement. */
  let slotState = options.stageSlots.get(owner.name)
  if (!slotState || slotState.retired) {
    slotState = {
      host: options.host,
      name: owner.name,
      ordinal: options.allocateSlot(),
      retired: false
    }
    options.stageSlots.set(owner.name, slotState)
    options.ensureSlot(slotState)
  }
  return slotState
}

/** Registers one already-lifted stage while preserving definition order and disposal ownership. */
export const registerPluginHostStage = <TDomainCore extends object, TValue>(
  options: IPluginHostStageRegistrationOptions<TDomainCore, TValue>
): (() => void) => {
  const { stage, owner } = options
  if (typeof stage !== 'function')
    throw createPluginHostTypeError(PluginHostInternalText.PIPELINE_STAGE_FUNCTION)
  if (owner && owner.lifecycle !== PluginHostRegistrationLifecycle.install)
    throw new PluginHostError(
      PluginHostErrorCode.resourceOutsideInstall,
      ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
    )
  if (options.depth > 0 && !owner)
    throw new PluginHostError(PluginHostErrorCode.pipelineExecuting, ERROR_TEXT.PIPELINE_EXECUTING)
  if (!owner) {
    return options.lanes.appendHost(stage, options.allocateSlot(), options.forms)
  }
  /** One canonical name slot preserves allocation order across generation changes. */
  const slotState = ensurePluginHostStageSlot(options, owner)
  return options.lanes.registerOwner(owner, slotState, stage, options.forms)
}

/** Keep every execution's original depth-before-lease release order in one settlement path. */
function settlePluginHostPipeline<TValue>(
  options: Pick<IPluginHostPipelineExecutionPort<TValue>, 'leave'>,
  release: () => void
): void {
  options.leave()
  release()
}

/** Original execution-settlement state shared by fulfillment and rejection adapters. */
type IPipelineSettlement<TValue, TResult> = Readonly<{
  readonly options: IPluginHostPipelineExecutionPort<TValue>
  readonly release: () => void
  readonly result: (() => TResult) | undefined
}>

/** Releases execution authority before reading the terminal callback result. */
function fulfillPluginHostPipeline<TValue, TResult>(
  settlement: IPipelineSettlement<TValue, TResult>
): TResult | undefined {
  settlePluginHostPipeline(settlement.options, settlement.release)
  /** Preserve the original standalone receiver of the optional result callback. */
  const result = settlement.result
  return result?.()
}

/** Releases execution authority before rethrowing the exact original runner rejection. */
function rejectPluginHostPipeline<TValue, TResult>(
  error: unknown,
  settlement: IPipelineSettlement<TValue, TResult>
): never {
  settlePluginHostPipeline(settlement.options, settlement.release)
  throw error
}

/**
 * Executes the single host-mode lane and owns lease/depth/pending cleanup. In async modes the
 * returned Promise settles after cleanup; `result` (when given) supplies its fulfilled value, so a
 * caller needs no second derived Promise. A runner that throws synchronously still releases its
 * lease and execution depth before the rejection is returned.
 */
export const executePluginHostPipeline = <TValue, TResult = void>(
  options: IPluginHostPipelineExecutionPort<TValue>,
  snapshot: IStageSnapshot<TValue>,
  value: TValue,
  done: (value: TValue) => unknown,
  stages = snapshot.stages,
  result?: () => TResult
): void | Promise<TResult | undefined> => {
  /** Selected middleware mode determines synchronous throw versus Promise settlement semantics. */
  const asynchronous =
    options.mode === MiddlewarePipelineMode.async ||
    options.mode === MiddlewarePipelineMode.asyncGenerator
  if (asynchronous) {
    try {
      options.assertActive()
    } catch (error) {
      return Promise.reject(error)
    }
    /** Exact snapshot lease is released after execution depth leaves, including synchronous throws. */
    const release = options.retainLease(snapshot)
    options.enter()
    /** Runner Promise for this execution; its settlement releases the lease and depth. */
    let running: Promise<void>
    try {
      running = options.runner.run(stages, value, done) as Promise<void>
    } catch (error) {
      settlePluginHostPipeline(options, release)
      return Promise.reject(error)
    }
    /** One explicit settlement context keeps adapters independent from execution locals. */
    const settlement = { options, release, result }
    /** This remains the sole derived runner Promise tracked by the Host. */
    const task = running.then(
      () => fulfillPluginHostPipeline(settlement),
      (error: unknown) => rejectPluginHostPipeline(error, settlement)
    )
    return options.pending.track(task)
  }
  options.assertActive()
  /** Synchronous execution releases this same lease in its original finally boundary. */
  const release = options.retainLease(snapshot)
  options.enter()
  try {
    options.runner.run(stages, value, done)
  } finally {
    settlePluginHostPipeline(options, release)
  }
}

/** Waits for the stages currently in flight, bounded by the host drain budget. */
export const drainPipelineLeases = async (context: {
  readonly leases: { whenZeroOnce(key: object): Promise<void> }
  readonly key: object
  readonly drainTimeoutMs: number | false
  readonly scheduler: IScheduler
}): Promise<{
  readonly complete: boolean
  readonly physicalCompletion?: Promise<{ readonly cleanupErrors: readonly unknown[] }>
}> => {
  /** Single lifecycle drain Promise retains its original identity throughout the deadline race. */
  const pending = context.leases.whenZeroOnce(context.key)
  if (context.drainTimeoutMs === false) {
    await pending
    return { complete: true }
  }
  /** Existing scheduler budget bounds logical waiting without replacing the physical drain. */
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
