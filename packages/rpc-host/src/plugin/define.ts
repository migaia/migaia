import { definePlugin } from '@migaia/plugin-host'
import { tagRpcError } from '../core/errors.js'
import { RpcCoreErrorCode } from '../core/error-code.js'
import { HostErrorText } from '../host/error-text.js'
import { installRpcFeature } from '../host/install-port.js'
import { installRpcTransport } from '../host/install.js'
import { registerRpcPluginMetadata } from './metadata.js'
import type {
  IRpcConnectOptions,
  IRpcFeaturePlugin,
  IRpcFeaturePluginDefinition,
  IRpcTransportPlugin,
  IRpcTransportPluginDefinition
} from './types.js'

/** Capture one shared connection budget before deployment or installation can acquire resources. */
function captureConnect(connect: IRpcConnectOptions | undefined): IRpcConnectOptions | undefined {
  if (connect === undefined) return undefined
  /** The caller's getter is read exactly once and never retained by an installed generation. */
  const timeoutMs = connect.timeoutMs
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0))
    throw tagRpcError(
      new TypeError(HostErrorText.connectTimeoutInvalid),
      RpcCoreErrorCode.invalidConfig
    )
  return Object.freeze(timeoutMs === undefined ? {} : { timeoutMs })
}

/** Define a reusable native transport plugin whose actual install hook owns its deployment. */
export function defineTransportPlugin(
  definition: IRpcTransportPluginDefinition
): IRpcTransportPlugin {
  /** Registration exports are copied once, independently of later caller mutation. */
  const expose = definition.expose
  /** Only cold configuration is retained; every installation receives its own native Host core. */
  const captured: IRpcTransportPluginDefinition = Object.freeze({
    name: definition.name,
    expose: expose === undefined ? undefined : Object.freeze([...expose]),
    mode: definition.mode,
    deployment: definition.deployment,
    connect: captureConnect(definition.connect)
  })
  /** Native admission creates and freezes the exact object that receives the private identity. */
  const plugin = definePlugin({
    name: captured.name,
    expose: captured.expose,
    install: (core) => installRpcTransport(core, captured)
  })
  registerRpcPluginMetadata(plugin, { kind: 'transport', definition: captured })
  return plugin
}

/** Void-option public factories are callable without a redundant undefined argument. */
type IFeatureFactoryArguments<TOptions> = undefined extends TOptions
  ? [options?: TOptions]
  : [options: TOptions]

/** Build one native definition; surface descriptors enter native metadata before its final freeze. */
function createFeature<TSurface extends object>(
  definition: IRpcFeaturePluginDefinition & Readonly<{ surface?: TSurface }>,
  identity?: object
): IRpcFeaturePlugin & TSurface {
  /** Retained callbacks are cold configuration; they capture no installation's connection state. */
  const captured: IRpcFeaturePluginDefinition = Object.freeze({
    name: definition.name,
    probe: definition.probe,
    contribution: definition.contribution,
    assemble: definition.assemble,
    setup: definition.setup
  })
  /** Copy descriptors, so native metadata admission rejects accessors without invoking getters. */
  const surface = definition.surface
  /** The SDK's name and real install hook remain authoritative over surface metadata. */
  const source = Object.defineProperties(
    {},
    {
      ...(surface === undefined ? {} : Object.getOwnPropertyDescriptors(surface)),
      name: { value: captured.name, enumerable: true },
      install: {
        value: (core: Parameters<typeof installRpcFeature>[0]) =>
          installRpcFeature(core, captured, plugin),
        enumerable: true
      }
    }
  ) as {
    name: string
    install(core: Parameters<typeof installRpcFeature>[0]): ReturnType<typeof installRpcFeature>
  }
  /**
   * Native metadata admission retains the surface descriptors above, but TypeScript cannot infer
   * properties introduced through Object.defineProperties. This cast changes no object identity.
   */
  const plugin = definePlugin(source) as unknown as IRpcFeaturePlugin & TSurface
  registerRpcPluginMetadata(plugin, {
    kind: 'feature',
    definition: captured,
    identity: identity ?? plugin
  })
  return plugin
}

/** Create one definition factory whose independently configured instances share a private token. */
export function defineFeaturePlugin<TOptions, TSurface extends object>(
  factory: (options: TOptions) => IRpcFeaturePluginDefinition & Readonly<{ surface?: TSurface }>
): (...args: IFeatureFactoryArguments<TOptions>) => IRpcFeaturePlugin & TSurface
/** Define one custom feature; its final native plugin object is its own definition identity. */
export function defineFeaturePlugin<TSurface extends object = Record<never, never>>(
  definition: IRpcFeaturePluginDefinition & Readonly<{ surface?: TSurface }>
): IRpcFeaturePlugin & TSurface
export function defineFeaturePlugin<TOptions, TSurface extends object>(
  input:
    | ((options: TOptions) => IRpcFeaturePluginDefinition & Readonly<{ surface?: TSurface }>)
    | (IRpcFeaturePluginDefinition & Readonly<{ surface?: TSurface }>)
):
  | (IRpcFeaturePlugin & TSurface)
  | ((...args: IFeatureFactoryArguments<TOptions>) => IRpcFeaturePlugin & TSurface) {
  if (typeof input !== 'function') return createFeature(input)
  /** One token belongs to this factory definition, not to any one option snapshot or installation. */
  const identity = Object.freeze({})
  return (...args: IFeatureFactoryArguments<TOptions>) =>
    createFeature(input(args[0] as TOptions), identity)
}
