/** Owns registration revocation and physical cleanup; lifecycle owns scopes and release waiting. */
import type { PluginHostState } from './host-state.ts'
import type { INativeAbortSignal } from '@migaia/utils/promise'
import {
  boundedWait,
  createSyncStartedDisposalLedger,
  type ICleanupResult,
  type IQuiescenceTracker
} from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import { PluginHostCleanupRuntime, detachRegistrationStages } from './cleanup-runtime.ts'
import ERROR_TEXT, { PluginHostError, PluginHostInternalText } from './error-text.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { invokeCaptured } from './invocation.ts'
import type { IRegistration } from './registry.ts'
import { PluginHostCleanupMode, PluginHostRegistrationLifecycle } from './state-constants.ts'
import { markRegistrationRevoked } from './composition.ts'
import type {
  IPluginBeforeReleaseContext,
  IPluginDisposalContext
} from './plugin-lifecycle-types.ts'

type IPluginHostRemovalRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  /** Host-owned synchronous hook boundary, independent of the asynchronous cleanup wait. */
  readonly invokeHook: <T>(invoke: () => T) => T
  readonly pipelineLeases: IQuiescenceTracker<object>
  readonly executionSignal: INativeAbortSignal
  readonly cleanupRuntime: PluginHostCleanupRuntime
  readonly scheduler: IScheduler
  readonly disposeStepTimeoutMs: number | false
  readonly setHookRegistration: (
    registration: IRegistration<TDomainCore, TValue> | undefined
  ) => void
  readonly setBeforeReleaseRegistration: (registration: IRegistration<TDomainCore, TValue>) => void
  /** Clears the running-hook and pending-release marks only while this registration owns them. */
  readonly clearBeforeReleaseRegistrationIfOwner: (
    registration: IRegistration<TDomainCore, TValue>
  ) => void
  /** One state owner retires exact publication, dependency facts and stage leases. */
  readonly state: PluginHostState<TDomainCore, TValue>
}>

/** Owns logical revocation and ordered physical cleanup for plugin registrations. */
export class PluginHostRemovalRuntime<TDomainCore extends object, TValue> {
  /** Exact mutable registries and lifecycle authorities owned by the Host. */
  readonly #port: IPluginHostRemovalRuntimePort<TDomainCore, TValue>

