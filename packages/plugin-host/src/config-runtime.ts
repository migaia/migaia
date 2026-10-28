import type { PluginHostCoreRuntime } from './core-runtime.js'
import type { PluginHostOperationRuntime } from './operation-runtime.js'
import type { PluginHostState } from './host-state.js'
import { copyConfigWithPatch, parseConfigPath, readConfigPath } from './config.js'
import ERROR_TEXT, {
  identifyPluginHostCallbackFailure,
  PluginHostError,
  createPluginHostTypeError,
  PluginHostInternalText
} from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { invokeCaptured } from './invocation.js'
import type { IRegistration } from './registry.js'
import type { IPluginConfig } from './plugin-lifecycle-types.js'
import type { IPluginConstraint } from './plugin-definition-types.js'
import type { IPluginHostConfigFor } from './plugin-handle-types.js'

type IPluginHostConfigRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  /** Host-owned synchronous hook boundary, without changing the update result identity. */
  readonly invokeHook: <T>(invoke: () => T) => T
  readonly assertActive: () => void
  readonly isSetupPending: () => boolean
  readonly isReleasePending: () => boolean
  readonly decorateError: <TError extends PluginHostError>(error: TError) => TError
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>
  readonly setHookRegistration: (
    registration: IRegistration<TDomainCore, TValue> | undefined
  ) => void
  /** Canonical committed data and revision owner. */
  readonly state: PluginHostState<TDomainCore, TValue>
  /** Shared generation owner; method calls retain the original instance receiver. */
  readonly operations: Pick<PluginHostOperationRuntime, 'begin' | 'await' | 'assertCurrent'>
  /** Core construction remains owned by its existing runtime. */
  readonly core: Pick<PluginHostCoreRuntime<TDomainCore, TValue>, 'create'>
}>

/** Owns the stable public config facade and serialized plugin update transaction. */
export class PluginHostConfigRuntime<
  TDomainCore extends object,
  TValue,
  TInstalled extends readonly IPluginConstraint<any>[]
> {
  /** Narrow Host mutation and generation authority used by config updates. */
  readonly #port: IPluginHostConfigRuntimePort<TDomainCore, TValue>
  /** Lazily materialized stable facade retained for the Host lifetime. */
  #facade: IPluginHostConfigFor<TInstalled> | undefined

  constructor(port: IPluginHostConfigRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Returns the single public facade without allocating on repeated reads. */
  getFacade(): IPluginHostConfigFor<TInstalled> {
    if (this.#facade) return this.#facade
    this.#facade = {
      get: (path: string) => this.#read(path),
      update: <T extends IPluginConfig>(
        name: string,
        recipe: (previous: Readonly<T>) => Partial<T>
      ) => this.#update(name, recipe)
    } as IPluginHostConfigFor<TInstalled>
    return this.#facade
  }

  /** Resolves the dot-free plugin name before traversing its immutable config snapshot. */
  #read(path: string): unknown {
    this.#port.assertActive()
    if (typeof path !== 'string' || path.length === 0)
      throw createPluginHostTypeError(PluginHostInternalText.CONFIG_PATH_REQUIRED)
    /** Plugin names cannot contain dots, so the first path segment is an exact map key. */
    const separator = path.indexOf('.')
    const name = separator < 0 ? path : path.slice(0, separator)
    const registration = this.#port.state.registrations.get(name)
    if (!registration) return undefined
    return readConfigPath(registration.config, parseConfigPath(path))
  }

  /**
   * Runs one update hook under generation authority and commits config only after it remains
   * current.
   */
  #update<T extends IPluginConfig>(
    name: string,
    recipe: (previous: Readonly<T>) => Partial<T>
  ): Promise<void> {
    this.#port.assertActive()
    if (this.#port.isSetupPending() || this.#port.isReleasePending())
      throw this.#port.decorateError(
        new PluginHostError(PluginHostErrorCode.lifecycleMutation, ERROR_TEXT.LIFECYCLE_MUTATION)
      )
    return this.#port.enqueue(async () => {
      try {
        const registration = this.#port.state.registrations.get(name)
        if (!registration)
          throw new PluginHostError(
            PluginHostErrorCode.pluginNotInstalled,
            ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
          )
        const previous = registration.config
        const patch = recipe(previous as Readonly<T>)
        const next = copyConfigWithPatch(registration.config, patch)
        try {
          if (registration.plugin.update) {
            this.#port.operations.begin(registration)
            this.#port.setHookRegistration(registration)
            const updateResult = this.#port.invokeHook(() =>
              invokeCaptured(registration.plugin.update!, registration.plugin.owner, [
                next as never,
                this.#port.core.create(registration)
              ])
            )
            await this.#port.operations.await(updateResult, registration)
            this.#port.operations.assertCurrent(registration)
          }
        } finally {
          this.#port.setHookRegistration(undefined)
        }
        registration.config = next
        this.#port.state.commit()
      } catch (error) {
        throw identifyPluginHostCallbackFailure(error)
      }
    })
  }
}
