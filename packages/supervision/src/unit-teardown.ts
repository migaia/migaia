/** Owns the single unit teardown path; lifecycle descriptors own bounded graceful/force phases. */
import {
  boundedWait,
  createAbortController,
  executeReleaseDescriptor,
  type IAbortController,
  type IReleaseContext
} from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import {
  CapabilityLevel,
  EXIT_OBSERVATION_CAPABILITY,
  TerminationMode,
  UnitStopMode,
  TeardownPhase
} from './constants.js'
import { SupervisionErrorCode } from './error-code.js'
import { SupervisionErrorText } from './error-text.js'
import { createSupervisionError } from './errors.js'
import type { ILaunchContext, IUnitHandle, IUnitProfile } from './types.js'

/** One launched or launching unit and the ownership facts needed by its single teardown path. */
export type IUnitSlot<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> = {
  readonly generation: number
  readonly kind: string
  readonly profile: IUnitProfile<TSpec, THandle, TExit, TContext>
  readonly scheduler: IScheduler
  readonly report: (error: unknown) => void
  drainTimeoutMs: number
  readonly exitTimeoutMs: number
  readonly reapTimeoutMs: number
  /** Captured launcher declaration; an absent capability does not imply unsupported recovery. */
  readonly exitObservation: CapabilityLevel | undefined
  /** Primary retirement failure retained when a known recovery boundary becomes the public error. */
  failureError?: unknown
  readonly beforeTerminate?: (
    handle: THandle,
    signal: IAbortController['signal'],
    remainingMs: () => number
  ) => PromiseLike<void>
  readonly onAbandon: (error: Error) => void
  /** Settles to a handle or a rejected launch; rejection is observed by the caller. */
  launch: Promise<THandle> | undefined
  handle: THandle | undefined
  mode: UnitStopMode
  forceIssued: boolean
  drained: boolean
  abandoned: boolean
  /** Completion of launch rejection or the launched handle's exit. */
  readonly gone: Promise<void>
  readonly markGone: () => void
  teardown: Promise<void> | undefined
  /** One force request interrupts the current original graceful phase without a new deadline. */
  readonly forceRequested: Promise<void>
  readonly requestForce: () => void
  /** Shared force/reap completion prevents repeated termination and renewed reap budgets. */
  forcing: Promise<void> | undefined
  /** Actual launch rejection or exited fulfillment, never a termination request. */
  disappeared: boolean
  readonly secondaryErrors: unknown[]
}

/** Reports a profile termination error without losing the original thrown value. */
function safeTerminate<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(slot: IUnitSlot<TSpec, THandle, TExit, TContext>, handle: THandle, mode: TerminationMode): void {
  try {
    slot.profile.terminate(handle, mode)
  } catch (error) {
    slot.secondaryErrors.push(error)
    slot.report(error)
  }
}

/** Marks an unconfirmed recovery abandoned exactly once while retaining its lease. */
function abandon<TSpec, THandle extends IUnitHandle<TExit>, TExit, TContext extends ILaunchContext>(
  slot: IUnitSlot<TSpec, THandle, TExit, TContext>,
  phase: TeardownPhase
): void {
  if (slot.abandoned) return
  slot.abandoned = true
  /** A declared observation boundary is known immediately; launch waits still use their deadline. */
  const unobservable =
    phase === TeardownPhase.exit && slot.exitObservation === CapabilityLevel.unsupported
  /** Recovery diagnostics preserve the original failure on their cause chain. */
  const error = createSupervisionError(
    Error,
    unobservable ? SupervisionErrorCode.exitUnobservable : SupervisionErrorCode.reapTimeout,
    unobservable ? SupervisionErrorText.exitUnobservable : SupervisionErrorText.reapTimeout,
    {
      ...(unobservable ? { cause: slot.failureError } : {}),
      detail: {
        kind: slot.kind,
        generation: slot.generation,
        phase,
        ...(unobservable ? { capability: EXIT_OBSERVATION_CAPABILITY } : {})
      }
    }
  )
  slot.onAbandon(error)
  slot.report(error)
}

/**
 * Forces the unit, abandons a declared observation boundary, or awaits its finite recovery
 * deadline.
 */
export function forceAndReap<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(slot: IUnitSlot<TSpec, THandle, TExit, TContext>, handle: THandle): Promise<void> {
  if (slot.forcing) return slot.forcing
  slot.forcing = runForcing(slot, handle)
  return slot.forcing
}

/** Executes the original force/reap body without adding an async forwarding continuation. */
async function runForcing<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(slot: IUnitSlot<TSpec, THandle, TExit, TContext>, handle: THandle): Promise<void> {
  if (slot.disappeared) return
  slot.forceIssued = true
  safeTerminate(slot, handle, TerminationMode.force)
  if (slot.exitObservation === CapabilityLevel.unsupported) {
    abandon(slot, TeardownPhase.exit)
    return
  }
  if (
    !(await boundedWait(handle.exited, slot.scheduler.now() + slot.reapTimeoutMs, {
      scheduler: slot.scheduler
    }))
  )
    abandon(slot, TeardownPhase.exit)
}

/** Explicit drain state remains shared by the original Promise race and release callbacks. */
type IDrainSlot<THandle> = {
  readonly beforeTerminate?: (
    handle: THandle,
    signal: IAbortController['signal'],
    remainingMs: () => number
  ) => PromiseLike<void>
  readonly scheduler: IScheduler
  readonly report: (error: unknown) => void
  readonly forceRequested: Promise<void>
  readonly gone: Promise<void>
}

