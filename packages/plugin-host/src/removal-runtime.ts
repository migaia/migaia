import type { IAbortSignal, IQuiescenceTracker } from '@migaia/lifecycle'
import type { IScheduler } from '@migaia/utils/scheduler'
import { PluginHostCleanupRuntime } from './cleanup-runtime.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { invokeCaptured } from './invocation.js'
import type { IRegistration } from './registry.js'
import { PluginHostRegistrationLifecycle } from './state-constants.js'
import { markRegistrationRevoked } from './composition.js'
import type { IPluginBeforeReleaseContext, IPluginDisposalContext } from './typing.js'

type IPluginHostRemovalRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly registrations: Map<string, IRegistration<TDomainCore, TValue>>
  /** Removes an exact committed registration and its dependency node atomically. */
  readonly removeRegistration: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly extensionOwners: Map<PropertyKey, IRegistration<TDomainCore, TValue>>
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
  readonly clearHookRegistrationIfOwner: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly setReleasePending: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly clearReleasePendingIfOwner: (registration: IRegistration<TDomainCore, TValue>) => void
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
  ): Promise<unknown[]> | undefined {
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
    this.#port.setHookRegistration(registration)
    this.#port.setReleasePending(registration)
    return this.#port.cleanupRuntime
      .disposeGroup(
        [() => invokeCaptured(hook, registration.plugin.owner, [context])],
        ERROR_TEXT.BEFORE_RELEASE_PHASE
      )
      .finally(() => {
        // The bounded group returns on timeout even when its hook Promise never settles.
        this.#port.clearHookRegistrationIfOwner(registration)
        this.#port.clearReleasePendingIfOwner(registration)
      })
  }

  /** Removes a registration from every committed registry without invoking user code. */
  revokeRegistration(registration: IRegistration<TDomainCore, TValue>): unknown[] {
    const errors: unknown[] = []
    markRegistrationRevoked(registration)
    registration.lifecycle = PluginHostRegistrationLifecycle.dispose
    registration.featureExposeValid = false
    this.#port.retireLeaseOwner(registration)
    for (const detach of [...registration.pipelineDisposers].reverse()) {
      try {
        detach()
      } catch (error) {
        errors.push(error)
      }
    }
    registration.pipelineDisposers = []
    this.#port.removeRegistration(registration)
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

  /** Runs strict sequential physical cleanup after synchronous logical revocation. */
  async disposeRegistrationStrict(
    registration: IRegistration<TDomainCore, TValue>
  ): Promise<unknown[]> {
    const errors = this.revokeRegistration(registration)
    await this.#port.pipelineLeases.whenZero(registration.pipelineOwnerKey)
    const pluginDispose = this.#resolvePluginDispose(registration)
    if (registration.installed && pluginDispose) {
      this.#port.setHookRegistration(registration)
      try {
        await pluginDispose()
      } catch (error) {
        errors.push(error)
      } finally {
        this.#port.setHookRegistration(undefined)
      }
    }
    for (const entry of [...registration.resourceDisposers].reverse()) {
      registration.scope?.release(entry.resource)
      try {
        await entry.dispose()
      } catch (error) {
        errors.push(error)
      }
    }
    registration.resourceDisposers = []
    registration.scope?.close()
    this.#removeOwnedPublication(registration)
    registration.lifecycle = PluginHostRegistrationLifecycle.idle
    void registration.featurePending?.drain()
    return errors
  }

  /** Runs bounded normal cleanup and optionally preserves raw rollback error identities. */
  async disposeRegistration(
    registration: IRegistration<TDomainCore, TValue>,
    preserveErrorIdentity = false
  ): Promise<unknown[]> {
    const errors = this.revokeRegistration(registration)
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
          preserveErrorIdentity
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
    } else {
      errors.push(
        ...(await this.#port.cleanupRuntime.disposeScope(
          registration.scope,
          'resource disposer',
          preserveErrorIdentity
        ))
      )
    }
    this.#removeOwnedPublication(registration)
    registration.lifecycle = PluginHostRegistrationLifecycle.idle
    return errors
  }

  /** Captures the already-admitted plugin disposer without re-reading hostile owner properties. */
  #resolvePluginDispose(
    registration: IRegistration<TDomainCore, TValue>
  ): (() => void | PromiseLike<void>) | undefined {
    if (registration.plugin.dispose)
      return () =>
        invokeCaptured(registration.plugin.dispose!, registration.plugin.owner, [
          Object.freeze({
            signal: registration.lifecycleController?.signal ?? this.#port.executionSignal,
            deadlineAt: undefined
          } satisfies IPluginDisposalContext)
        ])
    return registration.plugin.disposer
  }

  /** Removes extension capabilities still owned by the exact registration. */
  #removeOwnedPublication(registration: IRegistration<TDomainCore, TValue>): void {
    for (const { key } of [...registration.extensions].reverse())
      if (this.#port.extensionOwners.get(key) === registration)
        this.#port.extensionOwners.delete(key)
    this.#port.removeRegistration(registration)
  }
}
