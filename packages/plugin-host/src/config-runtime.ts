/**
 * Owns the stable config surface and queued update transaction; Host retains admission and
 * generation authority.
 */
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

/** Narrow authority for config admission, queued hooks and committed config publication. */
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

  /** Captures Host authority without allocating the lazy public config surface. */
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
    /** First segment names the exact registration before config-path traversal. */
    const name = separator < 0 ? path : path.slice(0, separator)
    /** Exact committed registration selected by the admitted plugin name. */
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
    /** One immutable request keeps the queue adapter independent from individual update state. */
    const request = { name, recipe }
    return this.#port.enqueue(() => this.#applyUpdate(request))
  }

  /** Runs the admitted update without changing hook invocation or await boundaries. */
  async #applyUpdate<T extends IPluginConfig>(
    request: Readonly<{
      readonly name: string
      readonly recipe: (previous: Readonly<T>) => Partial<T>
    }>
  ): Promise<void> {
    const { name, recipe } = request
    try {
      /** Exact committed registration selected by the admitted plugin name. */
      const registration = this.#port.state.registrations.get(name)
      if (!registration)
        throw new PluginHostError(
          PluginHostErrorCode.pluginNotInstalled,
          ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
        )
      /** Recipe reads the original committed config until its update hook succeeds. */
      const previous = registration.config
      /** User recipe produces the patch synchronously under existing admission. */
      const patch = recipe(previous as Readonly<T>)
      /** Frozen candidate remains unpublished until the exact update generation survives. */
      const next = copyConfigWithPatch(registration.config, patch)
      try {
        if (registration.plugin.update) {
          this.#port.operations.begin(registration)
          this.#port.setHookRegistration(registration)
          /** Explicit hook context prevents the adapter from capturing transaction locals. */
          const update = { registration, next }
          /** Original hook result crosses the operation boundary without an extra await. */
          const updateResult = this.#port.invokeHook(() => this.#invokeUpdate(update))
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
  }

  /** Invokes the admitted update hook with its original receiver and exact native core. */
  #invokeUpdate(
    request: Readonly<{
      readonly registration: IRegistration<TDomainCore, TValue>
      readonly next: IPluginConfig
    }>
  ): unknown {
    const { registration, next } = request
    return invokeCaptured(registration.plugin.update!, registration.plugin.owner, [
      next as never,
      this.#port.core.create(registration)
    ])
  }
}
