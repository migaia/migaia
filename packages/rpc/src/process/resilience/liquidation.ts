import type { IPluginDependencyPlan } from '@migaia/plugin-host'
import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
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
  let unhandled = 0
  let liquidated = false
  let closed = false
  let timer: IScheduledTask | undefined
  const startedAt = options.scheduler.now()

  const snapshot = (): IProcessResilienceSnapshot =>
    Object.freeze({
      id: options.name,
      state: 'terminal',
      health: 'none',
      unhandled,
      liquidated,
      reason: options.reason
    })

  const deliver = async (index: number): Promise<void> => {
    timer = undefined
    if (closed || liquidated) return
    options.report(
      createProcessError(RpcProcessErrorCode.terminalCall, options.reason, {
        registrationId: options.name
      })
    )
    let handled = false
    try {
      handled = await options.notify(snapshot())
    } catch (error) {
      options.report(error)
    }
    if (closed || liquidated) return
    if (handled) {
      unhandled = 0
      return
    }
    unhandled += 1
    if (unhandled > options.unhandledLimit) {
      try {
        await options.liquidate()
        liquidated = true
      } catch (error) {
        options.report(error)
      }
      return
    }
    const next = index + 1
    timer = scheduleProcessDiagnostic(
      options.scheduler,
      options.reportAtMs,
      startedAt,
      next,
      () => {
        void deliver(next)
      }
    )
  }
  void deliver(0)
  return Object.freeze({
    snapshot,
    close(): void {
      closed = true
      timer?.cancel()
    }
  })
}
