import type { IAbortSignal } from '@migaia/utils/promise'
import {
  boundedWait,
  createSyncStartedDisposalLedger,
  type ICleanupResult,
  type IQuiescenceTracker
} from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import { PluginHostCleanupRuntime } from './cleanup-runtime.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { invokeCaptured } from './invocation.js'
import type { IRegistration } from './registry.js'
import { PluginHostCleanupMode, PluginHostRegistrationLifecycle } from './state-constants.js'
import { markRegistrationRevoked } from './composition.js'
import type { IPluginBeforeReleaseContext, IPluginDisposalContext } from './typing.js'

type IPluginHostRemovalRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  /** Host-owned synchronous hook boundary, independent of the asynchronous cleanup wait. */
  readonly invokeHook: <T>(invoke: () => T) => T
  readonly registrations: Map<string, IRegistration<TDomainCore, TValue>>
  /** Removes an exact committed registration and its dependency node atomically. */
  readonly removeRegistration: (registration: IRegistration<TDomainCore, TValue>) => void
  /** Withdraws exact attempt publication while retaining the cold registration and topology. */
  readonly clearRegistrationPublication: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly pipelineLeases: IQuiescenceTracker<object>
  readonly retireLeaseOwner: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly host: object
  readonly executionSignal: IAbortSignal
  readonly cleanupRuntime: PluginHostCleanupRuntime
  readonly scheduler: IScheduler
  readonly disposeStepTimeoutMs: number | false
  readonly setHookRegistration: (
    registration: IRegistration<TDomainCore, TValue> | undefined
  ) => void
  readonly setBeforeReleaseRegistration: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly clearBeforeReleaseRegistrationIfOwner: (
    registration: IRegistration<TDomainCore, TValue>
  ) => void
}>

/** Owns logical revocation and ordered physical cleanup for plugin registrations. */
export class PluginHostRemovalRuntime<TDomainCore extends object, TValue> {
  /** Exact mutable registries and lifecycle authorities owned by the Host. */
  readonly #port: IPluginHostRemovalRuntimePort<TDomainCore, TValue>

  constructor(port: IPluginHostRemovalRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Runs one installed registration's captured hook before any lease or publication is retired. */
  runBeforeRelease(
    registration: IRegistration<TDomainCore, TValue>
  ): Promise<ICleanupResult> | undefined {
    const hook = registration.plugin.beforeRelease
    if (!registration.installed || !hook || registration.beforeReleaseRan) return undefined
    registration.beforeReleaseRan = true
    /** Absolute boundary in the same clock that drives the bounded disposal step. */
    const deadlineAt =
      this.#port.disposeStepTimeoutMs === false
        ? undefined
        : this.#port.scheduler.now() + this.#port.disposeStepTimeoutMs
    const context: IPluginBeforeReleaseContext = Object.freeze({
      signal: registration.lifecycleController?.signal ?? this.#port.executionSignal,
      deadlineAt,
      remainingMs: () =>
        deadlineAt === undefined ? undefined : Math.max(0, deadlineAt - this.#port.scheduler.now())
    })
    this.#port.setBeforeReleaseRegistration(registration)
    /** This hook owns no resources; observe only its actual asynchronous settlement. */
    const ledger = createSyncStartedDisposalLedger()
    return this.#port.cleanupRuntime
      .disposeGroup(
        [
          () =>
            this.#port.invokeHook(() => invokeCaptured(hook, registration.plugin.owner, [context]))
        ],
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
    const errors: unknown[] = []
    markRegistrationRevoked(registration)
    registration.lifecycle = PluginHostRegistrationLifecycle.dispose
    registration.featureExposeValid = false
    this.#port.retireLeaseOwner(registration)
    this.#detachStages(registration, errors)
    this.#removeOwnedPublication(registration)
    // The name-keyed slot retains its ordinal across a same-name reinstall. Composition-issued
    // tokens remain under their holder's explicit retireDataOrderSlot authority.
    registration.extensions = []
    registration.featureExpose = undefined
    registration.featureOutputs = undefined
    try {
      registration.lifecycleController?.abort(
        new PluginHostError(PluginHostErrorCode.hostDisposing, ERROR_TEXT.HOST_DISPOSING)
      )
    } catch (error) {
      errors.push(error)
    }
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
    const ledger = createSyncStartedDisposalLedger()
    registration.cleanupLedger = ledger
    /** Reset withdraws attempt visibility while permanent removal also revokes lifetime authority. */
    const errors: unknown[] = []
    if (reset) {
      registration.lifecycle = PluginHostRegistrationLifecycle.dispose
      registration.featureExposeValid = false
      this.#detachStages(registration, errors)
      this.#port.clearRegistrationPublication(registration)
      registration.extensions = []
    } else errors.push(...this.revokeRegistration(registration))
    if (
      (mode === PluginHostCleanupMode.unbounded || deadlineAt !== undefined) &&
      this.#port.pipelineLeases.count(registration.pipelineOwnerKey) > 0
    ) {
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
    const pluginDispose = this.#resolvePluginDispose(registration)
    if (registration.installed && pluginDispose)
      errors.push(
        ...(await this.#port.cleanupRuntime.disposeGroup(
          [
            async () => {
              this.#port.setHookRegistration(registration)
              try {
                await pluginDispose()
              } finally {
                this.#port.setHookRegistration(undefined)
              }
            }
          ],
          'plugin dispose hook',
          preserveErrorIdentity,
          registration
        ))
      )
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
        'resource disposer',
        preserveErrorIdentity
      ))
    )
    if (reset) {
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
    const result = this.#port.cleanupRuntime.complete(errors, ledger, preserveErrorIdentity)
    registration.cleanupLedger = undefined
    return result
  }

  /** Detaches all exact stage entries even when one captured disposer fails. */
  #detachStages(registration: IRegistration<TDomainCore, TValue>, errors: unknown[]): void {
    for (const detach of [...registration.pipelineDisposers].reverse()) {
      try {
        detach()
      } catch (error) {
        errors.push(error)
      }
    }
    registration.pipelineDisposers = []
    registration.stageEntries = []
  }

  /** Captures the already-admitted plugin disposer without re-reading hostile owner properties. */
  #resolvePluginDispose(
    registration: IRegistration<TDomainCore, TValue>
  ): (() => void | PromiseLike<void>) | undefined {
    if (registration.plugin.dispose)
      return () =>
        this.#port.invokeHook(() =>
          invokeCaptured(registration.plugin.dispose!, registration.plugin.owner, [
            Object.freeze({
              signal: registration.lifecycleController?.signal ?? this.#port.executionSignal,
              deadlineAt: registration.cleanupDeadlineAt
            } satisfies IPluginDisposalContext)
          ])
        )
    /** The already captured symbol disposer is invoked through the same synchronous boundary. */
    const disposer = registration.plugin.disposer
    return disposer ? () => this.#port.invokeHook(disposer) : undefined
  }

  /** Removes extension capabilities still owned by the exact registration. */
  #removeOwnedPublication(registration: IRegistration<TDomainCore, TValue>): void {
    this.#port.removeRegistration(registration)
  }
}
