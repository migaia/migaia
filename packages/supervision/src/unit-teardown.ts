import {
  boundedWait,
  createAbortController,
  executeReleaseDescriptor,
  type IAbortController,
  type IReleaseContext
} from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
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
  readonly beforeTerminate?: (
    handle: THandle,
    signal: IAbortController['signal'],
    remainingMs: () => number
  ) => PromiseLike<void>
  readonly onAbandon: (error: Error) => void
  /** Settles to a handle or a rejected launch; rejection is observed by the caller. */
  launch: Promise<THandle> | undefined
  handle: THandle | undefined
  mode: 'stop' | 'force'
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
>(
  slot: IUnitSlot<TSpec, THandle, TExit, TContext>,
  handle: THandle,
  mode: 'graceful' | 'force'
): void {
  try {
    slot.profile.terminate(handle, mode)
  } catch (error) {
    slot.secondaryErrors.push(error)
    slot.report(error)
  }
}

/** Marks an unresponsive unit abandoned exactly once while retaining its lease. */
function abandon<TSpec, THandle extends IUnitHandle<TExit>, TExit, TContext extends ILaunchContext>(
  slot: IUnitSlot<TSpec, THandle, TExit, TContext>,
  phase: 'launch' | 'exit'
): void {
  if (slot.abandoned) return
  slot.abandoned = true
  const error = createSupervisionError(
    Error,
    SupervisionErrorCode.reapTimeout,
    SupervisionErrorText.reapTimeout,
    { detail: { kind: slot.kind, generation: slot.generation, phase } }
  )
  slot.onAbandon(error)
  slot.report(error)
}

/** Forces the unit and waits only until its finite recovery deadline. */
export function forceAndReap<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(slot: IUnitSlot<TSpec, THandle, TExit, TContext>, handle: THandle): Promise<void> {
  if (slot.forcing) return slot.forcing
  slot.forcing = (async () => {
    if (slot.disappeared) return
    slot.forceIssued = true
    safeTerminate(slot, handle, 'force')
    if (
      !(await boundedWait(handle.exited, slot.scheduler.now() + slot.reapTimeoutMs, {
        scheduler: slot.scheduler
      }))
    )
      abandon(slot, 'exit')
  })()
  return slot.forcing
}

/** Runs one drain/termination sequence through lifecycle release descriptors. */
export async function teardownUnit<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(slot: IUnitSlot<TSpec, THandle, TExit, TContext>, context: IReleaseContext): Promise<void> {
  if (slot.teardown) return slot.teardown
  slot.teardown = (async () => {
    const launch = slot.launch
    if (launch && slot.handle === undefined) {
      const settled = await boundedWait(launch, slot.scheduler.now() + slot.reapTimeoutMs, {
        scheduler: slot.scheduler
      }).catch(() => true)
      if (!settled) {
        abandon(slot, 'launch')
        return
      }
      try {
        slot.handle = await launch
      } catch {
        slot.markGone()
        return
      }
    }
    const handle = slot.handle
    if (!handle) {
      slot.markGone()
      return
    }
    if (slot.mode === 'stop' && slot.beforeTerminate) {
      /** The original graceful deadline cannot be renewed by a binding or caller callback. */
      const drainDeadline = Math.min(
        slot.scheduler.now() + slot.drainTimeoutMs,
        context.deadlineAt ?? Infinity
      )
      const drain = createAbortController()
      let finished = false
      const failures = await executeReleaseDescriptor(
        {
          graceful: async () => {
            /**
             * Force or actual exit releases this same phase even when application code ignores
             * abort.
             */
            await Promise.race([
              Promise.resolve()
                .then(() =>
                  slot.beforeTerminate!(handle, drain.signal, () =>
                    Math.max(0, drainDeadline - slot.scheduler.now())
                  )
                )
                .then(
                  () => {
                    finished = true
                  },
                  (error) => {
                    if (drain.signal.aborted) slot.report(error)
                    else throw error
                  }
                ),
              slot.forceRequested.then(() => {
                drain.abort()
              }),
              slot.gone.then(() => {
                drain.abort()
              })
            ])
          },
          gracefulTimeoutMs: slot.drainTimeoutMs,
          force: () => {
            drain.abort()
          }
        },
        context
      )
      slot.drained = finished
      for (const error of failures) {
        slot.secondaryErrors.push(error)
        slot.report(error)
      }
    }
    if (slot.disappeared) return
    const descriptor =
      slot.mode === 'stop' && slot.profile.gracefulTermination
        ? {
            graceful: () => {
              safeTerminate(slot, handle, 'graceful')
              return Promise.race([handle.exited.then(() => undefined), slot.forceRequested])
            },
            gracefulTimeoutMs: slot.exitTimeoutMs,
            force: () => forceAndReap(slot, handle)
          }
        : { force: () => forceAndReap(slot, handle) }
    const failures = await executeReleaseDescriptor(descriptor, context)
    for (const error of failures) {
      slot.secondaryErrors.push(error)
      slot.report(error)
    }
    if (slot.forcing) await slot.forcing
  })()
  return slot.teardown
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
