import { containAsyncRejection } from '@migaia/lifecycle'
import { invokeCaptured } from './invocation.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import type { PluginHostState } from './host-state.js'
import type { IRegistration } from './registry.js'
import type {
  IPluginConstraint,
  IPluginEnablement,
  IPluginHostDynamicView,
  IPluginHostErrorCode,
  IPluginRegistrationContext
} from './typing.js'

export type IPluginHostEnablementRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly state: PluginHostState<TDomainCore, TValue>
  readonly diagnostic: (message: string, code?: IPluginHostErrorCode) => unknown
}>

/** Host operations needed to serialize enablement without moving queue ownership. */
export type IPluginHostEnablementFacadePort<THost, TDomainCore extends object, TValue> = Readonly<{
  readonly assertActive: () => void
  readonly assertMutationAllowed: () => void
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>
  readonly createView: () => IPluginHostDynamicView<THost, TDomainCore, TValue>
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
      try {
        containAsyncRejection(
          this.#port.diagnostic(
            ERROR_TEXT.ENABLEMENT_HOOK_FAILED(registration.name, hook, error),
            PluginHostErrorCode.pluginInstallFailed
          ),
          () => undefined
        )
      } catch {}
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
  /** Restores only the exact registration captured by a disable token. */
  const enableRegistration = async (
    registration: IRegistration<TDomainCore, TValue>
  ): Promise<IPluginHostDynamicView<THost, TDomainCore, TValue>> => {
    admit()
    return port.enqueue(async () => {
      runtime.enable(registration)
      return port.createView()
    })
  }
  return Object.freeze({
    disable: async (name: string) => {
      admit()
      return port.enqueue(async () => {
        const registration = runtime.requireInstalled(name)
        runtime.disable(registration)
        return Object.freeze({
          token: Object.freeze({ name, enable: () => enableRegistration(registration) }),
          view: port.createView()
        })
      })
    },
    enable: async (name: string) => {
      admit()
      return port.enqueue(async () => {
        runtime.enable(runtime.requireInstalled(name))
        return port.createView()
      })
    },
    disabled: () => runtime.disabled()
  }) as unknown as IPluginEnablement<THost, TInstalled, TDomainCore, TValue>
}
