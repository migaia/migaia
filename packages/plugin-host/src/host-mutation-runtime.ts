/**
 * Owns Host install, activation, replacement and dependency-removal orchestration; lifecycle and
 * dependency algorithms stay in their canonical packages.
 */

import ERROR_TEXT from './error-text.ts'
import { PluginHostError } from './errors.ts'

import {
  preflightPluginDefinitions,
  type snapshotPluginDefinitions
} from './definition-snapshots.ts'

import { PluginHostErrorCode } from './error-code.ts'

import type { IPipelineDefinitions } from './pipeline-spec.ts'

import { reportDiagnostic } from './diagnostic-report.ts'

import { PluginInactiveProviderPolicy } from './dependency-constants.ts'
import { planCoreInstallBatch } from './core-install-plan.ts'
import { HostModuleText, HostModuleKey, CoreRemovalProjection } from './module-constants.ts'

import type { IRegistration } from './registry.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'

import type {
  IPluginHandleTuple,
  IPluginDependencyMutationOptions,
  IPluginDependencyPlan,
  IPluginRemoval
} from './plugin-handle-types.ts'

import type { IPluginHostRuntimeContext } from './host-runtime-context.ts'
import type { PluginHostRuntimePorts } from './host-runtime-ports.ts'

/** Coordinates public structural mutations over explicit canonical owners. */
export class PluginHostMutationRuntime<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
> {
  /** Host coordination facts and canonical runtime owners. */
  readonly #context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>
  /** Admission, queue and publication capabilities; no private runtime state is inspected. */
  readonly #port: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, TPipelines>
  /** Captures the Host context after all runtime owners are assembled. */
  constructor(
    context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>,
    port: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, TPipelines>
  ) {
    this.#context = context
    this.#port = port
  }
  /**
   * Captures input definitions now, then queues atomic installation and returns frozen handles in
   * input order. Dependencies determine execution order; eager consumers activate needed lazy
   * providers. Preflight failure runs no install hooks. Later construction failure rolls back this
   * batch in reverse order, retaining the primary cause under PLUGIN_INSTALL_FAILED and rollback
   * details; previously committed registrations remain installed.
   */
  use<TPlugins extends readonly IPluginConstraint<any>[]>(
    plugins: readonly IPluginConstraint<any>[]
  ): Promise<IPluginHandleTuple<TPlugins>> {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    /**
     * Definition snapshots are captured at public admission, before queued work can observe caller
     * mutation.
     */
    const definitions = this.#port.snapshotPlugins(plugins)
    return this.#port.enqueue(() => this.#installDefinitions<TPlugins>(definitions))
  }

  /** Runs the original queued install transaction without inserting another await boundary. */
  async #installDefinitions<TPlugins extends readonly IPluginConstraint<any>[]>(
    definitions: ReturnType<typeof snapshotPluginDefinitions<TDomainCore, TValue>>
  ): Promise<IPluginHandleTuple<TPlugins>> {
    /** Preflight admits every member before installation can produce side effects. */
    const entries = preflightPluginDefinitions(definitions, (name) =>
      this.#context.state.registrations.has(name)
    )
    // Validate every prerequisite before activating anything, so a rejected batch has no
    // activation side effect; then activate only the committed lazy providers that members
    // installing now actually require (lazy members stay lazy).
    const { activationOrder } = this.#validateBatch(entries, PluginInactiveProviderPolicy.admit)
    /** Committed lazy providers selected by capability's activation plan. */
    const activation = activationOrder.map((name) => this.#context.state.registrations.get(name)!)
    // Only await when something activates: install must otherwise start in this same turn so
    // the lifecycle-mutation guard observes the running hook synchronously.
    if (activation.length > 0) await this.#activateInOrder(activation)
    await this.#context.installRuntime.installBatch(entries)
    for (const entry of entries)
      await this.#context.resumeRuntime?.resumeAfterProvider(entry.name, true)
    return Object.freeze(
      entries.map((entry) => this.#port.createHandle(entry.name))
    ) as IPluginHandleTuple<TPlugins>
  }

  /**
   * Activates a lazy registration and required lazy providers, sharing one pending Promise per
   * name. Missing, disabled or suspended targets fail explicitly. Failed attempts clean up and may
   * be retried; success returns a name-addressed handle. Do not await this activation from itself.
   */

  /** Executes the queued lazy activation under the original provider-first order. */

  /**
   * Installs a same-name replacement before revoking the previous generation. Candidate failure
   * leaves the old provider live; after publication, dependent rebind/restart failures do not roll
   * the new provider back. Old captured callable extensions reject, while name-addressed handles
   * resolve the successor. Names that differ reject with REPLACE_NAME_MISMATCH before enqueue.
   */

  /** Installs constructor-time plugins synchronously or throws before the host escapes. */
  useSync<TViewPlugins extends readonly IPluginConstraint<any>[]>(
    plugins: readonly IPluginConstraint<any>[]
  ): IPluginHandleTuple<TViewPlugins> {
    try {
      this.#port.assertActive()
      this.#port.assertMutationAllowed()
      /**
       * Definition snapshots are captured at public admission, before queued work can observe
       * caller mutation.
       */
      const definitions = this.#port.snapshotPlugins(plugins)
      /** Preflight admits every member before installation can produce side effects. */
      const entries = preflightPluginDefinitions(definitions, (name) =>
        this.#context.state.registrations.has(name)
      )
      this.#context.installRuntime.installBatchSync(entries)
      for (const entry of entries) {
        if (
          !this.#context.resumeRuntime ||
          this.#context.resumeRuntime.planAfterProvider(entry.name, true).steps.length === 0
        )
          continue
        // Recovery drains, disposes and reinstalls registrations, so it must run inside the
        // mutation queue like every other structural change instead of racing queued mutations.
        /** Queued recovery for this entry; failures are reported, never rethrown to the caller. */
        const task = this.#port
          .enqueue(() => this.#context.resumeRuntime!.resumeAfterProvider(entry.name, true))
          .catch((error) => {
            reportDiagnostic(
              this.#context.diagnostic,
              ERROR_TEXT.DEPENDENT_RESTART_FAILED(entry.name, []),
              PluginHostErrorCode.dependentRestartFailed,
              error
            )
          })
        this.#context.pending.track(task)
      }
      return Object.freeze(
        entries.map((entry) => this.#port.createHandle(entry.name))
      ) as IPluginHandleTuple<TViewPlugins>
    } catch (error) {
      return this.#port.rethrowWithIdentity(error)
    }
  }

  /**
   * Validates one batch's dependency prerequisites against committed state without side effects.
   * Existing same-name nodes are projected with transaction-local dependencies for activation and
   * replacement validation.
   */
  /** Optional graph planning preserves the existing validated batch boundary. */
  #validateBatch(
    entries: readonly import('./registry.ts').IInstallEntry<TDomainCore, TValue>[],
    inactive: PluginInactiveProviderPolicy,
    roots?: readonly string[]
  ) {
    try {
      return (
        this.#context.validateInstallBatch?.(entries, inactive, roots) ??
        planCoreInstallBatch(entries)
      )
    } catch (error) {
      return this.#port.rethrowWithIdentity(error)
    }
  }

  /** Activates committed lazy registrations in the given provider-first order. */
  async #activateInOrder(
    registrations: readonly IRegistration<TDomainCore, TValue>[]
  ): Promise<void> {
    for (const registration of registrations)
      if (!registration.activated) await this.#context.installRuntime.activate(registration)
  }

  /** Applies the admitted dependency-removal plan or returns its side-effect-free projection. */
  unUse(
    name: string,
    options: IPluginDependencyMutationOptions = {}
  ): Promise<IPluginRemoval | IPluginDependencyPlan> {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    return this.#port.enqueue(() =>
      this.#context.featureOperations
        ? this.#context.featureOperations.remove(name, options)
        : this.#removeCore(name, options)
    )
  }

  /** Runs the admitted removal plan, retaining original cleanup ordering and commit finally. */
  /** Core-only removal retains the same before-release, drain and cleanup owners. */
  async #removeCore(
    name: string,
    options: IPluginDependencyMutationOptions
  ): Promise<IPluginRemoval> {
    const registration = this.#context.state.registrations.get(name)
    if (!registration)
      throw new PluginHostError(
        PluginHostErrorCode.pluginNotInstalled,
        ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
      )
    if (options.policy !== undefined || options.dryRun === true)
      throw new PluginHostError(PluginHostErrorCode.hostModuleMissing, HostModuleText.missing, {
        detail: { module: HostModuleKey.features }
      })
    this.#context.removalRuntime.assertRemovalAllowed(registration)
    /** Cleanup failures preserve execution order and the exact native failures. */
    const errors: unknown[] = []
    try {
      const before = this.#context.removalRuntime.runBeforeRelease(registration)
      if (before) errors.push(...(await before).cleanupErrors)
      await this.#port.drainLeases(registration, errors)
      errors.push(
        ...(await this.#context.removalRuntime.disposeRegistration(registration)).cleanupErrors
      )
      this.#context.state.removedNames.add(name)
    } finally {
      this.#context.state.commit()
    }
    const affected = Object.freeze({
      policy: CoreRemovalProjection.policy,
      order: Object.freeze([name]),
      steps: Object.freeze([Object.freeze({ name, action: CoreRemovalProjection.action })]),
      edges: Object.freeze([])
    })
    return errors.length === 0
      ? Object.freeze({ ok: true, affected })
      : Object.freeze({ ok: false, errors: Object.freeze(errors), affected })
  }
}
