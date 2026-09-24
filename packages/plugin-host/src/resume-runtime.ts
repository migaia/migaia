import { DependencyAction, planRestart, planResume } from '@migaia/capability/graph/dependency'
import { reportDiagnostic } from './diagnostic-report.js'
import { PluginHostErrorCode } from './error-code.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import type { PluginHostState } from './host-state.js'
import type { IInstallBatchContext } from './install-runtime.js'
import type { IInstallEntry, IRegistration } from './registry.js'
import type { IPluginHostDiagnostic } from './typing.js'

/** Host authority used to resume suspended registrations after a provider becomes available. */
export type IPluginHostResumeRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly state: PluginHostState<TDomainCore, TValue>
  drainLeases(registration: IRegistration<TDomainCore, TValue>): Promise<void>
  disposeRegistration(registration: IRegistration<TDomainCore, TValue>): Promise<unknown[]>
  installBatch(entries: readonly IInstallEntry<TDomainCore, TValue>[]): Promise<{
    readonly installed: readonly IRegistration<TDomainCore, TValue>[]
    readonly batch: IInstallBatchContext<TDomainCore, TValue>
  }>
  activate(registration: IRegistration<TDomainCore, TValue>): Promise<void>
  disable(registration: IRegistration<TDomainCore, TValue>): void
  markRemoved(name: string): void
  forget(name: string): void
  settle(): void
  readonly diagnostic: IPluginHostDiagnostic
}>

/** Executes capability-owned resume plans without making provider installation fail. */
export class PluginHostResumeRuntime<TDomainCore extends object, TValue> {
  /** Narrow host authority retained by the recovery coordinator. */
  readonly #port: IPluginHostResumeRuntimePort<TDomainCore, TValue>