  /** Retains exact publication, lease and lifecycle authorities used by every cleanup path. */
  constructor(port: IPluginHostRemovalRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Explicit mutation plans call this before any cleanup; terminal cleanup never invokes it. */
  assertRemovalAllowed(registration: IRegistration<TDomainCore, TValue>): void {
    /** Invoke receiverlessly; the original installer owns all domain state read by this predicate. */
    const allowed = registration.removalAdmission?.allowed
    if (allowed?.() === false)
      throw new PluginHostError(
        PluginHostErrorCode.lifecycleMutation,
        ERROR_TEXT.REMOVAL_LIFECYCLE_MUTATION(registration.name)
      )
  }

  /** Runs one installed registration's captured hook before any lease or publication is retired. */
  runBeforeRelease(
    registration: IRegistration<TDomainCore, TValue>
  ): Promise<ICleanupResult> | undefined {
    /** Captured pre-release authority runs once for a fully installed generation. */
    const hook = registration.plugin.beforeRelease
    if (!registration.installed || !hook || registration.beforeReleaseRan) return undefined
    registration.beforeReleaseRan = true
    /** Absolute boundary in the same clock that drives the bounded disposal step. */
    const deadlineAt =
      this.#port.disposeStepTimeoutMs === false
        ? undefined
        : this.#port.scheduler.now() + this.#port.disposeStepTimeoutMs
    /** The frozen hook context exposes the original signal and absolute cleanup deadline. */
    const context: IPluginBeforeReleaseContext = Object.freeze({
      signal: registration.lifecycleController?.signal ?? this.#port.executionSignal,
      deadlineAt,
      remainingMs: () =>
        deadlineAt === undefined ? undefined : Math.max(0, deadlineAt - this.#port.scheduler.now())
    })
    /** The native cleanup callback receives explicit invocation data instead of nested closures. */
    const invocation = { registration, hook, context }
    this.#port.setBeforeReleaseRegistration(registration)
    /** This hook owns no resources; observe only its actual asynchronous settlement. */
    const ledger = createSyncStartedDisposalLedger()
    return this.#port.cleanupRuntime
      .disposeGroup(
        [() => this.#invokeBeforeRelease(invocation)],
        ERROR_TEXT.BEFORE_RELEASE_PHASE,
        false,
        { cleanupLedger: ledger }
      )
      .then((errors) => this.#port.cleanupRuntime.complete(errors, ledger, false))
      .finally(() => {
        // The bounded group returns on timeout even when its hook Promise never settles.
        this.#port.clearBeforeReleaseRegistrationIfOwner(registration)
      })
  }

  /** Removes a registration from every committed registry without invoking user code. */
  revokeRegistration(registration: IRegistration<TDomainCore, TValue>): unknown[] {
    /**
     * Revocation and physical cleanup collect failures without interrupting later ownership
     * release.
     */
    const errors: unknown[] = []
    registration.removalAdmission = undefined
    markRegistrationRevoked(registration)
    registration.lifecycle = PluginHostRegistrationLifecycle.dispose
    registration.featureExposeValid = false
    this.#port.state.lanes.retireLeaseOwner(registration, this.#port.pipelineLeases)
    this.#detachStages(registration, errors)
    this.#removeOwnedPublication(registration)
    // The name-keyed slot retains its ordinal across a same-name reinstall. Composition-issued
    // tokens remain under their holder's explicit retireDataOrderSlot authority.
    registration.extensions = []
    registration.featureExpose = undefined
    registration.featureOutputs = undefined
    this.#abortRegistration(registration)
    return errors
  }

  /** Abort once with the original native rollback identity, before or during logical revocation. */
  #abortRegistration(registration: IRegistration<TDomainCore, TValue>): void {
    /** An earlier native failure keeps its exact signal reason rather than allocating a substitute. */
    const controller = registration.lifecycleController
    if (!controller || controller.signal.aborted) return
    // A native abort never throws: listener failures go to the host's own error reporting.
    controller.abort(
      new PluginHostError(PluginHostErrorCode.hostDisposing, ERROR_TEXT.HOST_DISPOSING)
    )
  }

  /** Completed candidates release held replies before rollback revokes their original pipelines. */
  async rollbackRegistration(
    registration: IRegistration<TDomainCore, TValue>
  ): Promise<readonly unknown[]> {
    /** Cleanup leaves are appended without replacing the installation transaction's primary. */
    const errors: unknown[] = []
    if (registration.installed) {
      this.#abortRegistration(registration)
      /** The same once guard, timeout and aggregation own ordinary and rollback pre-release. */
      const beforeRelease = this.runBeforeRelease(registration)
      if (beforeRelease) errors.push(...(await beforeRelease).cleanupErrors)
    }
    errors.push(...(await this.disposeRegistration(registration, true)).cleanupErrors)
    return errors
  }

  /** Uses the canonical resource owner with bounded steps or strict sequential completion. */
  disposeRegistration(
    registration: IRegistration<TDomainCore, TValue>,
    preserveErrorIdentity = false,
    mode: PluginHostCleanupMode = PluginHostCleanupMode.bounded,
    deadlineAt?: number
  ): Promise<ICleanupResult> {
    return this.#disposeRegistration(registration, preserveErrorIdentity, mode, false, deadlineAt)
  }

  /** Resets failed lazy installation without permanently revoking its registration identity. */
  resetRegistration(registration: IRegistration<TDomainCore, TValue>): Promise<ICleanupResult> {
    return this.#disposeRegistration(registration, true, PluginHostCleanupMode.bounded, true)
  }

  /** Runs the same physical cleanup for permanent removal and retryable installation rollback. */
  async #disposeRegistration(
    registration: IRegistration<TDomainCore, TValue>,
    preserveErrorIdentity: boolean,
    mode: PluginHostCleanupMode,
    reset: boolean,
    deadlineAt?: number
  ): Promise<ICleanupResult> {
    registration.cleanupMode = mode
    registration.cleanupDeadlineAt = deadlineAt
    /** The existing lifecycle ledger observes actual settlement beyond bounded cleanup. */
    const ledger = createSyncStartedDisposalLedger()
    registration.cleanupLedger = ledger
    /** Reset withdraws attempt visibility while permanent removal also revokes lifetime authority. */
    const errors: unknown[] = []
    if (reset) {
      registration.lifecycle = PluginHostRegistrationLifecycle.dispose
      registration.featureExposeValid = false
      this.#detachStages(registration, errors)
      this.#port.state.clearRegistrationPublication(registration)
      registration.extensions = []
    } else errors.push(...this.revokeRegistration(registration))
    if (
      (mode === PluginHostCleanupMode.unbounded || deadlineAt !== undefined) &&
      this.#port.pipelineLeases.count(registration.pipelineOwnerKey) > 0
    ) {
      /** The exact generation lease key owns any remaining physical pipeline work. */
      const drained = this.#port.pipelineLeases.whenZero(registration.pipelineOwnerKey)
      ledger.start(ERROR_TEXT.PIPELINE_LEASE_PHASE, () => drained)
      if (deadlineAt === undefined) await drained
      else if (!(await boundedWait(drained, deadlineAt, { scheduler: this.#port.scheduler })))
        errors.push(
          new PluginHostError(
            PluginHostErrorCode.pipelineDrainTimeout,
            ERROR_TEXT.PIPELINE_DRAIN_TIMEOUT(Math.max(0, deadlineAt - this.#port.scheduler.now()))
          )
        )
    }
    /** The admitted plugin disposer retains its captured original receiver. */
    const pluginDispose = this.#resolvePluginDispose(registration)
    /** Bounded cleanup retains only this exact generation and the captured disposer. */
    const disposal = { registration, pluginDispose }
    if (registration.installed && pluginDispose) {
      try {
        errors.push(
          ...(await this.#port.cleanupRuntime.disposeGroup(
            [
              async () => {
                this.#port.setHookRegistration(disposal.registration)
                try {
                  /** Invoke receiverlessly, matching the original captured cleanup function. */
                  const dispose = disposal.pluginDispose!
                  await dispose()
                } finally {
                  // A disposer that settles after its bounded step must not clear a later hook.
                  this.#port.clearBeforeReleaseRegistrationIfOwner(disposal.registration)
                }
              }
            ],
            PluginHostInternalText.PLUGIN_DISPOSE_PHASE,
            preserveErrorIdentity,
            registration
          ))
        )
      } finally {
        // The bounded group returns on timeout even when the disposer never settles; the Host
        // must accept mutations again once its cleanup step is over.
        this.#port.clearBeforeReleaseRegistrationIfOwner(registration)
      }
    }
    if (registration.provisional) {
      try {
        await registration.provisional.rollback()
      } catch (error) {
        if (error instanceof AggregateError) errors.push(...error.errors)
        else errors.push(error)
      }
      registration.provisional = undefined
    }
    // A failed commit can leave a transferred prefix in scope and a remainder in provisional.
    errors.push(
      ...(await this.#port.cleanupRuntime.disposeScope(
        registration.scope,
        PluginHostInternalText.RESOURCE_DISPOSER_PHASE,
        preserveErrorIdentity
      ))
    )
    if (reset) {
      registration.removalAdmission = undefined
      registration.scope = undefined
      registration.core = undefined
      registration.descriptor = undefined
      registration.setupOutput = undefined
      registration.featureExpose = undefined
      registration.featureOutputs = undefined
      registration.installed = false
      registration.activated = false
    } else this.#removeOwnedPublication(registration)
    registration.lifecycle = PluginHostRegistrationLifecycle.idle
    /** Logical cleanup seals before registration-local ledger authority is released. */
    const result = this.#port.cleanupRuntime.complete(errors, ledger, preserveErrorIdentity)
    registration.cleanupLedger = undefined
    return result
  }

  /** Detaches all exact stage entries even when one captured disposer fails. */
  #detachStages(registration: IRegistration<TDomainCore, TValue>, errors: unknown[]): void {
    detachRegistrationStages(registration, errors)
  }

  /** Captures the already-admitted plugin disposer without re-reading hostile owner properties. */
  #resolvePluginDispose(
    registration: IRegistration<TDomainCore, TValue>
  ): (() => void | PromiseLike<void>) | undefined {
    if (registration.plugin.dispose) return () => this.#invokePluginDispose(registration)
    /** The already captured symbol disposer is invoked through the same synchronous boundary. */
    const disposer = registration.plugin.disposer
    return disposer ? () => this.#port.invokeHook(disposer) : undefined
  }

  /** Invokes a pre-release callback under the original synchronous hook mark. */
  #invokeBeforeRelease(
    invocation: Readonly<{
      registration: IRegistration<TDomainCore, TValue>
      hook: NonNullable<IRegistration<TDomainCore, TValue>['plugin']['beforeRelease']>
      context: IPluginBeforeReleaseContext
    }>
  ): void | PromiseLike<void> {
    return this.#port.invokeHook(() =>
      invokeCaptured(invocation.hook, invocation.registration.plugin.owner, [invocation.context])
    )
  }

  /** Constructs disposal context at invocation time and preserves the captured plugin receiver. */
  #invokePluginDispose(registration: IRegistration<TDomainCore, TValue>): void | PromiseLike<void> {
    return this.#port.invokeHook(() =>
      invokeCaptured(registration.plugin.dispose!, registration.plugin.owner, [
        Object.freeze({
          signal: registration.lifecycleController?.signal ?? this.#port.executionSignal,
          deadlineAt: registration.cleanupDeadlineAt
        } satisfies IPluginDisposalContext)
      ])
    )
  }

  /** Removes extension capabilities still owned by the exact registration. */
  #removeOwnedPublication(registration: IRegistration<TDomainCore, TValue>): void {
    this.#port.state.closeRegistration(registration)
  }
}
