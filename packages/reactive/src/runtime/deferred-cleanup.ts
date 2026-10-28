/**
 * Admits extension cleanup onto the owning Runtime's existing idle channel without owning a new
 * queue.
 */
import type { IRuntime } from './types.ts'
import { internalsOf } from './internals.ts'
import { ReactiveErrorPhase } from './trace-constants.ts'
import { tagReactiveError } from '../errors.ts'
import { ReactiveErrorCode } from '../error-code.ts'
import { ReactiveErrorText } from '../error-text.ts'

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
