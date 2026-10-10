import type { IScheduledTask, IScheduler } from '@migaia/utils/scheduler'
import type { IRemoteCallGuard } from '../../remote/index.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import type {
  IProcessRegistration,
  IProcessRegistrationBinding,
  IProcessResilienceSnapshot
} from './types.js'

/** One registration owns its terminal diagnostics, while supervision owns restart policy. */
export type IProcessTerminalRegistration = Readonly<{
  registration: IProcessRegistration
  guard: IRemoteCallGuard
  snapshot(): IProcessResilienceSnapshot | undefined
}>

/** One offset rule is shared by primary registrations and suspended dependants. */
export function scheduleProcessDiagnostic(
  scheduler: IScheduler,
  offsets: readonly number[],
  beganAt: number,
  index: number,
  callback: () => void
): IScheduledTask {
  const last = offsets[offsets.length - 1]!
  const span = last - offsets[offsets.length - 2]!
  const offset =
    index < offsets.length ? offsets[index]! : last + (index - offsets.length + 1) * span
  return scheduler.schedule(callback, Math.max(0, beganAt + offset - scheduler.now()))
}

/** Create one terminal report clock without adding a second supervisor state machine. */
export function createProcessTerminalRegistration(
  options: Readonly<{
    name: string
    binding: IProcessRegistrationBinding
    scheduler: IScheduler
    reportAtMs: readonly number[]
    unhandledLimit: number
    report(error: unknown): void
    notify(snapshot: IProcessResilienceSnapshot): Promise<boolean>
    liquidate(): Promise<void>
    onClose(): void
  }>
): IProcessTerminalRegistration {
  /** This owner stores only diagnostics not present in the supervisor snapshot. */
  let unhandled = 0
  let liquidated = false
  let closed = false
  let entry = 0
  let reason: unknown
  let timer: IScheduledTask | undefined
  let liquidation: Promise<void> | undefined
  let closePromise: Promise<void> | undefined

  const snapshot = (): IProcessResilienceSnapshot | undefined => {
    if (closed) return undefined
    const supervisor = options.binding.supervisor.inspect()
    return Object.freeze({
      id: options.name,
      state: supervisor.state,
      health: options.binding.health,
      unhandled,
      liquidated,
      ...(supervisor.state === 'terminal' ? { reason: reason ?? supervisor.terminalError } : {})
    })
  }

  const scheduleNext = (currentEntry: number, index: number, beganAt: number): void => {
    if (closed || liquidated || entry !== currentEntry) return
    timer = scheduleProcessDiagnostic(options.scheduler, options.reportAtMs, beganAt, index, () => {
      void deliver(currentEntry, index, beganAt)
    })
  }

  /** Supervision already reported index zero; this owner reports only later ticks. */
  const deliver = async (currentEntry: number, index: number, beganAt: number): Promise<void> => {
    timer = undefined
    if (closed || liquidated || entry !== currentEntry) return
    if (options.binding.supervisor.inspect().state !== 'terminal') return
    if (index > 0) options.report(reason)
    const current = snapshot()
    if (!current) return
    let handled = false
    try {
      handled = await options.notify(current)
    } catch (error) {
      options.report(error)
    }
    if (closed || liquidated || entry !== currentEntry) return
    if (handled) {
      unhandled = 0
      return
    }
    unhandled += 1
    if (unhandled > options.unhandledLimit) {
      liquidation = Promise.resolve().then(() => options.liquidate())
      try {
        await liquidation
        liquidated = true
        // This delivery has consumed its timer; retain only the owner's bounded tombstone.
        unsubscribe()
        options.onClose()
      } catch (error) {
        liquidation = undefined
        options.report(error)
      }
      return
    }
    scheduleNext(currentEntry, index + 1, beganAt)
  }

  /** The terminal event is emitted after supervision's own index-zero report. */
  const unsubscribe = options.binding.supervisor.onTerminal((event) => {
    timer?.cancel()
    entry = event.entry
    reason = event.error
    const beganAt = options.scheduler.now()
    void deliver(entry, 0, beganAt)
  })

  const guard: IRemoteCallGuard = Object.freeze({
    beforeDispatch(): void {
      if (closed) return
      if (liquidated)
        throw createProcessError(RpcProcessErrorCode.liquidated, reason, {
          registrationId: options.name
        })
      if (options.binding.supervisor.inspect().state === 'terminal')
        throw createProcessError(RpcProcessErrorCode.terminalCall, reason, {
          registrationId: options.name
        })
    }
  })

  const registration: IProcessRegistration = Object.freeze({
    async restart() {
      if (liquidated) throw createProcessError(RpcProcessErrorCode.liquidated, reason)
      if (liquidation) await liquidation.catch(() => undefined)
      if (liquidated) throw createProcessError(RpcProcessErrorCode.liquidated, reason)
      if (!closed) {
        timer?.cancel()
        unhandled = 0
      }
      return options.binding.supervisor.restart()
    },
    inspect: snapshot,
    close(): Promise<void> {
      return (closePromise ??= (async () => {
        closed = true
        timer?.cancel()
        unsubscribe()
        unhandled = 0
        await liquidation?.catch(() => undefined)
        options.onClose()
      })())
    }
  })

  return Object.freeze({ registration, guard, snapshot })
}