  constructor(port: IPluginHostResumeRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /**
   * Whether `provider` has a suspended direct required dependent. Only such a dependent can make a
   * resume plan non-empty: a suspended chain always starts at a direct dependent of the provider
   * whose absence suspended it. The check costs O(direct dependents), so installing or enabling a
   * plugin without suspended dependents never walks its transitive closure (R1).
   */
  hasSuspendedDependents(provider: string): boolean {
    if (!this.#port.state.registrations.has(provider)) return false
    return this.#port.state
      .dependencyIndex()
      .dependents(provider)
      .required.some((name) => this.#port.state.registrations.get(name)?.suspended === true)
  }

  /** Restores every newly satisfiable suspended dependent of one available provider. */
  async resumeAfterProvider(provider: string, generationChanged: boolean): Promise<void> {
    if (!this.hasSuspendedDependents(provider)) return
    /** Committed provider generation whose feature outputs are handed to rebind hooks. */
    const providerRegistration = this.#port.state.registrations.get(provider)!
    /** Capability-owned recovery decision for the provider's suspended dependents. */
    const plan = planResume(
      this.#port.state.dependencyIndex(),
      (name) => this.#port.state.readDependencyStatus(name),
      {
        provider,
        generationChanged,
        canRebind: (name) =>
          this.#port.state.registrations.get(name)?.plugin.onDependencyReplaced !== undefined
      }
    )
    if (plan.steps.length === 0) return
    /** Rebind hook failures, kept for the restart-failure aggregate after their own report. */
    const hookErrors: unknown[] = []
    /** Disposal failures of restarted generations, reported as cleanup diagnostics. */
    const cleanupErrors: unknown[] = []
    /** Names that must reinstall: planned restarts plus closures of stale or failed rebinds. */
    const restart = new Set(
      plan.steps.filter((step) => step.action === DependencyAction.restart).map((step) => step.id)
    )
    /** Suspended nodes this plan can make available; only they may reinstall now. */
    const recoverable = new Set(plan.order)
    /**
     * Adds one root and its recoverable transitive required dependents to the reinstall set. A
     * dependent still waiting on another absent provider cannot reinstall yet (the batch would fail
     * and take its providers with it); it is marked to restart when it becomes recoverable.
     */
    const restartClosure = (root: string): void => {
      for (const name of planRestart(
        this.#port.state.dependencyIndex(),
        (pluginName) => this.#port.state.readDependencyStatus(pluginName),
        [root]
      ).order) {
        if (recoverable.has(name)) restart.add(name)
        else {
          const waiting = this.#port.state.registrations.get(name)
          if (waiting?.suspended) waiting.restartPending = true
        }
      }
    }
    // A provider this registration bound to was replaced while it was suspended: its instance is
    // stale, so neither resume nor rebind is sound and it reinstalls with its dependents.
    for (const step of plan.steps)
      if (this.#port.state.registrations.get(step.id)?.restartPending) restartClosure(step.id)
    for (const step of plan.steps) {
      const registration = this.#port.state.registrations.get(step.id)
      if (!registration || restart.has(step.id)) continue
      if (step.action === DependencyAction.resume) {
        registration.suspended = false
        registration.featureExposeValid = true
      }
      if (step.action !== DependencyAction.rebind) continue
      try {
        await registration.plugin.onDependencyReplaced!(
          provider,
          providerRegistration.featureOutputs ?? Object.freeze({})
        )
        registration.suspended = false
        registration.featureExposeValid = true
      } catch (error) {
        hookErrors.push(error)
        reportDiagnostic(
          this.#port.diagnostic,
          ERROR_TEXT.DEPENDENCY_REBIND_FAILED(registration.name, provider),
          undefined,
          error
        )
        restartClosure(registration.name)
      }
    }

    /** Provider-first canonical order retained for reinstall after dependent-first disposal. */
    const restartOrder = plan.order.filter((name) => restart.has(name)) as string[]
    for (const name of restart) if (!restartOrder.includes(name)) restartOrder.push(name)
    /** Current registrations to reinstall, provider-first. */
    const restarting = restartOrder
      .map((name) => this.#port.state.registrations.get(name))
      .filter((registration): registration is IRegistration<TDomainCore, TValue> => !!registration)
    for (const registration of [...restarting].reverse()) {
      await this.#port.drainLeases(registration)
      cleanupErrors.push(...(await this.#port.disposeRegistration(registration)))
    }

    /** Original reinstall failure, unwrapped from the host install wrapper when present. */
    let restartFailure: unknown
    if (restarting.length > 0) {
      try {
        await this.#port.installBatch(
          restarting.map((registration) => ({
            name: registration.name,
            plugin: registration.plugin,
            config: registration.config
          }))
        )
        for (const registration of restarting) {
          const current = this.#port.state.registrations.get(registration.name)
          if (!current) continue
          if (registration.activated && !current.activated) await this.#port.activate(current)
          if (!registration.enabled) this.#port.disable(current)
        }
      } catch (error) {
        restartFailure =
          error && typeof error === 'object' && 'cause' in error
            ? ((error as { readonly cause?: unknown }).cause ?? error)
            : error
        for (const registration of restarting)
          if (!this.#port.state.registrations.has(registration.name)) {
            this.#port.markRemoved(registration.name)
            this.#port.forget(registration.name)
          }
      }
    }
    this.#port.settle()
    if (restartFailure !== undefined) {
      /** Names of the restart set removed together with the failed reinstall batch. */
      const names = restarting.map((registration) => registration.name)
      /** Canonical diagnostic text shared by the report and the aggregate. */
      const text = ERROR_TEXT.DEPENDENT_RESTART_FAILED(provider, names)
      /** Coded failure whose cause keeps the original reinstall error at `errors[0]`. */
      const failure = new PluginHostError(PluginHostErrorCode.dependentRestartFailed, text, {
        cause: new AggregateError([restartFailure, ...hookErrors, ...cleanupErrors], text),
        detail: { dependents: Object.freeze(names) }
      })
      reportDiagnostic(
        this.#port.diagnostic,
        text,
        PluginHostErrorCode.dependentRestartFailed,
        failure
      )
    }
    for (const error of cleanupErrors)
      reportDiagnostic(
        this.#port.diagnostic,
        ERROR_TEXT.REPLACE_CLEANUP_FAILED(provider),
        PluginHostErrorCode.cleanupIncomplete,
        error
      )
  }
}
