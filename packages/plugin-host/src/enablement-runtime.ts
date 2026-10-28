import { containAsyncRejection, createAbortController } from '@migaia/lifecycle'
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
import type { IPluginConstraint } from './plugin-definition-types.js'
import type { IPluginEnablement, IPluginDependencyMutationOptions } from './plugin-handle-types.js'
import type { IPluginRegistrationContext } from './plugin-lifecycle-types.js'
import type { IPluginHostDiagnostic } from './host-options-types.js'
import {
  admitDependencyMutationOptions,
  findUnavailableProvider,
  toPluginPlan
} from './dependency-runtime.js'

type IPluginHostEnablementRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  /** Marks synchronous notification reentry without extending the marker over its Promise. */
  readonly invokeHook: <T>(invoke: () => T) => T
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
      signal: (registration.lifecycleController ??= createAbortController()).signal
    }) satisfies IPluginRegistrationContext
    try {
      containAsyncRejection(
        this.#port.invokeHook(() => invokeCaptured(callback, registration.plugin.owner, [context])),
        report
      )
    } catch (error) {
      report(error)
    }
  }
}

/** Restore token returned by one disable call; enabling it restores exactly that disabled set. */
class PluginHostEnablementToken<TDomainCore extends object, TValue> {
  /** Name the disable call targeted. */
  readonly name: string
  /** Facade-owned restore, run under the facade's admission and queue. */
  readonly #restore: (disabled: readonly IRegistration<TDomainCore, TValue>[]) => Promise<void>
  /** Registrations this disable call actually disabled, in disable order. */
  readonly #disabled: readonly IRegistration<TDomainCore, TValue>[]

  /** Captures the target name and the registrations it disabled. */
  constructor(
    restore: (disabled: readonly IRegistration<TDomainCore, TValue>[]) => Promise<void>,
    name: string,
    disabled: readonly IRegistration<TDomainCore, TValue>[]
  ) {
    this.#restore = restore
    this.name = name
    this.#disabled = disabled
  }

  /** Re-enables the captured set in reverse order after checking every provider first. */
  readonly enable = async (): Promise<void> => this.#restore(this.#disabled)
}

/** Typed enablement facade: the runtime owns transitions and the Host keeps FIFO admission. */
class PluginHostEnablementFacade<THost, TDomainCore extends object, TValue> {
  /** Enablement transitions and disabled-name bookkeeping. */
  readonly #runtime: PluginHostEnablementRuntime<TDomainCore, TValue>
  /** Host admission, queue and dependent-recovery ports. */
  readonly #port: IPluginHostEnablementFacadePort<THost, TDomainCore, TValue>

  /** Captures the runtime and Host ports. */
  constructor(
    runtime: PluginHostEnablementRuntime<TDomainCore, TValue>,
    port: IPluginHostEnablementFacadePort<THost, TDomainCore, TValue>
  ) {
    this.#runtime = runtime
    this.#port = port
  }

  /** Rejects terminal or reentrant calls before they enter the mutation queue. */
  #admit(): void {
    this.#port.assertActive()
    this.#port.assertMutationAllowed()
  }

  /** Disables a registration and its planned dependents, or returns the dry-run plan. */
  readonly disable = async (name: string, options: IPluginDependencyMutationOptions = {}) => {
    this.#admit()
    return this.#port.enqueue(async () => this.#disableNow(name, options))
  }

  /** Runs one queued disable mutation. */
  #disableNow(name: string, options: IPluginDependencyMutationOptions) {
    const runtime = this.#runtime
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
      token: Object.freeze(new PluginHostEnablementToken(this.#restore, name, disabled))
    })
  }

  /** Queues the restore of one disable call's registrations; only issued tokens receive it. */
  readonly #restore = (disabled: readonly IRegistration<TDomainCore, TValue>[]): Promise<void> => {
    this.#admit()
    return this.#port.enqueue(async () => {
      // Check the whole restore set first so a rejected token enables nothing.
      const enabling = new Set(disabled.map((item) => item.name))
      for (const item of disabled) this.#runtime.assertProvidersAvailable(item, enabling)
      for (let index = disabled.length - 1; index >= 0; index -= 1) {
        const item = disabled[index]!
        this.#runtime.enable(item)
        await this.#port.resumeAfterProvider(item.name, false)
      }
    })
  }

  /** Enables one registration after its providers are available. */
  readonly enable = async (name: string) => {
    this.#admit()
    return this.#port.enqueue(async () => {
      const registration = this.#runtime.requireInstalled(name)
      this.#runtime.assertProvidersAvailable(registration)
      this.#runtime.enable(registration)
      await this.#port.resumeAfterProvider(name, false)
    })
  }

  /** Names currently disabled, in transition order. */
  readonly disabled = () => this.#runtime.disabled()
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
): IPluginEnablement<THost, TInstalled, TDomainCore, TValue> =>
  Object.freeze(
    new PluginHostEnablementFacade<THost, TDomainCore, TValue>(runtime, port)
  ) as unknown as IPluginEnablement<THost, TInstalled, TDomainCore, TValue>
