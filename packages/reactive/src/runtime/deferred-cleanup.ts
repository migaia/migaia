import type { IRuntime } from './types.js'
import { internalsOf } from './internals.js'
import { ReactiveErrorPhase } from './trace-constants.js'
import { tagReactiveError } from '../errors.js'
import { ReactiveErrorCode } from '../error-code.js'
import { ReactiveErrorText } from '../error-text.js'

/** Schedules synchronous adapter cleanup on its Runtime's existing idle channel, reporting throws. */
export function deferRuntimeCleanup(runtime: IRuntime, task: () => void): void {
  if (typeof task !== 'function')
    throw tagReactiveError(
      new TypeError(ReactiveErrorText.cleanupTaskMustBeFunction),
      ReactiveErrorCode.invalidOption
    )
  internalsOf(runtime).deferIdle(() => {
    try {
      task()
    } catch (error) {
      runtime.reportError(error, { phase: ReactiveErrorPhase.asyncFlush })
    }
  })
}
