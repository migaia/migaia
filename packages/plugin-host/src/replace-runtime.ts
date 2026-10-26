import type { PluginHostEnablementRuntime } from './enablement-runtime.js'
import type { PluginHostRemovalRuntime } from './removal-runtime.js'

import { DependencyAction, planReplacement, planRestart } from '@migaia/capability/graph/dependency'
import { reportDiagnostic } from './diagnostic-report.js'
import { PluginHostErrorCode } from './error-code.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import type { PluginHostState } from './host-state.js'
import type { IInstallBatchContext, PluginHostInstallRuntime } from './install-runtime.js'
import type { IInstallEntry, IRegistration } from './registry.js'
import type { IPluginHostDiagnostic } from './typing.js'
import type { PluginHostOperationRuntime } from './operation-runtime.js'

/** Narrow Host authority used by one replacement transaction; every call runs inside the queue. */
type IPluginHostReplaceRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  /** Marks only the original synchronous rebind call, leaving async waiting to its owner. */
  readonly invokeHook: <T>(invoke: () => T) => T
  /** Bounds each rebind hook by the Host mutation budget, like other lifecycle hooks. */
  readonly operations: PluginHostOperationRuntime
  /** Host-owned topology and registration status used by capability replacement plans. */
  readonly state: PluginHostState<TDomainCore, TValue>
  /** Publishes one prepared candidate at a single synchronous point. */
  publish(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): void
  /** Seals and drains pipeline leases held by one registration before its cleanup starts. */
  drainLeases(registration: IRegistration<TDomainCore, TValue>): Promise<void>
  readonly diagnostic: IPluginHostDiagnostic
  /** Attributes a Host boundary error to the issuing Host. */
  decorateError<TError extends PluginHostError>(error: TError): TError
  /** Existing installation owner keeps activation and candidate construction together. */
  readonly installation: PluginHostInstallRuntime<TDomainCore, TValue>
  /** Existing removal owner performs cleanup; the Host adds no forwarding layer. */
  readonly removal: PluginHostRemovalRuntime<TDomainCore, TValue>
  /** Existing enablement owner retains disabled-generation bookkeeping. */
  readonly enablement: PluginHostEnablementRuntime<TDomainCore, TValue>
}>

/**
 * Owns hot replacement: install the candidate first, then rebind or restart dependents, then retire
 * the previous generation after its pipeline leases drain. A failed candidate install leaves the
 * previous generation serving; a failed dependent restart never un-publishes the replacement.
 */
export class PluginHostReplaceRuntime<TDomainCore extends object, TValue> {
  /** Host authority used by the transaction. */
  readonly #port: IPluginHostReplaceRuntimePort<TDomainCore, TValue>

  constructor(port: IPluginHostReplaceRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /**
   * Replaces `previous` with `definition`. Throws the candidate install failure unchanged in shape
   * (previous keeps serving), or `DEPENDENT_RESTART_FAILED` after the replacement committed when a
   * restart closure could not reinstall; cleanup failures of a successful replacement are
   * reported.
   */
  async replace(
    previous: IRegistration<TDomainCore, TValue>,
    definition: IInstallEntry<TDomainCore, TValue>['plugin']
  ): Promise<void> {
    const name = previous.name
    /** Existing restart planning includes the original fallback when any dependent rebind fails. */
    const removalPlan = planRestart(
      this.#port.state.dependencyIndex(),
      (pluginName) => this.#port.state.readDependencyState(pluginName),
      [name]
    )
    this.#port.removal.assertRemovalAllowed(previous)
    for (const step of removalPlan.steps) {
      if (step.id === name || step.action !== DependencyAction.restart) continue
      /** Reject before candidate setup, publication or a dependent hook can change live state. */
      const registration = this.#port.state.registrations.get(step.id)
      if (registration) this.#port.removal.assertRemovalAllowed(registration)
    }
    const { installed, batch } = await this.#port.installation.installBatch(
      [{ name, plugin: definition }],
      false,
      (candidate) => {
        candidate.releasedOwners.add(previous)
      }
    )
    const replacement = installed[0]!
    this.#port.publish([replacement], batch)
    if (!previous.enabled) this.#port.enablement.disable(replacement)

    const hookErrors: unknown[] = []
    const cleanupErrors: unknown[] = []
    /** Canonical replacement decision before any dependent hook executes. */
    const replacementPlan = planReplacement(
      this.#port.state.dependencyIndex(),
      (pluginName) => this.#port.state.readDependencyState(pluginName),
      {
        target: name,
        canRebind: (pluginName) =>
          this.#port.state.registrations.get(pluginName)?.plugin.onDependencyReplaced !== undefined
      }
    )
    /** Direct rebind failures that capability must expand into restart closures. */
    const failedRebinds: string[] = []
    for (const step of replacementPlan.steps) {
      if (step.action !== DependencyAction.rebind) continue
      const dependentName = step.id
      const dependent = this.#port.state.registrations.get(dependentName)
      if (!dependent) continue
      const hook = dependent.plugin.onDependencyReplaced!
      try {
        // A rebind hook that exceeds the mutation budget is a failed rebind and falls back to
        // restarting the dependent, instead of holding the mutation queue indefinitely.
        this.#port.operations.begin(dependent)
        await this.#port.operations.await(
          this.#port.invokeHook(() => hook(name, replacement.featureOutputs ?? Object.freeze({}))),
          dependent
        )
      } catch (error) {
        hookErrors.push(error)
        failedRebinds.push(dependentName)
        reportDiagnostic(
          this.#port.diagnostic,
          ERROR_TEXT.DEPENDENCY_REBIND_FAILED(dependentName, name),
          undefined,
          error
        )
      }
    }

