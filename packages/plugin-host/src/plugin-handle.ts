import { invokeCaptured } from './invocation.js'
import { PluginHostErrorCode } from './error-code.js'
import ERROR_TEXT, { PluginHostError } from './error-text.js'
import type { IRegistration } from './registry.js'
import type { IPluginConfig } from './typing.js'

/** Host-owned access used to keep handles live across replacement generations. */
export type IPluginHandlePort<TDomainCore extends object, TValue> = Readonly<{
  readonly host: object
  assertActive(): void
  lookup(name: string): IRegistration<TDomainCore, TValue> | undefined
  readConfig(name: string): unknown
  updateConfig(
    name: string,
    recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void>
}>

/** Cached extension facade for one exact registration generation. */
const extensionFacades = new WeakMap<object, Readonly<Record<PropertyKey, unknown>>>()

/** Throws the state-specific handle boundary error for one current registration. */
const requireRegistration = <TDomainCore extends object, TValue>(
  port: IPluginHandlePort<TDomainCore, TValue>,
  name: string
): IRegistration<TDomainCore, TValue> => {
  port.assertActive()
  const registration = port.lookup(name)
  if (!registration)
    throw new PluginHostError(
      PluginHostErrorCode.pluginNotInstalled,
      ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
    )
  if (!registration.enabled)
    throw new PluginHostError(PluginHostErrorCode.pluginDisabled, ERROR_TEXT.PLUGIN_DISABLED(name))
  if (!registration.activated)
    throw new PluginHostError(
      PluginHostErrorCode.pluginNotActivated,
      ERROR_TEXT.PLUGIN_NOT_ACTIVATED(name)
    )
  return registration
}

/** Publishes callable extensions bound to one exact registration generation. */
const readExtensions = <TDomainCore extends object, TValue>(
  port: IPluginHandlePort<TDomainCore, TValue>,
  registration: IRegistration<TDomainCore, TValue>
): Readonly<Record<PropertyKey, unknown>> => {
  const cached = extensionFacades.get(registration)
  if (cached) return cached
  const extensions = Object.create(null) as Record<PropertyKey, unknown>
  for (const { key, descriptor } of registration.extensions) {
    const value = descriptor.value
    Object.defineProperty(extensions, key, {
      enumerable: true,
      configurable: false,
      writable: false,
      value:
        typeof value === 'function'
          ? (...args: unknown[]) => {
              port.assertActive()
              if (port.lookup(registration.name) !== registration)
                throw new PluginHostError(
                  PluginHostErrorCode.registrationRevoked,
                  ERROR_TEXT.REGISTRATION_REVOKED
                )
              if (!registration.enabled)
                throw new PluginHostError(
                  PluginHostErrorCode.pluginDisabled,
                  ERROR_TEXT.PLUGIN_DISABLED(registration.name)
                )
              return invokeCaptured(value, port.host, args)
            }
          : value
    })
  }
  const frozen = Object.freeze(extensions)
  extensionFacades.set(registration, frozen)
  return frozen
}

/** Creates a name-addressed handle whose members resolve the current registration on every read. */
export const createPluginHandle = <TDomainCore extends object, TValue>(
  name: string,
  port: IPluginHandlePort<TDomainCore, TValue>
): object =>
  Object.freeze({
    name,
    get extensions() {
      const registration = requireRegistration(port, name)
      return readExtensions(port, registration)
    },
    getFeature(feature: string) {
      const registration = requireRegistration(port, name)
      if (!registration.featureOutputs || !Object.hasOwn(registration.featureOutputs, feature))
        throw new PluginHostError(
          PluginHostErrorCode.featureNotDeclared,
          ERROR_TEXT.FEATURE_NOT_DECLARED(name, feature)
        )
      return registration.featureOutputs[feature]
    },
    config: Object.freeze({
      get() {
        requireRegistration(port, name)
        return port.readConfig(name)
      },
      update(recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>) {
        requireRegistration(port, name)
        return port.updateConfig(name, recipe)
      }
    })
  })
