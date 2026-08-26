import type { IWebRpcPlugin, IWebRpcPluginInstallResult } from '../typing.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import type { IWebRpcPluginDescriptor } from './plugin-translator.js'
import { safeRead } from './safe-value.js'

/** Freezes a fresh descriptor snapshot so each factory call has independent identity. */
export function freezePlugin<TPlugin extends IWebRpcPlugin>(plugin: TPlugin): TPlugin {
  return Object.freeze({ ...plugin }) as TPlugin
}

/** Converts one native WebRPC descriptor into the permanent PluginHost boundary shape. */
export function toPluginDescriptor(plugin: IWebRpcPlugin): IWebRpcPluginDescriptor {
  const metadata = plugin.metadata
  return {
    name: plugin.name,
    claims: metadata.claims,
    sharedProvides: metadata.sharedProvides,
    sharedConsumes: metadata.sharedConsumes,
    sharedOptionalConsumes: metadata.sharedOptionalConsumes,
    install: async (scope) => {
      const result = await plugin.install({
        ...scope,
        own: <T>(resource: T, release: () => void | Promise<void>): T =>
          scope.own(resource, release)
      })
      assertPluginInstallResult(result)
      return result
    },
    shared: (installation) => (installation as IWebRpcPluginInstallResult).shared
  }
}

/** Validates the stable result shape returned by a native plugin body. */
export function assertPluginInstallResult(
  value: unknown
): asserts value is IWebRpcPluginInstallResult {
  if (!value || typeof value !== 'object')
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'plugin install result is invalid')
  const extension = safeRead<unknown>(value, 'extension')
  const shared = safeRead<unknown>(value, 'shared')
  if (!extension || typeof extension !== 'object' || !shared || typeof shared !== 'object')
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'plugin install result is invalid')
}
