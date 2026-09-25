import { containAsyncRejection } from '@migaia/lifecycle'
import {
  DependencyAction,
  DependencyMutationKind,
  planDependencyMutation,
  type DependencyPolicy,
  type IDependencyPlan
} from '@migaia/capability/graph/dependency'
import { reportDiagnostic } from './diagnostic-report.js'
import { invokeCaptured } from './invocation.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type { PluginHostState } from './host-state.js'
import type { IRegistration } from './registry.js'
import type {
  IPluginConstraint,
  IPluginEnablement,
  IPluginDependencyMutationOptions,
  IPluginRegistrationContext,
  IPluginHostDiagnostic
} from './typing.js'
import {
  admitDependencyMutationOptions,
  findUnavailableProvider,
  toPluginPlan
} from './dependency-runtime.js'

type IPluginHostEnablementRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly state: PluginHostState<TDomainCore, TValue>
  readonly diagnostic: IPluginHostDiagnostic
}>

/** Host operations needed to serialize enablement without moving queue ownership. */
type IPluginHostEnablementFacadePort<_THost, _TDomainCore extends object, _TValue> = Readonly<{
  readonly assertActive: () => void
  readonly assertMutationAllowed: () => void
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>
  readonly resumeAfterProvider: (provider: string, generationChanged: boolean) => Promise<void>
}>

/** Owns reversible plugin reachability without taking over resource lifecycle ownership. */
export class PluginHostEnablementRuntime<TDomainCore extends object, TValue> {
  /** Host state and diagnostic boundary used by every enablement transition. */
  readonly #port: IPluginHostEnablementRuntimePort<TDomainCore, TValue>
  /** Disabled names in transition order; enabling removes the corresponding entry. */
  readonly #disabled = new Set<string>()

