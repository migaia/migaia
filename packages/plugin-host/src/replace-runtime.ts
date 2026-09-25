import { DependencyAction, planReplacement, planRestart } from '@migaia/capability/graph/dependency'
import { reportDiagnostic } from './diagnostic-report.js'
import { PluginHostErrorCode } from './error-code.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import type { PluginHostState } from './host-state.js'
import type { IInstallBatchContext } from './install-runtime.js'
import type { IInstallEntry, IRegistration } from './registry.js'
import type { IPluginHostDiagnostic } from './typing.js'

/** Narrow Host authority used by one replacement transaction; every call runs inside the queue. */
export type IPluginHostReplaceRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  /** Committed registrations by name, read after each publication. */
  readonly registrations: ReadonlyMap<string, IRegistration<TDomainCore, TValue>>
  /** Host-owned topology and registration status used by capability replacement plans. */
  readonly state: PluginHostState<TDomainCore, TValue>
  /** Installs a candidate batch; `publish: false` leaves publication to this runtime. */
  installBatch(
    entries: readonly IInstallEntry<TDomainCore, TValue>[],
    publish?: boolean,
    prepareBatch?: (batch: IInstallBatchContext<TDomainCore, TValue>) => void
  ): Promise<{
    readonly installed: readonly IRegistration<TDomainCore, TValue>[]
    readonly batch: IInstallBatchContext<TDomainCore, TValue>
  }>
  /** Publishes one prepared candidate at a single synchronous point. */
  publish(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): void
  /** Seals and drains pipeline leases held by one registration before its cleanup starts. */
  drainLeases(registration: IRegistration<TDomainCore, TValue>): Promise<void>
  /** Runs the registration's cleanup and returns every collected cleanup failure. */
  disposeRegistration(registration: IRegistration<TDomainCore, TValue>): Promise<unknown[]>
  /** Activates one committed lazy registration that was active before its restart. */
  activate(registration: IRegistration<TDomainCore, TValue>): Promise<void>
  /** Disables one current registration so a restarted or replaced plugin keeps its disabled state. */
  disable(registration: IRegistration<TDomainCore, TValue>): void
  /** Records a name that left the host through removal rather than replacement. */
  markRemoved(name: string): void
  /** Forgets enablement bookkeeping for a name that is no longer installed. */
  forget(name: string): void
  /** Rebuilds live lanes and advances the committed revision after the transaction settles. */
  settle(): void
  readonly diagnostic: IPluginHostDiagnostic
  /** Attributes a Host boundary error to the issuing Host. */
  decorateError<TError extends PluginHostError>(error: TError): TError
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
    const { installed, batch } = await this.#port.installBatch(
      [{ name, plugin: definition }],
      false,
      (candidate) => {
        for (const { key } of previous.extensions) candidate.extensionOwners.delete(key)
      }
    )
    const replacement = installed[0]!
    this.#port.publish([replacement], batch)
    if (!previous.enabled) this.#port.disable(replacement)

    const hookErrors: unknown[] = []
    const cleanupErrors: unknown[] = []
    /** Canonical replacement decision before any dependent hook executes. */
    const replacementPlan = planReplacement(
      this.#port.state.dependencyIndex(),
      (pluginName) => this.#port.state.readDependencyState(pluginName),
      {
        target: name,
        canRebind: (pluginName) =>
          this.#port.registrations.get(pluginName)?.plugin.onDependencyReplaced !== undefined
      }
    )
    /** Direct rebind failures that capability must expand into restart closures. */
    const failedRebinds: string[] = []
    for (const step of replacementPlan.steps) {
      if (step.action !== DependencyAction.rebind) continue
      const dependentName = step.id
      const dependent = this.#port.registrations.get(dependentName)
      if (!dependent) continue
      const hook = dependent.plugin.onDependencyReplaced!
      try {
        await hook(name, replacement.featureOutputs ?? Object.freeze({}))
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
      const registration = this.#port.registrations.get(step.id)
      if (registration) registration.stale = true
    }
    const restarted: IRegistration<TDomainCore, TValue>[] = []
    for (const restartName of restartPlan.steps
      .filter((step) => step.action === DependencyAction.restart)
      .map((step) => step.id)) {
      const registration = this.#port.registrations.get(restartName)
      if (!registration) continue
      restarted.push(registration)
      await this.#port.drainLeases(registration)
      cleanupErrors.push(...(await this.#port.disposeRegistration(registration)))
    }

    await this.#port.drainLeases(previous)
    cleanupErrors.push(...(await this.#port.disposeRegistration(previous)))

    let restartFailure: unknown
    if (restarted.length > 0) {
      try {
        await this.#port.installBatch(
          [...restarted].reverse().map((registration) => ({
            name: registration.name,
            plugin: registration.plugin,
            config: registration.config
          }))
        )
        // Restore each restarted generation's observable state: lazy members that were active
        // activate again (providers first), and disabled members stay disabled.
        for (const registration of [...restarted].reverse()) {
          const current = this.#port.registrations.get(registration.name)
          if (!current) continue
          if (registration.activated && !current.activated) await this.#port.activate(current)
          if (!registration.enabled) this.#port.disable(current)
        }
      } catch (error) {
        restartFailure = error
        for (const registration of restarted)
          if (!this.#port.registrations.has(registration.name)) {
            this.#port.markRemoved(registration.name)
            this.#port.forget(registration.name)
          }
      }
    }
    this.#port.settle()

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
