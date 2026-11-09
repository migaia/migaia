/**
 * Owns Host install, activation, replacement and dependency-removal orchestration; lifecycle and
 * dependency algorithms stay in their canonical packages.
 */

import ERROR_TEXT from '../../error-text.ts'
import { PluginHostError } from '../../errors.ts'

import { PluginHostErrorCode } from '../../error-code.ts'

import type { IPipelineDefinitions } from '../../pipeline-spec.ts'

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

import type { IPluginConstraint } from '../../plugin-definition-types.ts'

import type {
  IPluginHandle,
  IPluginDependencyMutationOptions,
  IPluginDependencyPlan,
  IPluginRemoval
} from '../../plugin-handle-types.ts'

import type { IPluginHostRuntimeContext } from '../../host-runtime-context.ts'
import type { PluginHostRuntimePorts } from '../../host-runtime-ports.ts'

/** Owns feature-dependent removal planning and candidate replacement. */
export class PluginHostFeatureOperations<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[],
  TPipelines extends IPipelineDefinitions
> {
  /** Canonical host context supplies state and existing lifecycle owners. */
  readonly #context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>
  /** Borrowed admission, queue and publication owner; no new queue is allocated. */
  readonly #port: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, TPipelines>
  /** Retain the same host authorities as the normal mutation path. */
  constructor(
    context: IPluginHostRuntimeContext<TDomainCore, TValue, TInstalled, TPipelines>,
    port: PluginHostRuntimePorts<TDomainCore, TValue, TInstalled, TPipelines>
  ) {
    this.#context = context
    this.#port = port
  }
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
    const definitions = this.#port.snapshotPlugins([next])
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
      await this.#context.replaceRuntime!.replace(previous, definition)
      return this.#port.createHandle<TPlugin>(name)
    })
  }
  validateBatch(
    entries: readonly import('../../registry.ts').IInstallEntry<TDomainCore, TValue>[],
    inactive: PluginInactiveProviderPolicy = PluginInactiveProviderPolicy.reject,
    activationRoots?: readonly string[]
  ): ReturnType<typeof validateInstallBatch<TDomainCore, TValue>> {
    try {
      return validateInstallBatch(entries, this.#context.state, inactive, activationRoots)
    } catch (error) {
      return this.#port.rethrowWithIdentity(error)
    }
  }
  async remove(
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
            if (this.#context.state.suspendRegistration(registration)) applied.push(step.id)
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
          this.#context.enablementRuntime?.forget(step.id)
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
