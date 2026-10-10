import type { IDefinedPluginConstraint, IFeature } from '@migaia/plugin-host'
import type { IRemoteContract } from './contract.js'
import { assembleRemotePluginDefinition } from './internal/assemble-plugin.js'
import type { IRemotePluginHostPort, IRemoteProxyOptions } from './types.js'

/** Plugin mode binds one declared contract to one PluginHost registration. */
export type IRemotePluginOptions<TUnit, TSpec> = IRemoteProxyOptions<TUnit, TSpec> &
  Readonly<{ name: string; contract: IRemoteContract; host: IRemotePluginHostPort }>

/** Runtime Feature names come from a validated description, so their type remains dynamic. */
export type IRemotePluginDefinition = IDefinedPluginConstraint<
  object,
  never,
  Record<string, never>,
  Record<string, unknown>,
  Record<string, never>,
  string,
  Record<string, IFeature<object, object, Record<never, never>>>
>

/** Creates a PluginHost definition through the shared package-owned assembly. */
export function createRemotePlugin<TUnit, TSpec>(
  options: IRemotePluginOptions<TUnit, TSpec>
): IRemotePluginDefinition {
  return assembleRemotePluginDefinition(options)
}
