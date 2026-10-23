import type { IRpcFeaturePluginDefinition, IRpcTransportPluginDefinition } from './types.js'

/** Private receipts identify the final native plugin object without reading caller properties. */
export type IRpcPluginMetadata =
  | Readonly<{ kind: 'transport'; definition: IRpcTransportPluginDefinition }>
  | Readonly<{ kind: 'feature'; definition: IRpcFeaturePluginDefinition; identity: object }>

/** Configuration identities carry no live installation or connection state. */
const definitions = new WeakMap<object, IRpcPluginMetadata>()

/** Only the SDK registers its final frozen native definitions after native definition admission. */
export function registerRpcPluginMetadata(plugin: object, metadata: IRpcPluginMetadata): void {
  definitions.set(plugin, Object.freeze(metadata))
}

/** Read a held SDK identity; copied objects and arbitrary discriminator fields grant no authority. */
export function readRpcPluginMetadata(plugin: unknown): IRpcPluginMetadata | undefined {
  return plugin !== null && (typeof plugin === 'object' || typeof plugin === 'function')
    ? definitions.get(plugin)
    : undefined
}
