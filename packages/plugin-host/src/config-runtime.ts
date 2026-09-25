import { copyConfigWithPatch, parseConfigPath, readConfigPath } from './config.js'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { PluginHostErrorCode } from './error-code.js'
import { invokeCaptured } from './invocation.js'
import type { IRegistration } from './registry.js'
import type {
  IPluginConfig,
  IPluginConstraint,
  IPluginHostConfigFor,
  IPluginHostCore
} from './typing.js'

type IPluginHostConfigRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly registrations: Map<string, IRegistration<TDomainCore, TValue>>
  readonly assertActive: () => void
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>
  readonly beginOperation: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly awaitOperation: <T>(
    result: T | PromiseLike<T>,
    registration: IRegistration<TDomainCore, TValue>
  ) => Promise<T>
  readonly assertOperationCurrent: (registration: IRegistration<TDomainCore, TValue>) => void
  readonly setHookRegistration: (
    registration: IRegistration<TDomainCore, TValue> | undefined
  ) => void
  readonly createCore: (
    registration: IRegistration<TDomainCore, TValue>
  ) => TDomainCore & IPluginHostCore<TValue>
  readonly commitRevision: () => void
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
      throw createPluginHostTypeError('config path must be a non-empty string')
    /** Plugin names cannot contain dots, so the first path segment is an exact map key. */
    const separator = path.indexOf('.')
    const name = separator < 0 ? path : path.slice(0, separator)
    const registration = this.#port.registrations.get(name)
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
    return this.#port.enqueue(async () => {
      const registration = this.#port.registrations.get(name)
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
          this.#port.beginOperation(registration)
          this.#port.setHookRegistration(registration)
          const updateResult = invokeCaptured(
            registration.plugin.update,
            registration.plugin.owner,
            [next as never, this.#port.createCore(registration)]
          )
          await this.#port.awaitOperation(updateResult, registration)
          this.#port.assertOperationCurrent(registration)
        }
      } finally {
        this.#port.setHookRegistration(undefined)
      }
      registration.config = next
      this.#port.commitRevision()
    })
  }
}
