/**
 * Owns admitted-unit resources and their ordered release; policy and attempts retain explicit slot
 * records.
 */
import {
  LifecycleErrorPolicy,
  createAbortController,
  createLifecycleScope,
  type IAbortController,
  type IGenerationRequest,
  type ILifecycleScope
} from '@migaia/lifecycle'
import { ExitReason, EXIT_OBSERVATION_CAPABILITY, UnitStopMode } from './constants.ts'
import { forceAndReap, releaseWhenGone, teardownUnit, type IUnitSlot } from './unit-teardown.ts'
import { publishExit } from './supervisor-events.ts'
import type { ISupervisorContext } from './supervisor-context.ts'
import type {
  IHealthSnapshot,
  ILaunchContext,
  IUnitExitStatus,
  IUnitHandle,
  IUnitRuntime
} from './types.ts'

/** Explicit record shared by lifecycle teardown and supervisor ownership decisions. */
export type IManagedSlot<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> = IUnitSlot<TSpec, THandle, TExit, TContext> & {
  readonly request: IGenerationRequest
  readonly scope: ILifecycleScope
  readonly attachments: ILifecycleScope
  readonly monitors: ILifecycleScope
  readonly unitController: IAbortController
  readonly runtime: IUnitRuntime
  /** Failed candidates reuse this ordinal; promotion alone commits it. */
  readonly executionGeneration: number
  failureReason?:
    | typeof ExitReason.startupTimeout
    | typeof ExitReason.launchFailed
    | typeof ExitReason.unhealthy
    | typeof ExitReason.resourceViolation
  exitEmitted: boolean
  retired: boolean
  /** Native exit facts are captured before classification or teardown publication. */
  exitStatus?: IUnitExitStatus
  exitObservedAt?: number
  readHealth?: () => IHealthSnapshot | undefined
}

/**
 * Owns one scope registration sequence after budget admission. The public fields form the explicit
 * internal slot context consumed by teardown; private state holds the lease and promise settlers.
 */
