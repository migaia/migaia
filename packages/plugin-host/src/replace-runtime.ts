/** Owns candidate-first replacement and capability-selected dependent rebind or restart. */
import { reverseItems, appendCleanupErrors } from './cleanup-runtime.ts'
import type { PluginHostEnablementRuntime } from './enablement-runtime.ts'
import type { PluginHostRemovalRuntime } from './removal-runtime.ts'

import {
  DependencyAction,
  planReplacement,
  planRestart,
  type IDependencyPlan
} from '@migaia/capability/graph/dependency'
import { reportDiagnostic } from './diagnostic-report.ts'
import { PluginHostErrorCode } from './error-code.ts'
import ERROR_TEXT, { PluginHostError } from './error-text.ts'
import type { PluginHostState } from './host-state.ts'
import type { IInstallBatchContext, PluginHostInstallRuntime } from './install-runtime.ts'
import type { IInstallEntry, IRegistration } from './registry.ts'
import type { IPluginHostDiagnostic } from './host-options-types.ts'
import type { PluginHostOperationRuntime } from './operation-runtime.ts'

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

  /** Retains canonical install, removal and state owners for replacement. */
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
    /** The original stable provider name owns all replacement plans and diagnostics. */
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
    /** The fully installed candidate becomes visible at the existing synchronous publication point. */
    const replacement = installed[0]!
    this.#port.publish([replacement], batch)
    if (!previous.enabled) this.#port.enablement.disable(replacement)

    /** Rebind failures remain ordered before cleanup failures in any restart aggregate. */
    const hookErrors: unknown[] = []
    /** Cleanup failures accumulate without rolling back a successfully published replacement. */
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
      /** Capability determines the exact consumer whose rebind hook runs next. */
      const dependentName = step.id
      /** Only the current committed dependent generation receives the new binding. */
      const dependent = this.#port.state.registrations.get(dependentName)
      if (!dependent) continue
      /** Explicit hook invocation keeps replacement's original receiverless call semantics. */
      const invocation = {
        hook: dependent.plugin.onDependencyReplaced!,
        provider: name,
        replacement
      }
      try {
        // A rebind hook that exceeds the mutation budget is a failed rebind and falls back to
        // restarting the dependent, instead of holding the mutation queue indefinitely.
        this.#port.operations.begin(dependent)
        await this.#port.operations.await(
          this.#port.invokeHook(() => invokeReplacementRebind(invocation)),
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
    const restartRoots: string[] = []
    for (const step of replacementPlan.steps)
      if (step.action === DependencyAction.restart) restartRoots.push(step.id)
    restartRoots.push(...failedRebinds)
    /** Failed rebinds expand through capability, preserving canonical dependent-first release order. */
    const restartPlan =
      restartRoots.length === 0
        ? replacementPlan
        : planRestart(
            this.#port.state.dependencyIndex(),
            (pluginName) => this.#port.state.readDependencyState(pluginName),
            restartRoots
          )
    /** Planned invalidations keep suspended instances without attempting installation. */
    this.#invalidatePlan(replacementPlan)
    this.#invalidatePlan(restartPlan)
    /**
     * Original released generations retain config and enablement facts for provider-first
     * reinstall.
     */
    const restarted: IRegistration<TDomainCore, TValue>[] = []
    for (const step of restartPlan.steps) {
      if (step.action !== DependencyAction.restart) continue
      /** Capability's step order is the dependent-first release order. */
      const restartName = step.id
      /** Only the committed generation selected by the plan is released or invalidated. */
      const registration = this.#port.state.registrations.get(restartName)
      if (!registration) continue
      restarted.push(registration)
      /** Pre-release completes before lease retirement and physical cleanup. */
      const beforeRelease = this.#port.removal.runBeforeRelease(registration)
      if (beforeRelease) appendCleanupErrors(cleanupErrors, (await beforeRelease).cleanupErrors)
      await this.#port.drainLeases(registration)
      appendCleanupErrors(
        cleanupErrors,
        (await this.#port.removal.disposeRegistration(registration)).cleanupErrors
      )
    }

    /** The former provider retires only after all selected dependents have released. */
    const beforeRelease = this.#port.removal.runBeforeRelease(previous)
    if (beforeRelease) appendCleanupErrors(cleanupErrors, (await beforeRelease).cleanupErrors)
    await this.#port.drainLeases(previous)
    appendCleanupErrors(
      cleanupErrors,
      (await this.#port.removal.disposeRegistration(previous)).cleanupErrors
    )

    /** A reinstall failure stays primary in the dependent-restart aggregate. */
    let restartFailure: unknown
    if (restarted.length > 0) {
      try {
        await this.#port.installation.installBatch(this.#restartEntries(restarted))
        // Restore each restarted generation's observable state: lazy members that were active
        // activate again (providers first), and disabled members stay disabled.
        for (const registration of reverseItems(restarted)) {
          /**
           * State restoration addresses the new generation rather than reviving the released
           * object.
           */
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
      /** The failure detail names exactly the original restart set in release order. */
      const names = restarted.map((registration) => registration.name)
      /** The existing diagnostic and aggregate share one stable public error message. */
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
  /** Applies planned invalidations without rebuilding a combined step collection. */
  #invalidatePlan(plan: IDependencyPlan): void {
    for (const step of plan.steps) {
      if (step.action !== DependencyAction.invalidate) continue
      /** Suspended generations remain installed while their exposed Feature binding is stale. */
      const registration = this.#port.state.registrations.get(step.id)
      if (registration) this.#port.state.setStale(registration, true)
    }
  }

  /** Builds provider-first reinstall entries from the dependent-first release order in one pass. */
  #restartEntries(
    registrations: readonly IRegistration<TDomainCore, TValue>[]
  ): IInstallEntry<TDomainCore, TValue>[] {
    /** Each original registration contributes one candidate with its captured configuration. */
    const entries: IInstallEntry<TDomainCore, TValue>[] = []
    for (const registration of reverseItems(registrations))
      entries.push({
        name: registration.name,
        plugin: registration.plugin,
        config: registration.config
      })
    return entries
  }
}

/** Receiverless replacement rebind invocation retains the old provider name and new outputs. */
type IReplacementRebindInvocation<TDomainCore extends object, TValue> = Readonly<{
  readonly hook: NonNullable<IRegistration<TDomainCore, TValue>['plugin']['onDependencyReplaced']>
  readonly provider: string
  readonly replacement: IRegistration<TDomainCore, TValue>
}>

/** Calls the captured replacement hook without introducing a receiver or assimilating its result. */
function invokeReplacementRebind<TDomainCore extends object, TValue>(
  invocation: IReplacementRebindInvocation<TDomainCore, TValue>
): unknown {
  /** Property access is separated from invocation to preserve the original receiverless call. */
  const hook = invocation.hook
  return hook(invocation.provider, invocation.replacement.featureOutputs ?? Object.freeze({}))
}