/** Keeps application callbacks on their original slot receiver while sharing drain decisions. */
type IDrainContext<THandle> = {
  readonly slot: IDrainSlot<THandle>
  readonly handle: THandle
  readonly controller: IAbortController
  readonly deadline: number
  finished: boolean
}

/** Invokes application drain with the unchanged deadline and a cold remaining-time callback. */
function invokeDrain<THandle>(drain: IDrainContext<THandle>): PromiseLike<void> {
  return drain.slot.beforeTerminate!(drain.handle, drain.controller.signal, () =>
    Math.max(0, drain.deadline - drain.slot.scheduler.now())
  )
}

/** Records a successful application drain before its Promise race settles. */
function finishDrain<THandle>(drain: IDrainContext<THandle>): void {
  drain.finished = true
}

/** Late drain rejection is reported; a current rejection still reaches the release executor. */
function rejectDrain<THandle>(drain: IDrainContext<THandle>, error: unknown): void {
  if (drain.controller.signal.aborted) drain.slot.report(error)
  else throw error
}

/** Preserves the descriptor's original async race and Promise continuation count. */
async function runDrain<THandle>(drain: IDrainContext<THandle>): Promise<void> {
  await Promise.race([
    Promise.resolve()
      .then(() => invokeDrain(drain))
      .then(
        () => finishDrain(drain),
        (error) => rejectDrain(drain, error)
      ),
    drain.slot.forceRequested.then(() => drain.controller.abort()),
    drain.slot.gone.then(() => drain.controller.abort())
  ])
}

/** Requests graceful exit and races only actual exit against the original force request. */
function gracefulExit<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(slot: IUnitSlot<TSpec, THandle, TExit, TContext>, handle: THandle): Promise<void> {
  safeTerminate(slot, handle, TerminationMode.graceful)
  return Promise.race([handle.exited.then(() => undefined), slot.forceRequested])
}

/** Runs one drain/termination sequence through lifecycle release descriptors. */
export async function teardownUnit<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(slot: IUnitSlot<TSpec, THandle, TExit, TContext>, context: IReleaseContext): Promise<void> {
  if (slot.teardown) return slot.teardown
  slot.teardown = runTeardown(slot, context)
  return slot.teardown
}

/** Runs the original per-slot teardown transaction without a factory closure. */
async function runTeardown<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(slot: IUnitSlot<TSpec, THandle, TExit, TContext>, context: IReleaseContext): Promise<void> {
  /** Only unresolved launch work consumes the launch recovery deadline. */
  const launch = slot.launch
  if (launch && slot.handle === undefined) {
    /** Launch rejection counts as settled and is observed below. */
    const settled = await boundedWait(launch, slot.scheduler.now() + slot.reapTimeoutMs, {
      scheduler: slot.scheduler
    }).catch(() => true)
    if (!settled) {
      abandon(slot, TeardownPhase.launch)
      return
    }
    try {
      slot.handle = await launch
    } catch {
      slot.markGone()
      return
    }
  }
  /** The single admitted handle retains its original slot owner. */
  const handle = slot.handle
  if (!handle) {
    slot.markGone()
    return
  }
  if (slot.mode === UnitStopMode.stop && slot.beforeTerminate) {
    /** The original graceful deadline cannot be renewed by a binding or caller callback. */
    const drainDeadline = Math.min(
      slot.scheduler.now() + slot.drainTimeoutMs,
      context.deadlineAt ?? Infinity
    )
    /** One explicit context replaces the original drain callbacks' captured mutable state. */
    const drain: IDrainContext<THandle> = {
      slot,
      handle,
      controller: createAbortController(),
      deadline: drainDeadline,
      finished: false
    }
    /** Lifecycle still owns the same graceful descriptor and deadline. */
    const failures = await executeReleaseDescriptor(
      {
        graceful: () => runDrain(drain),
        gracefulTimeoutMs: slot.drainTimeoutMs,
        force: () => drain.controller.abort()
      },
      context
    )
    slot.drained = drain.finished
    for (const error of failures) {
      slot.secondaryErrors.push(error)
      slot.report(error)
    }
  }
  if (slot.disappeared) return
  /** The profile decides whether this stop includes a graceful exit phase. */
  const descriptor =
    slot.mode === UnitStopMode.stop && slot.profile.gracefulTermination
      ? {
          graceful: () => gracefulExit(slot, handle),
          gracefulTimeoutMs: slot.exitTimeoutMs,
          force: () => forceAndReap(slot, handle)
        }
      : { force: () => forceAndReap(slot, handle) }
  /** Descriptor failures are secondary; the original failure remains primary. */
  const failures = await executeReleaseDescriptor(descriptor, context)
  for (const error of failures) {
    slot.secondaryErrors.push(error)
    slot.report(error)
  }
  if (slot.forcing) await slot.forcing
}

/** Releases an attachment or lease after disappearance, without blocking an abandoned teardown. */
export function releaseWhenGone<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  slot: IUnitSlot<TSpec, THandle, TExit, TContext>,
  release: () => void | PromiseLike<void>
): void | Promise<void> {
  if (slot.abandoned) {
    void slot.gone.then(() => release()).catch(slot.report)
    return
  }
  return slot.gone.then(() => release())
}
