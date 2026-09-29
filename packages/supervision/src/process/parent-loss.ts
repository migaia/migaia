import { createAbortController, type IAbortSignal } from '@migaia/lifecycle'
import { systemScheduler, type IScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import { ParentLossExitCode } from './constants.js'
import { invalidProcessOption } from './spec.js'

/** Initiates one bounded shutdown after a parent disappearance signal. */
export function createParentLossGuard(options: {
  readonly shutdown: (signal: IAbortSignal) => PromiseLike<void>
  readonly exit: (code: ParentLossExitCode) => void
  readonly report: (error: unknown) => void
  readonly graceMs?: number
  readonly scheduler?: IScheduler
}): { trigger(reason?: unknown): void; readonly triggered: boolean } {
  if (typeof options?.shutdown !== 'function') invalidProcessOption('shutdown')
  if (typeof options.exit !== 'function') invalidProcessOption('exit')
  if (typeof options.report !== 'function') invalidProcessOption('report')
  const graceMs = options.graceMs ?? 5_000
  if (!Number.isFinite(graceMs) || graceMs <= 0) invalidProcessOption('graceMs', true)
  const scheduler = options.scheduler ?? systemScheduler
  const controller = createAbortController()
  let triggered = false
  let exited = false
  let timer: IScheduledTask | undefined
  const finish = (code: ParentLossExitCode): void => {
    if (exited) return
    exited = true
    timer?.cancel()
    options.exit(code)
  }
  return {
    get triggered() {
      return triggered
    },
    trigger(reason) {
      if (triggered) return
      triggered = true
      timer = scheduler.schedule(() => {
        controller.abort(reason)
        finish(ParentLossExitCode.forced)
      }, graceMs)
      timer.unref?.()
      try {
        Promise.resolve(options.shutdown(controller.signal)).then(
          () => finish(ParentLossExitCode.completed),
          (error) => {
            options.report(error)
            finish(ParentLossExitCode.forced)
          }
        )
      } catch (error) {
        options.report(error)
        finish(ParentLossExitCode.forced)
      }
    }
  }
}
