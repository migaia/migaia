/** Validates common construction policies before the supervisor owns resources. */
import { SupervisionField } from './text.ts'
import { RestartMode, TerminalPolicyMode } from './constants.ts'
import { SupervisionErrorCode } from './error-code.ts'
import { SupervisionErrorText } from './error-text.ts'
import { createSupervisionError } from './errors.ts'
import type { ILaunchContext, ISupervisorOptions, IUnitHandle } from './types.ts'

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

/** Only recurrent intervals require positive time; one-shot budgets may deliberately be zero. */
function duration(value: unknown, field: string, allowZero = true): void {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (!allowZero && value === 0)
  )
    invalidOption(field, RangeError)
}

/** Rejects fractional or negative policy counts before scheduling work. */
function count(value: unknown, field: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    invalidOption(field, RangeError)
}

/** Checks the common supervisor policy values at the public construction boundary. */
export function validateSupervisorOptions<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(options: ISupervisorOptions<TSpec, THandle, TExit, TContext>): void {
  if (typeof options.id !== 'string' || options.id.length === 0) invalidOption(SupervisionField.id)
  if (typeof options.report !== 'function') invalidOption(SupervisionField.report)
  if (options.budget.kind !== options.profile.kind) invalidOption(SupervisionField.budget)
  // RestartMode has exactly three compile-time keys; no runtime-sized collection is searched.
  if (
    options.restart?.mode !== undefined &&
    !Object.values(RestartMode).includes(options.restart.mode)
  )
    invalidOption(SupervisionField.restartMode)
  // TerminalPolicyMode has exactly two compile-time keys.
  if (
    options.terminalPolicy !== undefined &&
    !Object.values(TerminalPolicyMode).includes(options.terminalPolicy.mode)
  )
    invalidOption(SupervisionField.terminalPolicyMode)
  if (options.startupTimeoutMs !== undefined)
    duration(options.startupTimeoutMs, SupervisionField.startupTimeoutMs)
  if (options.restart?.initialDelayMs !== undefined)
    duration(options.restart.initialDelayMs, SupervisionField.restartInitialDelayMs)
  if (
    options.restart?.factor !== undefined &&
    (!(options.restart.factor >= 1) || !Number.isFinite(options.restart.factor))
  )
    invalidOption(SupervisionField.restartFactor, RangeError)
  if (options.restart?.maxDelayMs !== undefined)
    duration(options.restart.maxDelayMs, SupervisionField.restartMaxDelayMs)
  if (options.restart?.maxRestarts !== undefined)
    count(options.restart.maxRestarts, SupervisionField.restartMaxRestarts)
  if (options.restart?.windowMs !== undefined)
    duration(options.restart.windowMs, SupervisionField.restartWindowMs)
  if (options.terminalPolicy?.mode === TerminalPolicyMode.cooldown)
    duration(options.terminalPolicy.afterMs, SupervisionField.terminalPolicyAfterMs)
  if (options.stop?.drainTimeoutMs !== undefined)
    duration(options.stop.drainTimeoutMs, SupervisionField.stopDrainTimeoutMs)
  if (options.stop?.exitTimeoutMs !== undefined)
    duration(options.stop.exitTimeoutMs, SupervisionField.stopExitTimeoutMs)
  if (options.stop?.reapTimeoutMs !== undefined)
    duration(options.stop.reapTimeoutMs, SupervisionField.stopReapTimeoutMs)
  if (options.health?.intervalMs !== undefined)
    duration(options.health.intervalMs, SupervisionField.healthIntervalMs, false)
  if (options.health?.timeoutMs !== undefined)
    duration(options.health.timeoutMs, SupervisionField.healthTimeoutMs)
  if (options.health?.failureThreshold !== undefined)
    count(options.health.failureThreshold, SupervisionField.healthFailureThreshold)
}
