import { containAsyncRejection } from '@migaia/lifecycle'
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
  IPluginDependencyPlan,
  IPluginRegistrationContext,
  IPluginHostDiagnostic
} from './typing.js'
import {
  findUnavailableProvider,
  planPluginDependencyMutation,
  readPluginBlockers
} from './dependency-runtime.js'

export type IPluginHostEnablementRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly state: PluginHostState<TDomainCore, TValue>
  readonly diagnostic: IPluginHostDiagnostic
}>

/** Host operations needed to serialize enablement without moving queue ownership. */
export type IPluginHostEnablementFacadePort<
  _THost,
  _TDomainCore extends object,
  _TValue
> = Readonly<{
  readonly assertActive: () => void
  readonly assertMutationAllowed: () => void
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>
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

  /** Exposes current registrations to the package-owned dependency planner. */
  registrations(): ReadonlyMap<string, IRegistration<TDomainCore, TValue>> {
    return this.#port.state.registrations
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

  /** Disables an installed registration atomically and reports whether state changed. */
  disable(registration: IRegistration<TDomainCore, TValue>): boolean {
    this.#assertCurrent(registration)
    if (!registration.enabled) return false
    registration.enabled = false
    this.#disabled.add(registration.name)
    this.#port.state.lanes.rebuild(
      this.#port.state.enabledRegistrations(),
      this.#port.state.stageSlots
    )
    registration.featureExposeValid = false
    this.#port.state.commit()
    this.#notify('onDisable', registration)
    return true
  }

  /** Enables an exact still-installed registration and restores its original stage ordering. */
  enable(registration: IRegistration<TDomainCore, TValue>): boolean {
    this.#assertCurrent(registration)
    if (registration.enabled) return false
    registration.enabled = true
    this.#disabled.delete(registration.name)
    registration.featureExposeValid = true
    this.#port.state.lanes.rebuild(
      this.#port.state.enabledRegistrations(),
      this.#port.state.stageSlots
    )
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
        const required = readPluginBlockers(name, runtime.registrations())
        if (required.length > 0 && !options.cascade)
          throw new PluginHostError(
            PluginHostErrorCode.dependencyBlocked,
            ERROR_TEXT.DEPENDENCY_BLOCKED(name),
            { detail: { blockedBy: required } }
          )
        const plan = planPluginDependencyMutation(name, runtime.registrations())
        if (options.dryRun) return plan satisfies IPluginDependencyPlan
        const disabled: IRegistration<TDomainCore, TValue>[] = []
        for (const pluginName of plan.order) {
          const dependent = runtime.requireInstalled(pluginName)
          if (runtime.disable(dependent)) disabled.push(dependent)
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
                for (const item of [...disabled].reverse()) runtime.enable(item)
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
      })
    },
    disabled: () => runtime.disabled()
  }) as unknown as IPluginEnablement<THost, TInstalled, TDomainCore, TValue>
}
