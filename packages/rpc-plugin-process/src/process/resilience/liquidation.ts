/**
 * Executes the actual local dependency-removal plan or standalone-owner release. Affected
 * dependants retain bounded diagnostic snapshots rather than a second execution lifecycle.
 */
import { RPC_PROCESS_ERROR_SOURCE } from '@migaia/rpc-contract/error-code'
import { RpcProcessErrorText } from '../error-text.js'
import { attachErrorIdentity } from '@migaia/utils/error'
import type { IPluginDependencyPlan } from '@migaia/plugin-host'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'

import type { IProcessLiquidationOwner, IProcessResilienceSnapshot } from './types.js'
import { scheduleProcessDiagnostic } from './terminal.js'

/** A committed mutation can still retain cleanup errors without being retried. */
export type IProcessLiquidationResult = Readonly<{
  affected: IPluginDependencyPlan['steps']
  cleanupErrors: readonly unknown[]
}>

/** Only the Host's committed affected plan describes what actually changed. */
export async function liquidateProcessOwner(
  owner: IProcessLiquidationOwner,
  cascade: boolean,
  report: (error: unknown) => void
): Promise<IProcessLiquidationResult> {
  if (owner.kind === 'standalone-host') {
    await owner.release()
    return { affected: [], cleanupErrors: [] }
  }
  const result = await owner.host.unUse(owner.name, {
    policy: cascade ? 'cascade' : 'suspend'
  })
  if (!result.ok) for (const error of result.errors) report(error)
  return { affected: result.affected.steps, cleanupErrors: result.ok ? [] : result.errors }
}

/** A suspended dependency has its own bounded diagnostic count and timer. */
export type IProcessDependentDiagnostic = Readonly<{
  snapshot(): IProcessResilienceSnapshot
  close(): void
}>

/** Report only actual suspended names, with an independent unhandled clock. */
/** Allocate one suspended dependency diagnostic lifetime before installing behavior callbacks. */
function processDependentDiagnosticState(
  options: Readonly<{
    name: string
    reason: unknown
    scheduler: IScheduler
    reportAtMs: readonly number[]
    unhandledLimit: number
    report(error: unknown): void
    notify(snapshot: IProcessResilienceSnapshot): Promise<boolean>
    liquidate(): Promise<void>
  }>
) {
  /** Unhandled-call count drives the existing dependent diagnostic threshold. */
  let unhandled = 0
  /**
   * Committed liquidation prevents another owner-removal attempt for the same terminal
   * registration.
   */
  let liquidated = false
  /** Terminal admission state prevents this owner from accepting work after its resource is closed. */
  let closed = false
  /** At most one scheduled diagnostic or recovery step belongs to this owner at a time. */
  const timer = undefined as IScheduledTask | undefined
  /** The original clock origin bounds this diagnostic episode without resetting on repeated events. */
  const startedAt = options.scheduler.now()

  return { unhandled, liquidated, closed, timer, startedAt, options }
}

/** Own one suspended dependency diagnostic lifetime; callbacks access only this explicit instance. */
class ProcessDependentDiagnostic {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof processDependentDiagnosticState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IProcessDependentDiagnostic
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(
    options: Readonly<{
      name: string
      reason: unknown
      scheduler: IScheduler
      reportAtMs: readonly number[]
      unhandledLimit: number
      report(error: unknown): void
      notify(snapshot: IProcessResilienceSnapshot): Promise<boolean>
      liquidate(): Promise<void>
    }>
  ) {
    this.#state = processDependentDiagnosticState(options)
    void this.#deliver(0)
    this.value = Object.freeze({
      snapshot: this.#snapshot,
      close: (): void => {
        this.#state.closed = true
        this.#state.timer?.cancel()
      }
    })
  }

  #snapshot = (): IProcessResilienceSnapshot =>
    Object.freeze({
      id: this.#state.options.name,
      state: 'terminal',
      health: 'none',
      unhandled: this.#state.unhandled,
      liquidated: this.#state.liquidated,
      reason: this.#state.options.reason
    })

  #deliver = async (index: number): Promise<void> => {
    this.#state.timer = undefined
    if (this.#state.closed || this.#state.liquidated) return
    this.#state.options.report(
      ((originalCause: unknown, originalDetail: Readonly<Record<string, unknown>> | undefined) =>
        attachErrorIdentity(
          new Error(
            RpcProcessErrorText.terminalCall,
            originalCause === undefined ? undefined : { cause: originalCause }
          ),
          {
            source: RPC_PROCESS_ERROR_SOURCE,
            code: RpcProcessErrorCode.terminalCall,
            ...(originalDetail ? { detail: originalDetail } : {})
          }
        ))(this.#state.options.reason, {
        registrationId: this.#state.options.name
      })
    )
    let handled = false
    try {
      handled = await this.#state.options.notify(this.#snapshot())
    } catch (error) {
      this.#state.options.report(error)
    }
    if (this.#state.closed || this.#state.liquidated) return
    if (handled) {
      this.#state.unhandled = 0
      return
    }
    this.#state.unhandled += 1
    if (this.#state.unhandled > this.#state.options.unhandledLimit) {
      try {
        await this.#state.options.liquidate()
        this.#state.liquidated = true
      } catch (error) {
        this.#state.options.report(error)
      }
      return
    }
    const next = index + 1
    this.#state.timer = scheduleProcessDiagnostic(
      this.#state.options.scheduler,
      this.#state.options.reportAtMs,
      this.#state.startedAt,
      next,
      () => {
        void this.#deliver(next)
      }
    )
  }
}

/** Construct the single owner for one suspended dependency diagnostic lifetime. */
export function createProcessDependentDiagnostic(
  options: Readonly<{
    name: string
    reason: unknown
    scheduler: IScheduler
    reportAtMs: readonly number[]
    unhandledLimit: number
    report(error: unknown): void
    notify(snapshot: IProcessResilienceSnapshot): Promise<boolean>
    liquidate(): Promise<void>
  }>
): IProcessDependentDiagnostic {
  return new ProcessDependentDiagnostic(options).value
}
