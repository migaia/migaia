/**
 * Owns capability-planned suspended-dependent recovery without changing provider installation
 * results.
 */
import { reverseItems, appendCleanupErrors } from './cleanup-runtime.ts'
import type { PluginHostEnablementRuntime } from './enablement-runtime.ts'
import type { PluginHostRemovalRuntime } from './removal-runtime.ts'

import {
  DependencyAction,
  planResume,
  type IDependencyPlan
} from '@migaia/capability/graph/dependency'
import { reportDiagnostic } from './diagnostic-report.ts'
import { PluginHostErrorCode } from './error-code.ts'
import ERROR_TEXT, { PluginHostError } from './error-text.ts'
import type { PluginHostState } from './host-state.ts'
import type { PluginHostInstallRuntime } from './install-runtime.ts'
import type { IRegistration } from './registry.ts'
import type { IPluginHostDiagnostic } from './host-options-types.ts'
import type { PluginHostOperationRuntime } from './operation-runtime.ts'

/** Host authority used to resume suspended registrations after a provider becomes available. */
type IPluginHostResumeRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  /** Preserves the original synchronous rebind invocation and its asynchronous return value. */
  readonly invokeHook: <T>(invoke: () => T) => T
  /** Bounds each rebind hook by the Host mutation budget, like other lifecycle hooks. */
  readonly operations: PluginHostOperationRuntime
  readonly state: PluginHostState<TDomainCore, TValue>
  drainLeases(registration: IRegistration<TDomainCore, TValue>): Promise<void>
  readonly diagnostic: IPluginHostDiagnostic
  /** Existing installation owner keeps activation and candidate construction together. */
  readonly installation: PluginHostInstallRuntime<TDomainCore, TValue>
  /** Existing removal owner performs cleanup; the Host adds no forwarding layer. */
  readonly removal: PluginHostRemovalRuntime<TDomainCore, TValue>
  /** Existing enablement owner retains disabled-generation bookkeeping. */
  readonly enablement: PluginHostEnablementRuntime<TDomainCore, TValue>
}>

/** Executes capability-owned resume plans without making provider installation fail. */
export class PluginHostResumeRuntime<TDomainCore extends object, TValue> {
  /** Narrow host authority retained by the recovery coordinator. */
  readonly #port: IPluginHostResumeRuntimePort<TDomainCore, TValue>

