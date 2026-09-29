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
  readonly drainTimeoutMs: number
  readonly exitTimeoutMs: number
  readonly reapTimeoutMs: number
  readonly beforeTerminate?: (
    handle: THandle,
    signal: IAbortController['signal']
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
export async function forceAndReap<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(slot: IUnitSlot<TSpec, THandle, TExit, TContext>, handle: THandle): Promise<void> {
  slot.forceIssued = true
  safeTerminate(slot, handle, 'force')
  if (
    !(await boundedWait(handle.exited, slot.scheduler.now() + slot.reapTimeoutMs, {
      scheduler: slot.scheduler
    }))
  )
    abandon(slot, 'exit')
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
      const drain = createAbortController()
      let finished = false
      const failures = await executeReleaseDescriptor(
        {
          graceful: async () => {
            await slot.beforeTerminate!(handle, drain.signal)
            finished = true
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
    const descriptor =
      slot.mode === 'stop' && slot.profile.gracefulTermination
        ? {
            graceful: () => {
              safeTerminate(slot, handle, 'graceful')
              return handle.exited.then(() => undefined)
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
