/**
 * Owns Host install, activation, replacement and dependency-removal orchestration; lifecycle and
 * dependency algorithms stay in their canonical packages.
 */

import ERROR_TEXT from '../../error-text.ts'
import { PluginHostError } from '../../errors.ts'

import { PluginHostErrorCode } from '../../error-code.ts'

import type { IPipelineDefinitions } from '../../pipeline-spec.ts'

import { PluginInactiveProviderPolicy } from '../../dependency-constants.ts'
import { planCoreInstallBatch } from '../../core-install-plan.ts'

import type { IRegistration } from '../../registry.ts'
import type { IPluginConstraint } from '../../plugin-definition-types.ts'

import type { IPluginHandle } from '../../plugin-handle-types.ts'

import type { IPluginHostRuntimeContext } from '../../host-runtime-context.ts'
import type { PluginHostRuntimePorts } from '../../host-runtime-ports.ts'

/** Owns native lazy activation and its single pending Promise per name. */
export class PluginHostActivationOperations<
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
  async #activateInOrder(
    registrations: readonly IRegistration<TDomainCore, TValue>[]
  ): Promise<void> {
    for (const registration of registrations)
      if (!registration.activated) await this.#context.installRuntime.activate(registration)
  }
  /** Lazy activation without dependency features has no provider graph to activate. */
  #validateBatch(
    entries: readonly import('../../registry.ts').IInstallEntry<TDomainCore, TValue>[],
    inactive: PluginInactiveProviderPolicy,
    roots?: readonly string[]
  ) {
    return (
      this.#context.validateInstallBatch?.(entries, inactive, roots) ??
      planCoreInstallBatch(entries)
    )
  }
}