export class ManagedSlot<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
> implements IManagedSlot<TSpec, THandle, TExit, TContext> {
  /** Supervisor facts needed only for abandonment publication. */
  #context: ISupervisorContext<TSpec, THandle, TExit, TContext>
  /** Budget ownership ends after confirmed disappearance, including abandoned units. */
  #lease: { release(): void }
  /** Settles actual disappearance without replacing the original Promise. */
  #resolveGone!: () => void
  /** Settles the one force signal that interrupts existing graceful phases. */
  #resolveForce!: () => void
  /** The following fields are the shared, typed teardown context. */
  readonly generation: number
  /** Candidate execution ordinal committed only after readiness. */
  readonly executionGeneration: number
  /** Profile kind is captured for stable recovery diagnostics. */
  readonly kind: string
  /** Canonical profile owns termination and native classification. */
  readonly profile: ISupervisorContext<TSpec, THandle, TExit, TContext>['options']['profile']
  /** All scope and recovery deadlines use this clock. */
  readonly scheduler: ISupervisorContext<TSpec, THandle, TExit, TContext>['scheduler']
  /** Original report function retains error identity and invocation timing. */
  readonly report: (error: unknown) => void
  /** Only per-command grace may override the original drain budget. */
  drainTimeoutMs: number
  /** Graceful exit retains its construction-time budget. */
  readonly exitTimeoutMs: number
  /** Reaping cannot renew this construction-time budget. */
  readonly reapTimeoutMs: number
  /** Explicit unsupported observation permits immediate abandonment. */
  readonly exitObservation: IUnitSlot<TSpec, THandle, TExit, TContext>['exitObservation']
  /** Optional application drain runs before native termination. */
  readonly beforeTerminate: IUnitSlot<TSpec, THandle, TExit, TContext>['beforeTerminate']
  /** One callback records abandonment before the recovery reporter runs. */
  readonly onAbandon = (error: Error): void => this.#abandon(error)
  /** Launch is retained for late resolution during teardown. */
  launch: Promise<THandle> | undefined
  /** The actual native handle arrives only when launch fulfills. */
  handle: THandle | undefined
  /** Retirement intent starts at force until explicit stop takes ownership. */
  mode: UnitStopMode = UnitStopMode.force
  /** Native force invocation is distinguished from a force request. */
  forceIssued = false
  /** Successful or absent application drain changes stopped/killed classification. */
  drained: boolean
  /** Abandonment retains resources until real disappearance. */
  abandoned = false
  /** Only actual launch rejection or native exit settles this Promise. */
  readonly gone: Promise<void>
  /** A detached callback keeps the original slot record as its receiver. */
  readonly markGone = (): void => this.#markGone()
  /** Actual disappearance is not inferred from terminate or timeout. */
  disappeared = false
  /** Force joins existing graceful phases rather than creating new deadlines. */
  readonly forceRequested: Promise<void>
  /** Detached force request remains idempotent through Promise settlement. */
  readonly requestForce = (): void => this.#resolveForce()
  /** Teardown shares its original force/reap Promise. */
  forcing: Promise<void> | undefined
  /** Scope disposal shares its original bounded teardown Promise. */
  teardown: Promise<void> | undefined
  /** Cleanup failures attach to the primary launch failure without replacing it. */
  readonly secondaryErrors: unknown[] = []
  /** Attempt authority remains separate from serving-unit lifetime. */
  readonly request: IGenerationRequest
  /** Reverse scope order is monitors, native unit, attachments, lease. */
  readonly scope: ILifecycleScope
  /** Attachments wait for native disappearance. */
  readonly attachments: ILifecycleScope
  /** Monitors stop before application drain or native termination. */
  readonly monitors: ILifecycleScope
  /** Serving-unit cancellation does not reuse the attempt controller. */
  readonly unitController: IAbortController
  /** Hooks receive only their existing runtime ownership ports. */
  readonly runtime: IUnitRuntime
  /** Failure classification survives native exit races. */
  failureReason: IManagedSlot<TSpec, THandle, TExit, TContext>['failureReason']
  /** Primary error remains available to later recovery diagnostics. */
  failureError?: unknown
  /** Exit facts publish once, while abandonment itself is not native exit. */
  exitEmitted = false
  /** Retirement can upgrade to force but never creates a second teardown. */
  retired = false
  /** The profile's original native projection survives replacement and late exit. */
  exitStatus?: IUnitExitStatus
  /** Observation time is captured at actual exited fulfillment. */
  exitObservedAt?: number
  /** Health inspection is passive and refers to the original monitor. */
  readHealth?: () => IHealthSnapshot | undefined

  /** Allocates resources only after a lease exists and registers the original release order. */
  constructor(
    context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
    request: IGenerationRequest,
    lease: { release(): void }
  ) {
    this.#context = context
    this.#lease = lease
    this.scope = createLifecycleScope({
      errorPolicy: LifecycleErrorPolicy.report,
      report: context.options.report,
      scheduler: context.scheduler
    })
    this.attachments = createLifecycleScope({
      errorPolicy: LifecycleErrorPolicy.report,
      report: context.options.report,
      scheduler: context.scheduler
    })
    this.monitors = createLifecycleScope({
      errorPolicy: LifecycleErrorPolicy.report,
      report: context.options.report,
      scheduler: context.scheduler
    })
    this.unitController = createAbortController()
    this.gone = new Promise<void>((resolve) => {
      this.#resolveGone = resolve
    })
    this.forceRequested = new Promise<void>((resolve) => {
      this.#resolveForce = resolve
    })
    this.generation = request.generation
    this.executionGeneration = context.executionGeneration + 1
    this.kind = context.options.profile.kind
    this.profile = context.options.profile
    this.scheduler = context.scheduler
    this.report = context.options.report
    this.drainTimeoutMs = context.options.stop?.drainTimeoutMs ?? 5_000
    this.exitTimeoutMs = context.options.stop?.exitTimeoutMs ?? 5_000
    this.reapTimeoutMs = context.reapTimeoutMs
    this.exitObservation = context.options.launcher.capabilities[EXIT_OBSERVATION_CAPABILITY]
    this.beforeTerminate = context.options.stop?.beforeTerminate
    this.drained = context.options.stop?.beforeTerminate === undefined
    this.request = request
    this.runtime = {
      generation: request.generation,
      scope: this.attachments,
      monitors: this.monitors,
      signal: this.unitController.signal
    }
    this.scope.own(lease, { force: () => this.#releaseLease() })
    this.scope.own(this.attachments, { force: () => this.#releaseAttachments() })
    this.scope.own(this, { force: (releaseContext) => teardownUnit(this, releaseContext) })
    this.scope.own(this.monitors, { force: () => this.#disposeMonitors() })
  }

  /** Records abandonment before teardown reports its original coded diagnostic. */
  #abandon(error: Error): void {
    this.#context.abandoned++
    publishExit(this.#context, this, ExitReason.abandoned, error)
  }

  /** Only actual disappearance releases delayed attachments and budget ownership. */
  #markGone(): void {
    this.disappeared = true
    this.#resolveGone()
  }

  /** Lease release remains after native disappearance even when teardown abandons. */
  #releaseLease(): void | Promise<void> {
    return releaseWhenGone(this, () => this.#lease.release())
  }

  /** Attachment scope retains its original post-exit release point. */
  #releaseAttachments(): void | Promise<void> {
    return releaseWhenGone(this, () => this.#disposeAttachments())
  }

  /** Discards only the lifecycle scope report result, preserving its original Promise reaction. */
  #disposeAttachments(): Promise<void> {
    return this.attachments.dispose().then(() => undefined)
  }

  /** Monitor release precedes all unit teardown work. */
  #disposeMonitors(): Promise<void> {
    return this.monitors.dispose().then(() => undefined)
  }
}

/** Stops or force-retires one scope, retaining exact teardown sharing and primary failure. */
export function retire<
  TSpec,
  THandle extends IUnitHandle<TExit>,
  TExit,
  TContext extends ILaunchContext
>(
  context: ISupervisorContext<TSpec, THandle, TExit, TContext>,
  slot: IManagedSlot<TSpec, THandle, TExit, TContext>,
  mode: UnitStopMode,
  reason?: IManagedSlot<TSpec, THandle, TExit, TContext>['failureReason'],
  error?: unknown
): Promise<void> {
  if (mode === UnitStopMode.force) {
    slot.mode = mode
    slot.requestForce()
    if (slot.retired && slot.handle && !slot.disappeared)
      void forceAndReap(slot, slot.handle).catch(context.options.report)
  }
  if (slot.retired) return slot.scope.dispose().then(() => undefined)
  slot.retired = true
  slot.mode = mode
  slot.failureReason = reason
  slot.failureError = error
  slot.unitController.abort(error)
  return slot.scope.dispose().then(() => undefined)
}
