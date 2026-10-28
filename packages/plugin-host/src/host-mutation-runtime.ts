/**
 * Owns Host install, activation, replacement and dependency-removal orchestration; lifecycle and
 * dependency algorithms stay in their canonical packages.
 */

import ERROR_TEXT, { PluginHostError } from './error-text.ts'

import { preflightPluginDefinitions, snapshotPluginDefinitions } from './admission-runtime.ts'

import { PluginHostErrorCode } from './error-code.ts'

import type { IPipelineDefinitions } from './pipeline-spec.ts'

import { reportDiagnostic } from './diagnostic-report.ts'

import {
  DependencyAction,
  DependencyMutationKind,
  planDependencyMutation
} from '@migaia/capability/graph/dependency'

import {
  admitDependencyMutationOptions,
  PluginInactiveProviderPolicy,
  toPluginPlan,
  projectAffected,
  validateInstallBatch
} from './dependency-runtime.ts'

import type { IRegistration } from './registry.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'

import type {
  IPluginHandle,
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
    const definitions = snapshotPluginDefinitions<TDomainCore, TValue>(
      plugins,
      this.#context.trustedDefinitionReader
    )
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
      await this.#context.resumeRuntime.resumeAfterProvider(entry.name, true)
    return Object.freeze(
      entries.map((entry) => this.#port.createHandle(entry.name))
    ) as IPluginHandleTuple<TPlugins>
  }

  /**
   * Activates a lazy registration and required lazy providers, sharing one pending Promise per
   * name. Missing, disabled or suspended targets fail explicitly. Failed attempts clean up and may
   * be retried; success returns a name-addressed handle. Do not await this activation from itself.
   */
  activate(name: string): Promise<IPluginHandle<IPluginConstraint<any>>> {
    this.#port.assertActive()
    // Direct hook nesting must reject before coalescing. After an await, callers share the
    // request regardless of origin; a finite operation deadline bounds any resulting self-wait.
    if (this.#context.hookInvocationDepth > 0) this.#port.assertMutationAllowed()
    /** Same-name lazy requests share this exact pending Promise until its finally cleanup. */
    const current = this.#context.activationRequests.get(name)
    if (current) return current
    this.#port.assertMutationAllowed()
    /** The queue Promise is stored before later calls can join this activation. */
    const activation = this.#port
      .enqueue(() => this.#activateNow(name))
      .finally(() => {
        this.#context.activationRequests.delete(name)
      })
    this.#context.activationRequests.set(name, activation)
    return activation
  }

  /** Executes the queued lazy activation under the original provider-first order. */
  async #activateNow(name: string): Promise<IPluginHandle<IPluginConstraint<any>>> {
    /** Resolve the current exact registration once for this operation step. */
    const registration = this.#context.state.registrations.get(name)
    if (!registration)
      throw new PluginHostError(
        PluginHostErrorCode.pluginNotInstalled,
        ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
      )
    if (!registration.enabled)
      throw new PluginHostError(
        PluginHostErrorCode.pluginDisabled,
        ERROR_TEXT.PLUGIN_DISABLED(name)
      )
    if (registration.suspended)
      throw new PluginHostError(
        PluginHostErrorCode.pluginSuspended,
        ERROR_TEXT.PLUGIN_SUSPENDED(name)
      )
    if (!registration.activated) {
      // Validate first so a rejected activation leaves every lazy provider untouched; then
      // activate the lazy provider chain providers-first before this registration.
      const { activationOrder } = this.#validateBatch(
        [{ name, plugin: registration.plugin }],
        PluginInactiveProviderPolicy.admit,
        [name]
      )
      await this.#activateInOrder(
        activationOrder.map((provider) => this.#context.state.registrations.get(provider)!)
      )
      await this.#context.installRuntime.activate(registration)
    }
    return this.#port.createHandle(name)
  }

  /**
   * Installs a same-name replacement before revoking the previous generation. Candidate failure
   * leaves the old provider live; after publication, dependent rebind/restart failures do not roll
   * the new provider back. Old captured callable extensions reject, while name-addressed handles
   * resolve the successor. Names that differ reject with REPLACE_NAME_MISMATCH before enqueue.
   */
  replace<TPlugin extends IPluginConstraint<any>>(
    name: string,
    next: TPlugin
  ): Promise<IPluginHandle<TPlugin>> {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
    /**
     * Definition snapshots are captured at public admission, before queued work can observe caller
     * mutation.
     */
    const definitions = snapshotPluginDefinitions<TDomainCore, TValue>(
      [next],
      this.#context.trustedDefinitionReader
    )
    /** The snapshotted candidate is used consistently for name admission and replacement. */
    const definition = definitions[0]!
    if (definition.name !== name)
      return Promise.reject(
        new PluginHostError(
          PluginHostErrorCode.replaceNameMismatch,
          ERROR_TEXT.REPLACE_NAME_MISMATCH(name, definition.name)
        )
      )
    return this.#port.enqueue(async () => {
      /** Replacement retains this exact generation until the candidate publishes. */
      const previous = this.#context.state.registrations.get(name)
      if (!previous)
        throw new PluginHostError(
          PluginHostErrorCode.pluginNotInstalled,
          ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
        )
      if (previous.suspended)
        throw new PluginHostError(
          PluginHostErrorCode.pluginSuspended,
          ERROR_TEXT.PLUGIN_SUSPENDED(name)
        )
      await this.#context.replaceRuntime.replace(previous, definition)
      return this.#port.createHandle<TPlugin>(name)
    })
  }

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
      const definitions = snapshotPluginDefinitions<TDomainCore, TValue>(
        plugins,
        this.#context.trustedDefinitionReader
      )
      /** Preflight admits every member before installation can produce side effects. */
      const entries = preflightPluginDefinitions(definitions, (name) =>
        this.#context.state.registrations.has(name)
      )
      this.#context.installRuntime.installBatchSync(entries)
      for (const entry of entries) {
        if (this.#context.resumeRuntime.planAfterProvider(entry.name, true).steps.length === 0)
          continue
        // Recovery drains, disposes and reinstalls registrations, so it must run inside the
        // mutation queue like every other structural change instead of racing queued mutations.
        /** Queued recovery for this entry; failures are reported, never rethrown to the caller. */
        const task = this.#port
          .enqueue(() => this.#context.resumeRuntime.resumeAfterProvider(entry.name, true))
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
  #validateBatch(
    entries: readonly import('./registry.ts').IInstallEntry<TDomainCore, TValue>[],
    inactive: PluginInactiveProviderPolicy,
    activationRoots?: readonly string[]
  ): ReturnType<typeof validateInstallBatch<TDomainCore, TValue>> {
    try {
      return validateInstallBatch(entries, this.#context.state, inactive, activationRoots)
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
    return this.#port.enqueue(() => this.#removeNow(name, options))
  }

  /** Runs the admitted removal plan, retaining original cleanup ordering and commit finally. */
  async #removeNow(
    name: string,
    options: IPluginDependencyMutationOptions
  ): Promise<IPluginRemoval | IPluginDependencyPlan> {
    if (!this.#context.state.registrations.has(name))
      throw new PluginHostError(
        PluginHostErrorCode.pluginNotInstalled,
        ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
      )
    /** Validated breaking option shape and default reject policy. */
    const admitted = admitDependencyMutationOptions(options)
    /** Capability-owned dependency decision for this exact committed state. */
    const plan = planDependencyMutation(
      this.#context.state.dependencyIndex(),
      (pluginName) => this.#context.state.readDependencyState(pluginName),
      {
        roots: [name],
        kind: DependencyMutationKind.remove,
        policy: admitted.policy
      }
    )
    if (plan.blockedBy.length > 0)
      throw new PluginHostError(
        PluginHostErrorCode.dependencyBlocked,
        ERROR_TEXT.DEPENDENCY_BLOCKED(name),
        { detail: { blockedBy: plan.blockedBy } }
      )
    if (admitted.dryRun) return toPluginPlan(plan, admitted.policy)
    /** The complete removal is admitted atomically before cleanup can alter any registration. */
    for (const step of plan.steps) {
      if (step.action !== DependencyAction.release) continue
      /** A plan names only the current original registrations selected by the native owner. */
      const registration = this.#context.state.registrations.get(step.id)
      if (registration) this.#context.removalRuntime.assertRemovalAllowed(registration)
    }
    /** Cleanup failures accumulate in execution order without replacing the mutation result. */
    const cleanupErrors: unknown[] = []
    /** Names whose planned removal or suspension actually changed this Host. */
    const applied: string[] = []
    try {
      for (const step of plan.steps) {
        /** Resolve the current exact registration once for this operation step. */
        const registration = this.#context.state.registrations.get(step.id)
        if (!registration) continue
        try {
          if (step.action === DependencyAction.suspend) {
            if (this.#context.enablementRuntime.suspend(registration)) applied.push(step.id)
            continue
          }
          if (step.action !== DependencyAction.release) continue
          /** Only an installed hook produces a bounded pre-release result. */
          const beforeRelease = this.#context.removalRuntime.runBeforeRelease(registration)
          if (beforeRelease) cleanupErrors.push(...(await beforeRelease).cleanupErrors)
          await this.#port.drainLeases(registration, cleanupErrors)
          cleanupErrors.push(
            ...(await this.#context.removalRuntime.disposeRegistration(registration)).cleanupErrors
          )
          this.#context.enablementRuntime.forget(step.id)
          this.#context.state.removedNames.add(step.id)
          applied.push(step.id)
        } catch (error) {
          cleanupErrors.push(error)
          if (
            step.action === DependencyAction.release &&
            !this.#context.state.registrations.has(step.id)
          )
            applied.push(step.id)
        }
      }
    } finally {
      this.#context.state.commit()
    }
    /** The public receipt includes only changes actually applied by this plan. */
    const affected = projectAffected(plan, applied, admitted.policy)
    return cleanupErrors.length === 0
      ? Object.freeze({ ok: true as const, affected })
      : Object.freeze({ ok: false as const, errors: Object.freeze(cleanupErrors), affected })
  }
}
