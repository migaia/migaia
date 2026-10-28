/**
 * Public construction admits options and capabilities before allocating supervisor command
 * ownership.
 */
import { resolveScheduler, resolveSchedulerOption } from '@migaia/lifecycle/scheduler'
import { systemScheduler } from '@migaia/utils/scheduler'
import { admitCapabilities } from './admission.ts'
import { IsolationMode } from './constants.ts'
import { validateSupervisorOptions } from './options.ts'
import { SupervisorOwner } from './supervisor-owner.ts'
import type { ILaunchContext, ISupervisor, ISupervisorOptions, IUnitHandle } from './types.ts'

/**
 * Creates a supervisor for one kind of unit, for adapters that bring their own profile and
 * launcher. Applications usually start from `createCoroutineSupervisor`, `createProcessSupervisor`
 * or `createThreadSupervisor`, which call this with a ready-made profile.
 *
 * The supervisor admits each start through the budget, launches through the launcher, waits for
 * `ready`, and then restarts with bounded exponential backoff or enters `terminal` when failures
 * exceed the restart window. Commands are serialized; unit failures are returned as outcomes or
 * sent to `report`, never thrown. Invalid options, and capabilities the launcher cannot guarantee
 * under required isolation, throw coded errors here before any unit starts.
 */
export function createSupervisor<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext = ILaunchContext
>(options: ISupervisorOptions<TSpec, THandle, TExit, TContext>): ISupervisor<THandle, TSpec> {
  validateSupervisorOptions(options)
  options.profile.validateSpec(options.spec)
  /** One admitted clock owns all attempt, policy and retirement deadlines. */
  const scheduler = resolveSchedulerOption(options) ?? resolveScheduler(systemScheduler)
  /** Capability rejection stays synchronous and precedes command/resource ownership. */
  const admission = admitCapabilities(
    [...options.profile.requirements(options.spec), ...(options.requires ?? [])],
    options.launcher.capabilities,
    options.isolation ?? IsolationMode.required,
    options.profile.kind
  )
  return new SupervisorOwner(options, scheduler, admission).publicObject()
}
