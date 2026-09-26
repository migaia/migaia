import type { IWebRpcHooksConfig, IWebRpcPlugin, IWebRpcPluginInstallResult } from '../typing.js'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcPortName } from '../internal/plugin-shared-keys.js'
import { WebRpcFirstPartyRoleSchema } from '../internal/plugin-contract.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'
import { createConstructionDiagnosticReporter } from '../internal/hooks.js'

const emptyClaims = Object.freeze({
  routes: Object.freeze([]),
  provides: Object.freeze([]),
  consumes: Object.freeze([]),
  publicKeys: Object.freeze([]),
  exposedKeys: Object.freeze([]),
  activator: false
})

/** Creates the native hooks role while retaining the public legacy middleware factory shape. */
function createHooksPlugin(config: IWebRpcHooksConfig): IWebRpcPlugin {
  return Object.freeze({
    name: 'middleware:hooks',
    metadata: Object.freeze({
      claims: emptyClaims,
      sharedProvides: WebRpcFirstPartyRoleSchema.hooks.sharedProvides,
      sharedConsumes: WebRpcFirstPartyRoleSchema.hooks.sharedConsumes,
      sharedOptionalConsumes: WebRpcFirstPartyRoleSchema.hooks.sharedOptionalConsumes
    }),
    install: (): IWebRpcPluginInstallResult => {
      if (!config || typeof config !== 'object' || Array.isArray(config))
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'hooks descriptor is invalid')
      let listenerValue: IWebRpcHooksConfig['listeners']
      let onHookError: IWebRpcHooksConfig['onHookError']
      try {
        listenerValue = config.listeners
        onHookError = config.onHookError
      } catch (error) {
        throw new WebRpcError(
          WebRpcErrorCode.invalidConfig,
          'hooks descriptor is unreadable',
          error
        )
      }
      try {
        const listeners =
          listenerValue === undefined
            ? []
            : Array.isArray(listenerValue)
              ? [...listenerValue]
              : [listenerValue]
        if (listeners.some((listener) => typeof listener !== 'function'))
          throw new WebRpcError(
            WebRpcErrorCode.invalidConfig,
            'hooks.listeners must contain functions'
          )
        if (onHookError !== undefined && typeof onHookError !== 'function')
          throw new WebRpcError(
            WebRpcErrorCode.invalidConfig,
            'hooks.onHookError must be a function'
          )
        const port = Object.freeze({
          listeners: Object.freeze(listeners),
          ...(onHookError === undefined ? {} : { onHookError }),
          reportConstructionDiagnostic: createConstructionDiagnosticReporter(listeners, onHookError)
        })
        return {
          extension: Object.freeze({}),
          ports: Object.freeze({ [WebRpcPortName.hooks]: port })
        }
      } catch (error) {
        if (error instanceof WebRpcError) throw error
        throw new WebRpcError(WebRpcErrorCode.invalidConfig, 'hooks descriptor is invalid', error)
      }
    }
  })
}

/** Creates a hooks middleware whose config is read only during Host installation. */
export const hooks = (config: IWebRpcHooksConfig = {}): IWebRpcPlugin =>
  freezePlugin(createHooksPlugin(config))
