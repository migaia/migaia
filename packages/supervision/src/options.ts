import { SupervisionErrorCode } from './error-code.js'
import { SupervisionErrorText } from './error-text.js'
import { createSupervisionError } from './errors.js'
import type { ILaunchContext, ISupervisorOptions, IUnitHandle } from './types.js'

/** Throws a native, coded option error before any unit or timer is created. */
export function invalidOption(
  field: string,
  Constructor: ErrorConstructor | TypeErrorConstructor | RangeErrorConstructor = TypeError
): never {
  throw createSupervisionError(
    Constructor,
    SupervisionErrorCode.invalidOption,
    SupervisionErrorText.invalidOption,
    { detail: { field } }
  )
}

/** Checks the common supervisor policy values at the public construction boundary. */
export function validateSupervisorOptions<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(options: ISupervisorOptions<TSpec, THandle, TExit, TContext>): void {
  if (typeof options.id !== 'string' || options.id.length === 0) invalidOption('id')
  if (typeof options.report !== 'function') invalidOption('report')
  if (options.budget.kind !== options.profile.kind) invalidOption('budget')
  const duration = (value: unknown, field: string): void => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      invalidOption(field, RangeError)
  }
  const count = (value: unknown, field: string): void => {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      invalidOption(field, RangeError)
  }
  if (options.startupTimeoutMs !== undefined) duration(options.startupTimeoutMs, 'startupTimeoutMs')
  if (options.restart?.initialDelayMs !== undefined)
    duration(options.restart.initialDelayMs, 'restart.initialDelayMs')
  if (
    options.restart?.factor !== undefined &&
    (!(options.restart.factor >= 1) || !Number.isFinite(options.restart.factor))
  )
    invalidOption('restart.factor', RangeError)
  if (options.restart?.maxDelayMs !== undefined)
    duration(options.restart.maxDelayMs, 'restart.maxDelayMs')
  if (options.restart?.maxRestarts !== undefined)
    count(options.restart.maxRestarts, 'restart.maxRestarts')
  if (options.restart?.windowMs !== undefined)
    duration(options.restart.windowMs, 'restart.windowMs')
  if (options.terminalPolicy?.mode === 'cooldown')
    duration(options.terminalPolicy.afterMs, 'terminalPolicy.afterMs')
  if (options.stop?.drainTimeoutMs !== undefined)
    duration(options.stop.drainTimeoutMs, 'stop.drainTimeoutMs')
  if (options.stop?.exitTimeoutMs !== undefined)
    duration(options.stop.exitTimeoutMs, 'stop.exitTimeoutMs')
  if (options.stop?.reapTimeoutMs !== undefined)
    duration(options.stop.reapTimeoutMs, 'stop.reapTimeoutMs')
  if (options.health?.intervalMs !== undefined)
    duration(options.health.intervalMs, 'health.intervalMs')
  if (options.health?.timeoutMs !== undefined)
    duration(options.health.timeoutMs, 'health.timeoutMs')
  if (options.health?.failureThreshold !== undefined)
    count(options.health.failureThreshold, 'health.failureThreshold')
}