  constructor(port: IPluginHostEnablementRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Resolves one exact installed registration or reports the existing not-installed contract. */
  requireInstalled(name: string): IRegistration<TDomainCore, TValue> {
    const registration = this.#port.state.registrations.get(name)
    if (!registration)
      throw new PluginHostError(
        PluginHostErrorCode.pluginNotInstalled,
        ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
      )
    return registration
  }

  /**
   * Rejects enabling `registration` while one of its required providers is disabled or gone; a
   * dependent must never serve against a provider that is not serving.
   */
  assertProvidersAvailable(
    registration: IRegistration<TDomainCore, TValue>,
    enabling: ReadonlySet<string> = new Set()
  ): void {
    const unavailable = findUnavailableProvider(
      registration,
      this.#port.state.registrations,
      this.#port.state.removedNames,
      enabling
    )
    if (unavailable) throw unavailable
  }

  /** Plans one disable request against this runtime's current host state. */
  planDisable(name: string, policy: DependencyPolicy): IDependencyPlan {
    return planDependencyMutation(
      this.#port.state.dependencyIndex(),
      (pluginName) => this.#port.state.readDependencyState(pluginName),
      { roots: [name], kind: DependencyMutationKind.disable, policy }
    )
  }

  /** Disables an installed registration atomically and reports whether state changed. */
  disable(registration: IRegistration<TDomainCore, TValue>): boolean {
    this.#assertCurrent(registration)
    if (!registration.enabled) return false
    this.#port.state.setEnabled(registration, false)
    this.#disabled.add(registration.name)
    registration.featureExposeValid = false
    this.#port.state.commit()
    this.#notify('onDisable', registration)
    return true
  }

  /** Suspends one dependent without disabling or disposing its retained registration. */
  suspend(registration: IRegistration<TDomainCore, TValue>): boolean {
    this.#assertCurrent(registration)
    if (registration.suspended) return false
    this.#port.state.setSuspended(registration, true)
    registration.featureExposeValid = false
    this.#port.state.commit()
    return true
  }

  /** Enables an exact still-installed registration and restores its original stage ordering. */
  enable(registration: IRegistration<TDomainCore, TValue>): boolean {
    this.#assertCurrent(registration)
    if (registration.enabled) return false
    this.#port.state.setEnabled(registration, true)
    this.#disabled.delete(registration.name)
    registration.featureExposeValid = true
    this.#port.state.commit()
    this.#notify('onEnable', registration)
    return true
  }

  /** Names currently disabled, in the order their disabling transitions committed. */
  disabled(): readonly string[] {
    return Object.freeze([...this.#disabled])
  }

  /** Removes a disabled-list entry after the registration is actually uninstalled. */
  forget(name: string): void {
    this.#disabled.delete(name)
  }

  /** Sends the initial installation notification after publication commits. */
  notifyInstalled(registration: IRegistration<TDomainCore, TValue>): void {
    this.#notify('onEnable', registration)
  }

  /** Rejects a stale token whose exact registration is no longer installed. */
  #assertCurrent(registration: IRegistration<TDomainCore, TValue>): void {
    if (this.#port.state.registrations.get(registration.name) !== registration)
      throw new PluginHostError(
        PluginHostErrorCode.pluginNotInstalled,
        ERROR_TEXT.PLUGIN_NOT_INSTALLED(registration.name)
      )
  }

  /** Runs one captured notification hook; failure is diagnostic-only and never rolls state back. */
  #notify(hook: 'onEnable' | 'onDisable', registration: IRegistration<TDomainCore, TValue>): void {
    const callback = registration.plugin[hook]
    if (!callback) return
    const report = (error: unknown): void => {
      reportDiagnostic(
        this.#port.diagnostic,
        ERROR_TEXT.ENABLEMENT_HOOK_FAILED(registration.name, hook, error),
        PluginHostErrorCode.pluginInstallFailed,
        error
      )
    }
    const context = Object.freeze({
      signal: registration.lifecycleController!.signal
    }) satisfies IPluginRegistrationContext
    try {
      containAsyncRejection(invokeCaptured(callback, registration.plugin.owner, [context]), report)
    } catch (error) {
      report(error)
    }
  }
}

/** Exposes typed enablement while the runtime owns transitions and Host keeps FIFO admission. */
export const createPluginHostEnablementFacade = <
  THost,
  TInstalled extends readonly IPluginConstraint<any>[],
  TDomainCore extends object,
  TValue
>(
  runtime: PluginHostEnablementRuntime<TDomainCore, TValue>,
  port: IPluginHostEnablementFacadePort<THost, TDomainCore, TValue>
): IPluginEnablement<THost, TInstalled, TDomainCore, TValue> => {
  /** Rejects terminal or reentrant calls before they enter the mutation queue. */
  const admit = (): void => {
    port.assertActive()
    port.assertMutationAllowed()
  }
  return Object.freeze({
    disable: async (name: string, options: IPluginDependencyMutationOptions = {}) => {
      admit()
      return port.enqueue(async () => {
        runtime.requireInstalled(name)
        /** Validated breaking option shape and default reject policy. */
        const admitted = admitDependencyMutationOptions(options)
        /** Capability-owned decision for this disable mutation. */
        const plan = runtime.planDisable(name, admitted.policy)
        if (plan.blockedBy.length > 0)
          throw new PluginHostError(
            PluginHostErrorCode.dependencyBlocked,
            ERROR_TEXT.DEPENDENCY_BLOCKED(name),
            { detail: { blockedBy: plan.blockedBy } }
          )
        if (admitted.dryRun) return toPluginPlan(plan, admitted.policy)
        const disabled: IRegistration<TDomainCore, TValue>[] = []
        for (const step of plan.steps) {
          const dependent = runtime.requireInstalled(step.id)
          if (step.action === DependencyAction.suspend) runtime.suspend(dependent)
          else if (step.action === DependencyAction.disable && runtime.disable(dependent))
            disabled.push(dependent)
        }
        return Object.freeze({
          token: Object.freeze({
            name,
            enable: async () => {
              admit()
              return port.enqueue(async () => {
                // Check the whole restore set first so a rejected token enables nothing.
                const enabling = new Set(disabled.map((item) => item.name))
                for (const item of disabled) runtime.assertProvidersAvailable(item, enabling)
                for (const item of [...disabled].reverse()) {
                  runtime.enable(item)
                  await port.resumeAfterProvider(item.name, false)
                }
              })
            }
          })
        })
      })
    },
    enable: async (name: string) => {
      admit()
      return port.enqueue(async () => {
        const registration = runtime.requireInstalled(name)
        runtime.assertProvidersAvailable(registration)
        runtime.enable(registration)
        await port.resumeAfterProvider(name, false)
      })
    },
    disabled: () => runtime.disabled()
  }) as unknown as IPluginEnablement<THost, TInstalled, TDomainCore, TValue>
}