  /** Retains canonical install, removal and state owners for recovery. */
  constructor(port: IPluginHostResumeRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Reads capability's recovery decision before a synchronous install queues any work. */
  planAfterProvider(
    provider: string,
    generationChanged: boolean,
    failedRebinds: ReadonlySet<string> = new Set()
  ): IDependencyPlan {
    return planResume(
      this.#port.state.dependencyIndex(),
      (name) => this.#port.state.readDependencyState(name),
      {
        provider,
        generationChanged,
        canRebind: (name) =>
          !failedRebinds.has(name) &&
          this.#port.state.registrations.get(name)?.plugin.onDependencyReplaced !== undefined
      }
    )
  }

  /** Restores every newly satisfiable suspended dependent of one available provider. */
  async resumeAfterProvider(provider: string, generationChanged: boolean): Promise<void> {
    /** Committed provider generation whose feature outputs are handed to rebind hooks. */
    const providerRegistration = this.#port.state.registrations.get(provider)
    if (!providerRegistration) return
    /** Capability-owned recovery decision for the provider's suspended dependents. */
    const plan = this.planAfterProvider(provider, generationChanged)
    if (plan.steps.length === 0) return
    /** Rebind hook failures, kept for the restart-failure aggregate after their own report. */
    const hookErrors: unknown[] = []
    /** Disposal failures of restarted generations, reported as cleanup diagnostics. */
    const cleanupErrors: unknown[] = []
    /** Names that capability planned to reinstall. */
    const restart = new Set<string>()
    for (const step of plan.steps)
      if (step.action === DependencyAction.restart) restart.add(step.id)
    for (const step of plan.steps)
      if (step.action === DependencyAction.invalidate) this.#invalidate(step.id)
    /** Hooks that failed and must be replanned as restart roots. */
    const failedRebinds = new Set<string>()
    for (const step of plan.steps) {
      /** Recovery acts only on the current committed generation selected by capability. */
      const registration = this.#port.state.registrations.get(step.id)
      if (!registration || restart.has(step.id)) continue
      if (step.action === DependencyAction.resume) {
        this.#port.state.setSuspended(registration, false)
        registration.featureExposeValid = true
      }
      if (step.action !== DependencyAction.rebind) continue
      /** Explicit invocation data preserves the original plugin-definition receiver. */
      const invocation = { registration, provider, providerRegistration }
      try {
        // An overdue rebind hook is a failed rebind and is replanned as a restart.
        this.#port.operations.begin(registration)
        await this.#port.operations.await(
          this.#port.invokeHook(() => invokeResumeRebind(invocation)),
          registration
        )
        this.#port.state.setSuspended(registration, false)
        registration.featureExposeValid = true
      } catch (error) {
        hookErrors.push(error)
        reportDiagnostic(
          this.#port.diagnostic,
          ERROR_TEXT.DEPENDENCY_REBIND_FAILED(registration.name, provider),
          undefined,
          error
        )
        failedRebinds.add(registration.name)
        this.#replanAfterHookFailure(provider, generationChanged, failedRebinds, restart)
      }
    }

    /** Provider-first canonical order retained for reinstall after dependent-first disposal. */
    const restartOrder: string[] = []
    for (const name of plan.order) if (restart.has(name)) restartOrder.push(name)
    /** Names already placed by capability order are tracked once before unmatched names append. */
    const ordered = new Set(restartOrder)
    for (const name of restart) if (!ordered.has(name)) restartOrder.push(name)
    /** Current exact generations preserve provider-first reinstall order. */
    const restarting: IRegistration<TDomainCore, TValue>[] = []
    for (const name of restartOrder) {
      /** A prior mutation can remove a name without manufacturing a replacement generation. */
      const registration = this.#port.state.registrations.get(name)
      if (registration) restarting.push(registration)
    }
    for (const registration of reverseItems(restarting)) {
      /** Pre-release completes before lease retirement and physical cleanup. */
      const beforeRelease = this.#port.removal.runBeforeRelease(registration)
      if (beforeRelease) appendCleanupErrors(cleanupErrors, (await beforeRelease).cleanupErrors)
      await this.#port.drainLeases(registration)
      appendCleanupErrors(
        cleanupErrors,
        (await this.#port.removal.disposeRegistration(registration)).cleanupErrors
      )
    }

    /** Original reinstall failure, unwrapped from the host install wrapper when present. */
    let restartFailure: unknown
    if (restarting.length > 0) {
      try {
        await this.#port.installation.installBatch(
          restarting.map((registration) => ({
            name: registration.name,
            plugin: registration.plugin,
            config: registration.config
          }))
        )
        for (const registration of restarting) {
          /**
           * A restarted generation inherits activation and enablement from its released
           * predecessor.
           */
          const current = this.#port.state.registrations.get(registration.name)
          if (!current) continue
          if (registration.activated && !current.activated)
            await this.#port.installation.activate(current)
          if (!registration.enabled) this.#port.enablement.disable(current)
        }
      } catch (error) {
        restartFailure =
          error instanceof PluginHostError && error.code === PluginHostErrorCode.pluginInstallFailed
            ? (error.cause ?? error)
            : error
        for (const registration of restarting)
          if (!this.#port.state.registrations.has(registration.name)) {
            this.#port.state.removedNames.add(registration.name)
            this.#port.enablement.forget(registration.name)
          }
      }
    }
    this.#port.state.commit()
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
  /** Marks a retained suspended registration stale without releasing its current instance. */
  #invalidate(name: string): void {
    /** Only a currently committed generation receives the capability invalidation. */
    const waiting = this.#port.state.registrations.get(name)
    if (waiting) this.#port.state.setStale(waiting, true)
  }

  /** Applies revised capability decisions to this recovery transaction after one failed rebind. */
  #replanAfterHookFailure(
    provider: string,
    generationChanged: boolean,
    failedRebinds: ReadonlySet<string>,
    restart: Set<string>
  ): void {
    for (const step of this.planAfterProvider(provider, generationChanged, failedRebinds).steps) {
      if (step.action === DependencyAction.restart) restart.add(step.id)
      else if (step.action === DependencyAction.invalidate) this.#invalidate(step.id)
    }
  }
}

/** Resume rebind retains the original definition receiver, provider name and committed outputs. */
type IResumeRebindInvocation<TDomainCore extends object, TValue> = Readonly<{
  readonly registration: IRegistration<TDomainCore, TValue>
  readonly provider: string
  readonly providerRegistration: IRegistration<TDomainCore, TValue>
}>

/** Calls the captured resume hook without assimilating or wrapping its returned value. */
function invokeResumeRebind<TDomainCore extends object, TValue>(
  invocation: IResumeRebindInvocation<TDomainCore, TValue>
): unknown {
  return invocation.registration.plugin.onDependencyReplaced!(
    invocation.provider,
    invocation.providerRegistration.featureOutputs ?? Object.freeze({})
  )
}