    /** Initial non-rebindable closure plus failed rebind closures, dependents first. */
    const restartRoots = [
      ...replacementPlan.steps
        .filter((step) => step.action === DependencyAction.restart)
        .map((step) => step.id),
      ...failedRebinds
    ]
    const restartPlan =
      restartRoots.length === 0
        ? replacementPlan
        : planRestart(
            this.#port.state.dependencyIndex(),
            (pluginName) => this.#port.state.readDependencyState(pluginName),
            restartRoots
          )
    /** Planned invalidations keep suspended instances without attempting installation. */
    for (const step of [...replacementPlan.steps, ...restartPlan.steps]) {
      if (step.action !== DependencyAction.invalidate) continue
      const registration = this.#port.state.registrations.get(step.id)
      if (registration) this.#port.state.setStale(registration, true)
    }
    const restarted: IRegistration<TDomainCore, TValue>[] = []
    for (const restartName of restartPlan.steps
      .filter((step) => step.action === DependencyAction.restart)
      .map((step) => step.id)) {
      const registration = this.#port.state.registrations.get(restartName)
      if (!registration) continue
      restarted.push(registration)
      const beforeRelease = this.#port.removal.runBeforeRelease(registration)
      if (beforeRelease) cleanupErrors.push(...(await beforeRelease).cleanupErrors)
      await this.#port.drainLeases(registration)
      cleanupErrors.push(
        ...(await this.#port.removal.disposeRegistration(registration)).cleanupErrors
      )
    }

    const beforeRelease = this.#port.removal.runBeforeRelease(previous)
    if (beforeRelease) cleanupErrors.push(...(await beforeRelease).cleanupErrors)
    await this.#port.drainLeases(previous)
    cleanupErrors.push(...(await this.#port.removal.disposeRegistration(previous)).cleanupErrors)

    let restartFailure: unknown
    if (restarted.length > 0) {
      try {
        await this.#port.installation.installBatch(
          [...restarted].reverse().map((registration) => ({
            name: registration.name,
            plugin: registration.plugin,
            config: registration.config
          }))
        )
        // Restore each restarted generation's observable state: lazy members that were active
        // activate again (providers first), and disabled members stay disabled.
        for (const registration of [...restarted].reverse()) {
          const current = this.#port.state.registrations.get(registration.name)
          if (!current) continue
          if (registration.activated && !current.activated)
            await this.#port.installation.activate(current)
          if (!registration.enabled) this.#port.enablement.disable(current)
        }
      } catch (error) {
        restartFailure = error
        for (const registration of restarted)
          if (!this.#port.state.registrations.has(registration.name)) {
            this.#port.state.removedNames.add(registration.name)
            this.#port.enablement.forget(registration.name)
          }
      }
    }
    this.#port.state.commit()

    if (restartFailure !== undefined) {
      const names = restarted.map((registration) => registration.name)
      const text = ERROR_TEXT.DEPENDENT_RESTART_FAILED(name, names)
      throw this.#port.decorateError(
        new PluginHostError(PluginHostErrorCode.dependentRestartFailed, text, {
          cause: new AggregateError([restartFailure, ...hookErrors, ...cleanupErrors], text),
          detail: { dependents: Object.freeze(names) }
        })
      )
    }
    for (const error of cleanupErrors)
      reportDiagnostic(
        this.#port.diagnostic,
        ERROR_TEXT.REPLACE_CLEANUP_FAILED(name),
        PluginHostErrorCode.cleanupIncomplete,
        error
      )
  }
}
