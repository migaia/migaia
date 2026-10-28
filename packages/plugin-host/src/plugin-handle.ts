/** Owns name-addressed handles and generation-bound extensions; lifecycle authority stays in ports. */
import { invokeCaptured } from './invocation.ts'
import { PluginHostErrorCode } from './error-code.ts'
import ERROR_TEXT, { PluginHostError } from './error-text.ts'
import type { IRegistration } from './registry.ts'
import type { IPluginConfig } from './plugin-lifecycle-types.ts'

/** Host-owned access used to keep handles live across replacement generations. */
type IPluginHandlePort<TDomainCore extends object, TValue> = Readonly<{
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

/** Read-only generation probes belong to handles and disappear when the handle is collected. */
const handleRegistrations = new WeakMap<object, () => boolean>()

/**
 * Returns whether a Host-created handle still names the exact registration present at creation.
 * Disabled and suspended registrations remain current. Removed, replaced, disposed, and unknown
 * handles return false. Handle members retain their existing name-addressed behavior across
 * replacement; this probe exposes no registration object or mutation authority.
 */
export function isPluginHandleCurrent(handle: unknown): boolean {
  return (typeof handle === 'object' && handle !== null) || typeof handle === 'function'
    ? (handleRegistrations.get(handle as object)?.() ?? false)
    : false
}

/** Throws the state-specific handle boundary error for one current registration. */
const requireRegistration = <TDomainCore extends object, TValue>(
  port: IPluginHandlePort<TDomainCore, TValue>,
  name: string
): IRegistration<TDomainCore, TValue> => {
  port.assertActive()
  /** Every public read selects the current registration after Host lifecycle admission. */
  const registration = port.lookup(name)
  if (!registration)
    throw new PluginHostError(
      PluginHostErrorCode.pluginNotInstalled,
      ERROR_TEXT.PLUGIN_NOT_INSTALLED(name)
    )
  if (!registration.enabled)
    throw new PluginHostError(PluginHostErrorCode.pluginDisabled, ERROR_TEXT.PLUGIN_DISABLED(name))
  if (registration.suspended)
    throw new PluginHostError(
      PluginHostErrorCode.pluginSuspended,
      ERROR_TEXT.PLUGIN_SUSPENDED(name)
    )
  if (!registration.activated)
    throw new PluginHostError(
      PluginHostErrorCode.pluginNotActivated,
      ERROR_TEXT.PLUGIN_NOT_ACTIVATED(name)
    )
  return registration
}

/** Owns the exact generation and receiver captured by one published callable extension. */
class PluginHandleExtension<TDomainCore extends object, TValue> {
  /** Host authority rechecks lifecycle and the current generation before each invocation. */
  readonly #port: IPluginHandlePort<TDomainCore, TValue>
  /** Exact generation captured by this extension, independently from name-addressed handles. */
  readonly #registration: IRegistration<TDomainCore, TValue>
  /** Original callable retains its Host receiver through the canonical invoker. */
  readonly #value: Function

  /** Captures one admitted callable without exposing the registration on the public function. */
  constructor(
    port: IPluginHandlePort<TDomainCore, TValue>,
    registration: IRegistration<TDomainCore, TValue>,
    value: Function
  ) {
    this.#port = port
    this.#registration = registration
    this.#value = value
  }

  /** Rejects stale or unavailable generations before forwarding the exact arguments. */
  invoke(args: unknown[]): unknown {
    this.#port.assertActive()
    if (this.#port.lookup(this.#registration.name) !== this.#registration)
      throw new PluginHostError(
        PluginHostErrorCode.registrationRevoked,
        ERROR_TEXT.REGISTRATION_REVOKED
      )
    if (!this.#registration.enabled)
      throw new PluginHostError(
        PluginHostErrorCode.pluginDisabled,
        ERROR_TEXT.PLUGIN_DISABLED(this.#registration.name)
      )
    if (this.#registration.suspended)
      throw new PluginHostError(
        PluginHostErrorCode.pluginSuspended,
        ERROR_TEXT.PLUGIN_SUSPENDED(this.#registration.name)
      )
    return invokeCaptured(this.#value, this.#port.host, args)
  }
}

/** Publishes callable extensions bound to one exact registration generation. */
const readExtensions = <TDomainCore extends object, TValue>(
  port: IPluginHandlePort<TDomainCore, TValue>,
  registration: IRegistration<TDomainCore, TValue>
): Readonly<Record<PropertyKey, unknown>> => {
  /** The weak cache preserves the facade and callable identities for this generation. */
  const cached = extensionFacades.get(registration)
  if (cached) return cached
  /** Null-prototype publication retains the original own enumerable descriptors. */
  const extensions = Object.create(null) as Record<PropertyKey, unknown>
  for (const { key, descriptor } of registration.extensions) {
    /** Descriptor admission already captured this value without executing a getter. */
    const value = descriptor.value
    /** Only callable values need an explicit generation invocation owner. */
    const invocation =
      typeof value === 'function' ? new PluginHandleExtension(port, registration, value) : undefined
    Object.defineProperty(extensions, key, {
      enumerable: true,
      configurable: false,
      writable: false,
      value: invocation ? (...args: unknown[]) => invocation.invoke(args) : value
    })
  }
  /** Freeze only after every admitted descriptor has been published. */
  const frozen = Object.freeze(extensions)
  extensionFacades.set(registration, frozen)
  return frozen
}

/** Owns handle lookup and config access while its public surface remains an ordinary frozen object. */
class PluginHandleOwner<TDomainCore extends object, TValue> {
  /** The handle remains name-addressed across replacement generations. */
  readonly #name: string
  /** Host lifecycle, registration lookup and config mutation authority. */
  readonly #port: IPluginHandlePort<TDomainCore, TValue>
  /** Generation probe retains only the original token, never the registration or its outputs. */
  readonly #registrationToken: object | undefined

  /** Captures the original generation token at the same time as the previous handle factory. */
  constructor(name: string, port: IPluginHandlePort<TDomainCore, TValue>) {
    this.#name = name
    this.#port = port
    this.#registrationToken = port.lookup(name)?.pipelineOwnerKey
  }

  /** Resolves the current installed generation before reading its extension facade. */
  readExtensions(): Readonly<Record<PropertyKey, unknown>> {
    return readExtensions(this.#port, requireRegistration(this.#port, this.#name))
  }

  /** Resolves one declared Feature through the same current-registration admission policy. */
  getFeature(feature: string): object {
    /** This lookup intentionally follows replacement, while the current probe retains its token. */
    const registration = requireRegistration(this.#port, this.#name)
    if (!registration.featureOutputs || !Object.hasOwn(registration.featureOutputs, feature))
      throw new PluginHostError(
        PluginHostErrorCode.featureNotDeclared,
        ERROR_TEXT.FEATURE_NOT_DECLARED(this.#name, feature)
      )
    return registration.featureOutputs[feature]!
  }

  /** Reads current config after the original availability checks. */
  readConfig(): unknown {
    requireRegistration(this.#port, this.#name)
    return this.#port.readConfig(this.#name)
  }

  /** Returns the exact queued update Promise without introducing an asynchronous wrapper. */
  updateConfig(
    recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>
  ): Promise<void> {
    requireRegistration(this.#port, this.#name)
    return this.#port.updateConfig(this.#name, recipe)
  }

  /** Checks exact-generation membership without retaining the original registration. */
  isCurrent(): boolean {
    return (
      this.#registrationToken !== undefined &&
      this.#port.lookup(this.#name)?.pipelineOwnerKey === this.#registrationToken
    )
  }
}

/** Creates a name-addressed handle whose members resolve the current registration on every read. */
export const createPluginHandle = <TDomainCore extends object, TValue>(
  name: string,
  port: IPluginHandlePort<TDomainCore, TValue>
): object => {
  /** Runtime state belongs to this explicit owner; the public object only adapts its own surface. */
  const owner = new PluginHandleOwner(name, port)
  /** Config remains one frozen ordinary object owned by this handle. */
  const config = Object.freeze({
    get() {
      return owner.readConfig()
    },
    update(recipe: (previous: Readonly<IPluginConfig>) => Partial<IPluginConfig>) {
      return owner.updateConfig(recipe)
    }
  })
  /** Own key order, getter names, method lengths and ordinary prototype match the original handle. */
  const handle = Object.freeze({
    name,
    get extensions() {
      return owner.readExtensions()
    },
    getFeature(feature: string) {
      return owner.getFeature(feature)
    },
    config
  })
  handleRegistrations.set(handle, () => owner.isCurrent())
  return handle
}
