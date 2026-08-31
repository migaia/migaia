import { invokeCaptured } from './invocation.js'
import type { IRegistration } from './registry.js'
import type {
  IPluginConfig,
  IPluginConstraint,
  IPluginHostConfigFor,
  IPluginHostView
} from './typing.js'

/** Host callbacks needed to materialize a view without transferring lifecycle ownership. */
export type IPluginHostPublicationPort<THost, TDomainCore extends object, TValue> = Readonly<{
  readonly host: THost
  assertLive(registrations: readonly IRegistration<TDomainCore, TValue>[]): void
  readConfig(path: string): unknown
  updateConfig(
    name: string,
    recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void>
  getShared(key: PropertyKey): unknown
  use(plugins: readonly IPluginConstraint<any>[]): unknown
  unUse(name: string): unknown
}>

/**
 * Materializes one immutable publication snapshot. All liveness and mutation decisions remain in
 * PluginHost; this module owns only descriptor-safe view construction.
 */
export const createPluginHostPublication = <
  THost,
  TDomainCore extends object,
  TValue,
  TViewPlugins extends readonly IPluginConstraint<any>[]
>(
  registrations: readonly IRegistration<TDomainCore, TValue>[],
  port: IPluginHostPublicationPort<THost, TDomainCore, TValue>
): IPluginHostView<THost, TViewPlugins> => {
  /** Frozen registration identities defining this exact publication generation. */
  const captured = Object.freeze([...registrations])
  /** Null-prototype extension record excluding Host and Object prototype capabilities. */
  const extensions = Object.create(null) as Record<PropertyKey, unknown>
  for (const registration of captured)
    for (const { key, descriptor } of registration.extensions) {
      /** Captured extension value published without re-reading the candidate object. */
      const value = descriptor.value
      /** Callable extensions retain the concrete Host receiver through the canonical invoker. */
      const published =
        typeof value === 'function'
          ? (...args: unknown[]) => invokeCaptured(value, port.host, args)
          : value
      Object.defineProperty(extensions, key, {
        value: published,
        enumerable: true,
        configurable: false,
        writable: false
      })
    }
  Object.freeze(extensions)

  /** Null-prototype public view whose every read revalidates the captured generation. */
  const view = Object.create(null) as Record<PropertyKey, unknown>
  Object.defineProperties(view, {
    host: { value: port.host, enumerable: true, configurable: false, writable: false },
    extensions: {
      enumerable: true,
      configurable: false,
      get: () => {
        port.assertLive(captured)
        return extensions
      }
    },
    config: {
      enumerable: true,
      configurable: false,
      get: () => {
        port.assertLive(captured)
        return {
          get: (path: string) => {
            port.assertLive(captured)
            return port.readConfig(path)
          },
          update: (
            name: string,
            recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
          ) => {
            port.assertLive(captured)
            return port.updateConfig(name, recipe)
          }
        } as IPluginHostConfigFor<TViewPlugins>
      }
    },
    getShared: {
      enumerable: true,
      configurable: false,
      writable: false,
      value: (key: PropertyKey) => {
        port.assertLive(captured)
        return port.getShared(key)
      }
    },
    use: {
      enumerable: true,
      configurable: false,
      writable: false,
      value: (...plugins: readonly IPluginConstraint<any>[]) => port.use(plugins)
    },
    unUse: {
      enumerable: true,
      configurable: false,
      writable: false,
      value: (name: string) => port.unUse(name)
    }
  })
  return Object.freeze(view) as IPluginHostView<THost, TViewPlugins>
}
